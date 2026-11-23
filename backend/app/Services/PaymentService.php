<?php

namespace App\Services;

use App\Models\CashLedger;
use App\Models\CashLocation;
use App\Models\CustomerLedger;
use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\Penalty;
use App\Models\User;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentService
{
    /**
     * Record a collection. Everything happens inside ONE transaction with the loan row locked, so
     * concurrent collections on the same khata are serialised and can never double-allocate.
     *
     * Allocation order:
     *   1. explicit penalty part  → oldest penalties first
     *   2. explicit old-khata part
     *   3. remaining → installments that are due (due_date <= payment_date), oldest first
     *      (if none are due, the next upcoming installment is the "current" one and is paid first)
     *   4. anything left → advance deposit (applied automatically when later installments fall due)
     *
     * @return array{0:Payment,1:bool} [payment, wasDuplicate]
     */
    public static function collect(array $d, User $by): array
    {
        $key = $d['idempotency_key'] ?? null;
        if ($key && ($existing = Payment::where('idempotency_key', $key)->first())) {
            return [self::sameRequest($existing, $d, $by), true];
        }

        try {
            $payment = DB::transaction(fn () => self::doCollect($d, $by), 3);
        } catch (QueryException $e) {
            // two identical submissions raced – the unique idempotency key rejects the second
            if ($key && ($existing = Payment::where('idempotency_key', $key)->first())) {
                return [self::sameRequest($existing, $d, $by), true];
            }
            throw $e;
        }
        return [$payment, false];
    }

    /** Non-admin staff may record a payment at most this many days in the past (offline queue window). */
    public const BACKDATE_DAYS = 7;

    /** A retried key must come from the same user for the same khata – otherwise it is someone else's payment. */
    private static function sameRequest(Payment $existing, array $d, User $by): Payment
    {
        if ((int) $existing->loan_account_id !== (int) $d['loan_account_id'] || (int) $existing->created_by !== (int) $by->id) {
            throw ValidationException::withMessages(['idempotency_key' => ['This request key was already used.']]);
        }
        return $existing;
    }

    private static function doCollect(array $d, User $by): Payment
    {
        $loan = LoanAccount::whereKey($d['loan_account_id'])->lockForUpdate()->firstOrFail();
        $key = $d['idempotency_key'] ?? null;
        if ($key && ($dupe = Payment::where('idempotency_key', $key)->first())) {
            return self::sameRequest($dupe, $d, $by); // lost the race – return the winner
        }
        if ($loan->status !== 'active') {
            throw ValidationException::withMessages(['loan_account_id' => ['This khata is closed.']]);
        }

        $loc = CashLocation::findOrFail($d['cash_location_id']);
        if ($loc->status !== 'active') {
            throw ValidationException::withMessages(['cash_location_id' => ['Cash location is inactive.']]);
        }

        $date = $d['payment_date'] ?? now()->toDateString();
        if ($date > now()->toDateString()) {
            throw ValidationException::withMessages(['payment_date' => ['Payment date cannot be in the future.']]);
        }
        if (!$by->isAdmin() && $date < now()->subDays(self::BACKDATE_DAYS)->toDateString()) {
            throw ValidationException::withMessages(['payment_date' => ['Payment date is too far in the past – ask an admin.']]);
        }

        $total = Money::p($d['amount']);
        if ($total <= 0) {
            throw ValidationException::withMessages(['amount' => ['Amount must be greater than zero.']]);
        }
        $mode = $d['mode'] ?? 'auto';
        $penaltyPart = $mode === 'advance' ? 0 : Money::p($d['penalty_amount'] ?? 0);
        $oldPart = $mode === 'advance' ? 0 : Money::p($d['old_khata_amount'] ?? 0);
        if ($penaltyPart < 0 || $oldPart < 0 || $penaltyPart + $oldPart > $total) {
            throw ValidationException::withMessages(['amount' => ['Penalty / old khata portions exceed the amount.']]);
        }

        // 0. advance already on account is applied to installments that are due, before new money
        AdvanceService::applyDue($loan, $date, $by->id);

        $payment = Payment::create([
            'receipt_no' => Numbers::receipt(),
            'idempotency_key' => $key,
            'loan_account_id' => $loan->id,
            'customer_id' => $loan->customer_id,
            'payment_date' => $date,
            'amount' => Money::s($total),
            'payment_type' => $d['payment_type'] ?? 'cash',
            'cash_location_id' => $loc->id,
            'collected_by' => $d['collected_by'] ?? $by->id,
            'created_by' => $by->id,
            'reference' => $d['reference'] ?? null,
            'notes' => $d['notes'] ?? null,
            'mode' => $mode,
            'is_offline' => (bool) ($d['is_offline'] ?? false),
        ]);

        $alloc = fn (string $type, int $amt, array $extra = []) =>
            PaymentAllocation::create(['payment_id' => $payment->id, 'type' => $type, 'amount' => Money::s($amt)] + $extra);

        // 1. penalties (explicit, oldest first)
        $left = $penaltyPart;
        if ($penaltyPart > 0) {
            $penalties = Penalty::where('loan_account_id', $loan->id)->whereIn('status', ['open', 'partial'])
                ->orderBy('penalty_date')->orderBy('id')->lockForUpdate()->get();
            foreach ($penalties as $p) {
                if ($left <= 0) break;
                $take = min($left, $p->outstandingPaise());
                if ($take <= 0) continue;
                $p->paid_amount = Money::s(Money::p($p->paid_amount) + $take);
                PenaltyService::refresh($p);
                $p->save();
                $alloc('penalty', $take, ['penalty_id' => $p->id]);
                $left -= $take;
            }
            if ($left > 0) {
                throw ValidationException::withMessages(['penalty_amount' => ['Penalty amount exceeds outstanding penalty.']]);
            }
            LedgerService::customer($loan->customer_id, $loan->id, 'penalty_payment', 0, $penaltyPart,
                "Penalty collected – {$payment->receipt_no}", $date, $by->id, ['payment_id' => $payment->id]);
        }

        // 2. old khata (explicit)
        if ($oldPart > 0) {
            $oldRemaining = Money::p($loan->old_khata_outstanding) - Money::p($loan->old_khata_paid);
            if ($oldPart > $oldRemaining) {
                throw ValidationException::withMessages(['old_khata_amount' => ['Old khata amount exceeds outstanding.']]);
            }
            $loan->old_khata_paid = Money::s(Money::p($loan->old_khata_paid) + $oldPart);
            $loan->save();
            $alloc('old_khata', $oldPart);
            LedgerService::customer($loan->customer_id, $loan->id, 'old_khata_payment', 0, $oldPart,
                "Old khata collected – {$payment->receipt_no}", $date, $by->id, ['payment_id' => $payment->id]);
        }

        // 3. installments
        $left = $total - $penaltyPart - $oldPart;
        $instPaid = 0;
        $numbers = [];
        $stillPartial = false;
        if ($mode !== 'advance' && $left > 0) {
            $open = LoanInstallment::where('loan_account_id', $loan->id)->whereIn('state', ['open', 'partial'])
                ->orderBy('number')->lockForUpdate()->get();
            $due = $open->filter(fn ($i) => $i->due_date->toDateString() <= $date)->values();
            $targets = $due->isNotEmpty() ? $due : $open->take(1);

            foreach ($targets as $inst) {
                if ($left <= 0) break;
                $take = min($left, $inst->remainingPaise());
                if ($take <= 0) continue;
                $inst->paid_amount = Money::s(Money::p($inst->paid_amount) + $take);
                $inst->refreshState();
                $inst->save();
                $alloc('installment', $take, ['loan_installment_id' => $inst->id]);
                $left -= $take;
                $instPaid += $take;
                $numbers[] = $inst->number;
                $stillPartial = $stillPartial || $inst->remainingPaise() > 0;
            }
            if ($instPaid > 0) {
                LedgerService::customer($loan->customer_id, $loan->id, $stillPartial ? 'partial_payment' : 'installment_payment',
                    0, $instPaid, 'Installment #' . implode(', #', $numbers) . " – {$payment->receipt_no}", $date, $by->id, ['payment_id' => $payment->id]);
            }
        }

        // 4. whatever remains becomes advance (capped by what is still unpaid on the khata)
        if ($left > 0) {
            $unpaid = (int) LoanInstallment::where('loan_account_id', $loan->id)->get()->sum(fn ($i) => $i->remainingPaise());
            if (LedgerService::advanceBalance($loan->id) + $left > $unpaid) {
                throw ValidationException::withMessages(['amount' => ['Amount exceeds the outstanding balance of this khata.']]);
            }
            $alloc('advance_deposit', $left);
            LedgerService::advance($loan->customer_id, $loan->id, 'deposit', $left, 0,
                "Advance deposit – {$payment->receipt_no}", $date, $by->id, ['payment_id' => $payment->id]);
            LedgerService::customer($loan->customer_id, $loan->id, 'advance_deposit', 0, $left,
                "Advance deposit – {$payment->receipt_no}", $date, $by->id, ['payment_id' => $payment->id]);
        }

        // cash ledger – the money physically lands in the selected location
        CashService::post($loc->id, 'collection', $total, 0,
            "Collection {$payment->receipt_no} – {$loan->khata_no}", $date, $by->id,
            ['payment_id' => $payment->id, 'loan_account_id' => $loan->id]);

        self::autoClose($loan, $by);

        Audit::log('payment.created', $payment, null, ['amount' => Money::s($total), 'receipt' => $payment->receipt_no, 'khata' => $loan->khata_no]);
        return $payment->fresh(['allocations']);
    }

    public const AUTO_CLOSE_NOTE = 'Auto-closed: fully paid';

    /**
     * A khata that is completely paid closes by itself, so it leaves every active list. If the customer paid
     * the remaining weeks in advance, that advance is applied to all remaining installments first (early close).
     * Penalties / old khata must be zero as well; unused advance is never swallowed (manual close + refund).
     */
    private static function autoClose(LoanAccount $loan, User $by): void
    {
        $unpaid = (int) LoanInstallment::where('loan_account_id', $loan->id)->get()->sum(fn ($i) => $i->remainingPaise());
        $adv = LedgerService::advanceBalance($loan->id);
        if ($unpaid > 0 && $adv >= $unpaid) {
            AdvanceService::applyDue($loan, '2999-12-31', $by->id);
        }
        $m = LoanMetrics::format(LoanMetrics::query()->whereKey($loan->id)->first());
        if (!$m['can_close'] || Money::p($m['advance_balance']) > 0) {
            return;
        }
        $loan->update(['status' => 'closed', 'closed_at' => now(), 'closed_by' => $by->id, 'close_type' => 'full', 'close_note' => self::AUTO_CLOSE_NOTE]);
        Audit::log('loan.closed', $loan, null, ['type' => 'full', 'note' => self::AUTO_CLOSE_NOTE]);
    }

    /**
     * Reverse a payment. The original row and ledger lines are preserved; opposite entries are added.
     * Only the latest completed payment of a khata can be reversed (reverse newer ones first).
     */
    public static function reverse(Payment $payment, User $by, string $reason): Payment
    {
        return DB::transaction(function () use ($payment, $by, $reason) {
            $loan = LoanAccount::whereKey($payment->loan_account_id)->lockForUpdate()->firstOrFail();
            $payment = Payment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            if ($payment->status !== 'completed') {
                throw ValidationException::withMessages(['payment' => ['Payment is already reversed.']]);
            }
            $latest = Payment::where('loan_account_id', $loan->id)->where('status', 'completed')->max('id');
            if ((int) $latest !== (int) $payment->id) {
                throw ValidationException::withMessages(['payment' => ['Only the most recent payment of this khata can be reversed. Reverse newer payments first.']]);
            }
            if ($loan->status === 'closed' && $loan->close_note === self::AUTO_CLOSE_NOTE) {
                // reversing a payment of an auto-closed khata re-opens it
                $loan->update(['status' => 'active', 'closed_at' => null, 'closed_by' => null, 'close_type' => null, 'close_note' => null]);
            }
            $today = now()->toDateString();

            foreach ($payment->allocations()->get() as $a) {
                $amt = Money::p($a->amount);
                if ($a->type === 'installment' && $a->loan_installment_id) {
                    $inst = LoanInstallment::whereKey($a->loan_installment_id)->lockForUpdate()->first();
                    $inst->paid_amount = Money::s(max(0, Money::p($inst->paid_amount) - $amt));
                    $inst->refreshState();
                    $inst->save();
                } elseif ($a->type === 'penalty' && $a->penalty_id) {
                    $p = Penalty::whereKey($a->penalty_id)->lockForUpdate()->first();
                    $p->paid_amount = Money::s(max(0, Money::p($p->paid_amount) - $amt));
                    PenaltyService::refresh($p);
                    $p->save();
                } elseif ($a->type === 'old_khata') {
                    $loan->old_khata_paid = Money::s(max(0, Money::p($loan->old_khata_paid) - $amt));
                    $loan->save();
                } elseif ($a->type === 'advance_deposit') {
                    LedgerService::advance($loan->customer_id, $loan->id, 'reversal', 0, $amt,
                        "Reversal of {$payment->receipt_no}", $today, $by->id, ['payment_id' => $payment->id]);
                    self::unapplyUntilNonNegative($loan, $today, $by->id);
                }
            }

            // customer ledger – mirror every credit of this payment as a reversal debit
            $orig = CustomerLedger::where('payment_id', $payment->id)->where('credit', '>', 0)->where('type', '!=', 'reversal')->get();
            foreach ($orig as $row) {
                LedgerService::customer($row->customer_id, $row->loan_account_id, 'reversal', Money::p($row->credit), 0,
                    "Reversal of {$payment->receipt_no}: {$reason}", $today, $by->id, ['payment_id' => $payment->id, 'reverses_id' => $row->id]);
            }

            CashService::post($payment->cash_location_id, 'reversal', 0, Money::p($payment->amount),
                "Reversal of {$payment->receipt_no}", $today, $by->id, ['payment_id' => $payment->id, 'loan_account_id' => $loan->id]);

            $payment->update(['status' => 'reversed', 'reversed_at' => now(), 'reversed_by' => $by->id, 'reversal_reason' => $reason]);
            Audit::log('payment.reversed', $payment, null, ['reason' => $reason, 'amount' => $payment->amount]);
            return $payment->fresh();
        }, 3);
    }

    /** After removing an advance deposit, undo advance applications (latest installment first) until balance >= 0. */
    private static function unapplyUntilNonNegative(LoanAccount $loan, string $today, int $userId): void
    {
        $bal = LedgerService::advanceBalance($loan->id);
        if ($bal >= 0) {
            return;
        }
        $installments = LoanInstallment::where('loan_account_id', $loan->id)->where('advance_applied', '>', 0)
            ->orderByDesc('number')->lockForUpdate()->get();
        foreach ($installments as $inst) {
            if ($bal >= 0) break;
            $undo = min(-$bal, Money::p($inst->advance_applied));
            $inst->paid_amount = Money::s(Money::p($inst->paid_amount) - $undo);
            $inst->advance_applied = Money::s(Money::p($inst->advance_applied) - $undo);
            $inst->refreshState();
            $inst->save();
            LedgerService::advance($loan->customer_id, $loan->id, 'reversal', $undo, 0,
                "Advance application undone on installment #{$inst->number}", $today, $userId, ['installment_id' => $inst->id]);
            $bal += $undo;
        }
    }
}

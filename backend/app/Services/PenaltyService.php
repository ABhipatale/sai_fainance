<?php

namespace App\Services;

use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\Penalty;
use App\Models\User;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Penalties are always entered manually – nothing here calculates them automatically. */
class PenaltyService
{
    public static function refresh(Penalty $p): void
    {
        if (in_array($p->status, ['waived', 'reversed'], true)) {
            return;
        }
        $out = max(0, Money::p($p->amount) - Money::p($p->paid_amount) - Money::p($p->waived_amount));
        $p->status = $out === 0 ? 'paid' : (Money::p($p->paid_amount) > 0 ? 'partial' : 'open');
    }

    public static function add(array $d, User $by): Penalty
    {
        return DB::transaction(function () use ($d, $by) {
            $loan = LoanAccount::whereKey($d['loan_account_id'])->lockForUpdate()->firstOrFail();
            $amt = Money::p($d['amount']);
            if ($amt <= 0) {
                throw ValidationException::withMessages(['amount' => ['Penalty must be greater than zero.']]);
            }
            $inst = null;
            if (!empty($d['installment_number'])) {
                $inst = LoanInstallment::where('loan_account_id', $loan->id)->where('number', $d['installment_number'])->first();
                if (!$inst) {
                    throw ValidationException::withMessages(['installment_number' => ['Installment not found.']]);
                }
            }
            $date = $d['penalty_date'] ?? now()->toDateString();
            $p = Penalty::create([
                'customer_id' => $loan->customer_id,
                'loan_account_id' => $loan->id,
                'installment_id' => $inst?->id,
                'installment_number' => $inst?->number,
                'amount' => Money::s($amt),
                'penalty_date' => $date,
                'reason' => $d['reason'] ?? null,
                'added_by' => $by->id,
            ]);
            LedgerService::customer($loan->customer_id, $loan->id, 'penalty', $amt, 0,
                'Penalty' . ($inst ? " (installment #{$inst->number})" : '') . ($p->reason ? ": {$p->reason}" : ''),
                $date, $by->id, ['penalty_id' => $p->id]);
            Audit::log('penalty.added', $p, null, $p->toArray());
            return $p;
        });
    }

    /** Edit is only possible before any collection/waiver happened. Ledger is corrected with an adjustment line. */
    public static function update(Penalty $penalty, array $d, User $by): Penalty
    {
        return DB::transaction(function () use ($penalty, $d, $by) {
            $p = Penalty::whereKey($penalty->id)->lockForUpdate()->firstOrFail();
            if ($p->status !== 'open' || Money::p($p->paid_amount) > 0) {
                throw ValidationException::withMessages(['penalty' => ['Penalty cannot be edited after collection.']]);
            }
            $old = $p->toArray();
            $newAmt = isset($d['amount']) ? Money::p($d['amount']) : Money::p($p->amount);
            if ($newAmt <= 0) {
                throw ValidationException::withMessages(['amount' => ['Penalty must be greater than zero.']]);
            }
            $diff = $newAmt - Money::p($p->amount);
            $p->amount = Money::s($newAmt);
            $p->reason = $d['reason'] ?? $p->reason;
            $p->penalty_date = $d['penalty_date'] ?? $p->penalty_date;
            $p->save();
            if ($diff !== 0) {
                LedgerService::customer($p->customer_id, $p->loan_account_id, 'adjustment', max(0, $diff), max(0, -$diff),
                    'Penalty amount corrected', now()->toDateString(), $by->id, ['penalty_id' => $p->id]);
            }
            Audit::log('penalty.updated', $p, $old, $p->toArray());
            return $p;
        });
    }

    public static function waive(Penalty $penalty, string $reason, User $by): Penalty
    {
        return DB::transaction(function () use ($penalty, $reason, $by) {
            $p = Penalty::whereKey($penalty->id)->lockForUpdate()->firstOrFail();
            $out = $p->outstandingPaise();
            if ($out <= 0) {
                throw ValidationException::withMessages(['penalty' => ['Nothing left to waive.']]);
            }
            $p->waived_amount = Money::s(Money::p($p->waived_amount) + $out);
            $p->status = Money::p($p->paid_amount) > 0 ? 'paid' : 'waived';
            $p->waived_by = $by->id;
            $p->waive_reason = $reason;
            $p->save();
            LedgerService::customer($p->customer_id, $p->loan_account_id, 'penalty_waiver', 0, $out,
                "Penalty waived: {$reason}", now()->toDateString(), $by->id, ['penalty_id' => $p->id]);
            Audit::log('penalty.waived', $p, null, ['amount' => Money::s($out), 'reason' => $reason]);
            return $p;
        });
    }

    /** Reverse an incorrect entry (only if nothing was collected against it). */
    public static function reverse(Penalty $penalty, string $reason, User $by): Penalty
    {
        return DB::transaction(function () use ($penalty, $reason, $by) {
            $p = Penalty::whereKey($penalty->id)->lockForUpdate()->firstOrFail();
            if (in_array($p->status, ['reversed', 'waived'], true) || Money::p($p->paid_amount) > 0) {
                throw ValidationException::withMessages(['penalty' => ['This penalty cannot be reversed.']]);
            }
            $out = $p->outstandingPaise();
            $p->status = 'reversed';
            $p->reversed_by = $by->id;
            $p->reverse_reason = $reason;
            $p->save();
            LedgerService::customer($p->customer_id, $p->loan_account_id, 'reversal', 0, $out,
                "Penalty entry reversed: {$reason}", now()->toDateString(), $by->id, ['penalty_id' => $p->id]);
            Audit::log('penalty.reversed', $p, null, ['reason' => $reason]);
            return $p;
        });
    }
}

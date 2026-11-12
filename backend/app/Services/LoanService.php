<?php

namespace App\Services;

use App\Models\CashLocation;
use App\Models\Customer;
use App\Models\Guarantor;
use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\User;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class LoanService
{
    public static function create(array $d, User $by): LoanAccount
    {
        $calc = LoanCalculator::preview($d);

        return DB::transaction(function () use ($d, $by, $calc) {
            $customer = Customer::whereKey($d['customer_id'])->lockForUpdate()->firstOrFail();

            $g1 = self::guarantorId($customer, $d['guarantor1_id'] ?? null);
            $g2 = self::guarantorId($customer, $d['guarantor2_id'] ?? null);

            $loan = LoanAccount::create([
                'khata_no' => Numbers::khata(),
                'customer_id' => $customer->id,
                'start_date' => $d['start_date'] ?? $d['disbursement_date'] ?? now()->toDateString(),
                'disbursement_date' => $d['disbursement_date'] ?? now()->toDateString(),
                'principal_amount' => $calc['principal_amount'],
                'total_repayment' => $calc['total_repayment'],
                'installments_count' => $calc['installments_count'],
                'weekly_amount' => $calc['weekly_amount'],
                'installment_weekday' => $calc['installment_weekday'],
                'first_installment_date' => $calc['first_installment_date'],
                'processing_charges' => $calc['processing_charges'],
                'additional_charges' => $calc['additional_charges'],
                'old_khata_outstanding' => $calc['old_khata_outstanding'],
                'guarantor1_id' => $g1,
                'guarantor2_id' => $g2,
                'disbursed_from_location_id' => $d['cash_location_id'] ?? null,
                'notes' => $d['notes'] ?? null,
                'created_by' => $by->id,
            ]);

            foreach ($calc['schedule'] as $row) {
                LoanInstallment::create([
                    'loan_account_id' => $loan->id,
                    'number' => $row['number'],
                    'due_date' => $row['due_date'],
                    'expected_amount' => $row['amount'],
                ]);
            }

            $date = $loan->disbursement_date->toDateString();
            LedgerService::customer($customer->id, $loan->id, 'loan_disbursement', Money::p($calc['total_repayment']), 0,
                "Loan {$loan->khata_no}: principal ₹{$calc['principal_amount']}, repayment ₹{$calc['total_repayment']} in {$calc['installments_count']} weeks",
                $date, $by->id);

            $old = Money::p($calc['old_khata_outstanding']);
            if ($old > 0) {
                // kept as a separate, traceable receivable – NOT merged into the new principal
                LedgerService::customer($customer->id, $loan->id, 'old_khata', $old, 0,
                    "Old khata balance carried to {$loan->khata_no}", $date, $by->id);
            }

            if (!empty($d['cash_location_id'])) {
                $loc = CashLocation::findOrFail($d['cash_location_id']);
                $net = Money::p($calc['net_disbursed']);
                if ($net > 0) {
                    CashService::post($loc->id, 'disbursement', 0, $net, "Loan disbursed – {$loan->khata_no}", $date, $by->id, ['loan_account_id' => $loan->id]);
                }
            }

            Audit::log('loan.created', $loan, null, $loan->toArray());
            return $loan->fresh(['installments']);
        });
    }

    private static function guarantorId(Customer $customer, mixed $id): ?int
    {
        if (!$id) {
            return null;
        }
        if (!Guarantor::where('customer_id', $customer->id)->whereKey($id)->exists()) {
            throw ValidationException::withMessages(['guarantor1_id' => ['Guarantor does not belong to this customer.']]);
        }
        return (int) $id;
    }

    /**
     * Close a khata. Full close needs zero outstanding. An authorised settlement (admin) writes off the rest.
     * Unused advance must be refunded (cash location required) before closing.
     */
    public static function close(LoanAccount $loan, array $d, User $by): LoanAccount
    {
        return DB::transaction(function () use ($loan, $d, $by) {
            $loan = LoanAccount::whereKey($loan->id)->lockForUpdate()->firstOrFail();
            if ($loan->status === 'closed') {
                throw ValidationException::withMessages(['loan' => ['Khata is already closed.']]);
            }
            // advance on account first settles any unpaid installments (even future ones) before closing
            AdvanceService::applyDue($loan, '2999-12-31', $by->id);
            $m = LoanMetrics::format(LoanMetrics::query()->whereKey($loan->id)->first());
            $settlement = (bool) ($d['settlement'] ?? false);
            $today = now()->toDateString();

            if (!$m['can_close'] && !$settlement) {
                throw ValidationException::withMessages(['loan' => ['Outstanding balance must be zero, or an authorised settlement is required.']]);
            }
            if ($settlement && !$by->isAdmin()) {
                throw ValidationException::withMessages(['settlement' => ['Only an admin can authorise a settlement.']]);
            }

            $advance = LedgerService::advanceBalance($loan->id);
            if ($advance > 0) {
                if (empty($d['refund_location_id'])) {
                    throw ValidationException::withMessages(['refund_location_id' => ['Advance balance must be refunded before closing – select a cash location.']]);
                }
                AdvanceService::refund($loan, Money::s($advance), (int) $d['refund_location_id'], $by, 'Refund at closing');
            }

            if (!$m['can_close']) {
                $written = 0;
                foreach ($loan->installments()->lockForUpdate()->get() as $i) {
                    $r = $i->remainingPaise();
                    if ($r > 0) {
                        $i->waived_amount = Money::s(Money::p($i->waived_amount) + $r);
                        $i->refreshState();
                        $i->save();
                        $written += $r;
                    }
                }
                $loan->penalties()->whereIn('status', ['open', 'partial'])->get()->each(function ($p) use ($by, &$written, $loan) {
                    $out = $p->outstandingPaise();
                    $p->waived_amount = Money::s(Money::p($p->waived_amount) + $out);
                    PenaltyService::refresh($p);
                    $p->status = Money::p($p->paid_amount) > 0 ? 'paid' : 'waived';
                    $p->waived_by = $by->id;
                    $p->waive_reason = 'Settlement at closing';
                    $p->save();
                    $written += $out;
                });
                $old = max(0, Money::p($loan->old_khata_outstanding) - Money::p($loan->old_khata_paid));
                $written += $old;
                $loan->old_khata_paid = $loan->old_khata_outstanding;
                if ($written > 0) {
                    LedgerService::customer($loan->customer_id, $loan->id, 'adjustment', 0, $written,
                        'Settlement write-off at closing: ' . ($d['note'] ?? ''), $today, $by->id);
                }
            }

            $loan->update([
                'status' => 'closed', 'closed_at' => now(), 'closed_by' => $by->id,
                'close_type' => $m['can_close'] ? 'full' : 'settlement', 'close_note' => $d['note'] ?? null,
            ]);
            Audit::log('loan.closed', $loan, null, ['type' => $loan->close_type, 'note' => $d['note'] ?? null]);
            return $loan->fresh();
        });
    }
}

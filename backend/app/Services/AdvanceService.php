<?php

namespace App\Services;

use App\Models\CashLocation;
use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\User;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AdvanceService
{
    /**
     * Apply existing advance balance to installments that are due (due_date <= $asOf), oldest first.
     * Applying advance never creates cash – it only moves money already collected (and counted once).
     * Call inside a transaction with the loan row locked.
     */
    public static function applyDue(LoanAccount $loan, string $asOf, ?int $userId = null): int
    {
        $bal = LedgerService::advanceBalance($loan->id);
        if ($bal <= 0) {
            return 0;
        }
        $applied = 0;
        $installments = LoanInstallment::where('loan_account_id', $loan->id)
            ->where('due_date', '<=', $asOf)->whereIn('state', ['open', 'partial'])
            ->orderBy('number')->lockForUpdate()->get();

        foreach ($installments as $inst) {
            if ($bal <= 0) {
                break;
            }
            $take = min($bal, $inst->remainingPaise());
            if ($take <= 0) {
                continue;
            }
            $inst->paid_amount = Money::s(Money::p($inst->paid_amount) + $take);
            $inst->advance_applied = Money::s(Money::p($inst->advance_applied) + $take);
            $inst->refreshState();
            $inst->save();

            LedgerService::advance($loan->customer_id, $loan->id, 'applied', 0, $take,
                "Advance applied to installment #{$inst->number}", $asOf, $userId, ['installment_id' => $inst->id]);
            LedgerService::customer($loan->customer_id, $loan->id, 'advance_applied', 0, 0,
                "Advance ₹" . Money::s($take) . " applied to installment #{$inst->number}", $asOf, $userId);
            $bal -= $take;
            $applied += $take;
        }
        return $applied;
    }

    /** Return unused advance to the customer from a cash location. */
    public static function refund(LoanAccount $loan, string $amount, int $locationId, User $by, ?string $note = null): void
    {
        $amt = Money::p($amount);
        DB::transaction(function () use ($loan, $amt, $locationId, $by, $note) {
            $loan = LoanAccount::whereKey($loan->id)->lockForUpdate()->firstOrFail();
            if ($amt <= 0 || $amt > LedgerService::advanceBalance($loan->id)) {
                throw ValidationException::withMessages(['amount' => ['Refund exceeds advance balance.']]);
            }
            $loc = CashLocation::findOrFail($locationId);
            $today = now()->toDateString();
            LedgerService::advance($loan->customer_id, $loan->id, 'refund', 0, $amt, $note ?: 'Advance refund', $today, $by->id);
            // the refunded advance had been counted as a credit when deposited; the refund puts it back on the customer's account
            LedgerService::customer($loan->customer_id, $loan->id, 'refund', $amt, 0, 'Advance refund', $today, $by->id);
            CashService::post($loc->id, 'refund', 0, $amt, "Advance refund – {$loan->khata_no}", $today, $by->id, ['loan_account_id' => $loan->id]);
            Audit::log('advance.refund', $loan, null, ['amount' => Money::s($amt), 'location' => $loc->id]);
        });
    }
}

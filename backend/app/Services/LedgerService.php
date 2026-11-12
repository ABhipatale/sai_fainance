<?php

namespace App\Services;

use App\Models\AdvanceLedger;
use App\Models\CustomerLedger;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/** Append-only ledgers. Must be called inside a DB transaction (uses row locks for running balances). */
class LedgerService
{
    public static function customer(int $customerId, ?int $loanId, string $type, int $debit, int $credit, string $desc, string $date, ?int $userId, array $refs = []): CustomerLedger
    {
        DB::table('customers')->where('id', $customerId)->lockForUpdate()->first();
        $last = CustomerLedger::where('customer_id', $customerId)->orderByDesc('id')->value('balance');
        $balance = Money::p($last) + $debit - $credit;

        return CustomerLedger::create([
            'customer_id' => $customerId,
            'loan_account_id' => $loanId,
            'entry_date' => $date,
            'type' => $type,
            'debit' => Money::s($debit),
            'credit' => Money::s($credit),
            'balance' => Money::s($balance),
            'description' => $desc,
            'created_by' => $userId,
            'payment_id' => $refs['payment_id'] ?? null,
            'penalty_id' => $refs['penalty_id'] ?? null,
            'reverses_id' => $refs['reverses_id'] ?? null,
        ]);
    }

    public static function advanceBalance(int $loanId): int
    {
        $r = DB::table('advance_ledger')->where('loan_account_id', $loanId)
            ->selectRaw('coalesce(sum(credit),0) as c, coalesce(sum(debit),0) as d')->first();
        return Money::p($r->c) - Money::p($r->d);
    }

    /** $credit adds to advance, $debit reduces it. */
    public static function advance(int $customerId, int $loanId, string $type, int $credit, int $debit, string $desc, string $date, ?int $userId, array $refs = []): AdvanceLedger
    {
        $balance = self::advanceBalance($loanId) + $credit - $debit;

        return AdvanceLedger::create([
            'customer_id' => $customerId,
            'loan_account_id' => $loanId,
            'entry_date' => $date,
            'type' => $type,
            'credit' => Money::s($credit),
            'debit' => Money::s($debit),
            'balance' => Money::s($balance),
            'payment_id' => $refs['payment_id'] ?? null,
            'installment_id' => $refs['installment_id'] ?? null,
            'description' => $desc,
            'created_by' => $userId,
        ]);
    }
}

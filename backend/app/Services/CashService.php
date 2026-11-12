<?php

namespace App\Services;

use App\Models\CashLedger;
use App\Models\CashLocation;
use App\Models\CashTransfer;
use App\Models\User;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CashService
{
    /** Post a ledger line and update the cached balance atomically (row-locked). */
    public static function post(int $locationId, string $type, int $inflow, int $outflow, string $desc, string $date, ?int $userId, array $refs = []): CashLedger
    {
        $loc = CashLocation::whereKey($locationId)->lockForUpdate()->firstOrFail();
        $balance = Money::p($loc->current_balance) + $inflow - $outflow;

        $entry = CashLedger::create([
            'cash_location_id' => $locationId,
            'entry_date' => $date,
            'type' => $type,
            'inflow' => Money::s($inflow),
            'outflow' => Money::s($outflow),
            'balance' => Money::s($balance),
            'description' => $desc,
            'created_by' => $userId,
            'payment_id' => $refs['payment_id'] ?? null,
            'cash_transfer_id' => $refs['cash_transfer_id'] ?? null,
            'expense_id' => $refs['expense_id'] ?? null,
            'loan_account_id' => $refs['loan_account_id'] ?? null,
        ]);
        $loc->update(['current_balance' => Money::s($balance)]);
        return $entry;
    }

    public static function createLocation(array $d, User $by): CashLocation
    {
        return DB::transaction(function () use ($d, $by) {
            $opening = Money::p($d['opening_balance'] ?? 0);
            $loc = CashLocation::create([
                'name' => $d['name'],
                'type' => $d['type'],
                'responsible_user_id' => $d['responsible_user_id'] ?? null,
                'opening_balance' => Money::s($opening),
                'current_balance' => '0.00',
                'status' => $d['status'] ?? 'active',
                'notes' => $d['notes'] ?? null,
            ]);
            if ($opening !== 0) {
                self::post($loc->id, 'opening', max(0, $opening), max(0, -$opening), 'Opening balance', now()->toDateString(), $by->id);
            }
            if ($loc->type === 'recovery_cash' && $loc->responsible_user_id) {
                User::whereKey($loc->responsible_user_id)->update(['cash_location_id' => $loc->id]);
            }
            Audit::log('cash_location.created', $loc, null, $loc->toArray());
            return $loc->fresh();
        });
    }

    /** Moves money between two locations – total company cash is unchanged. */
    public static function transfer(array $d, User $by): CashTransfer
    {
        $amount = Money::p($d['amount']);
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => ['Amount must be greater than zero.']]);
        }
        if ((int) $d['from_location_id'] === (int) $d['to_location_id']) {
            throw ValidationException::withMessages(['to_location_id' => ['Source and destination must differ.']]);
        }

        return DB::transaction(function () use ($d, $by, $amount) {
            // lock both rows in id order to avoid deadlocks
            $ids = [(int) $d['from_location_id'], (int) $d['to_location_id']];
            sort($ids);
            foreach ($ids as $id) {
                CashLocation::whereKey($id)->lockForUpdate()->firstOrFail();
            }
            $from = CashLocation::findOrFail($d['from_location_id']);
            $to = CashLocation::findOrFail($d['to_location_id']);
            if ($from->status !== 'active' || $to->status !== 'active') {
                throw ValidationException::withMessages(['from_location_id' => ['Inactive cash location.']]);
            }
            if (Money::p($from->current_balance) < $amount) {
                throw ValidationException::withMessages(['amount' => ['Insufficient balance in source location.']]);
            }
            $date = $d['transfer_date'] ?? now()->toDateString();

            $t = CashTransfer::create([
                'from_location_id' => $from->id, 'to_location_id' => $to->id, 'amount' => Money::s($amount),
                'transfer_date' => $date, 'notes' => $d['notes'] ?? null, 'created_by' => $by->id,
            ]);
            self::post($from->id, 'transfer_out', 0, $amount, "Transfer to {$to->name}", $date, $by->id, ['cash_transfer_id' => $t->id]);
            self::post($to->id, 'transfer_in', $amount, 0, "Transfer from {$from->name}", $date, $by->id, ['cash_transfer_id' => $t->id]);
            Audit::log('cash.transfer', $t, null, $t->toArray());
            return $t;
        });
    }

    /** Locations the user may receive a payment into. */
    public static function allowedForCollection(User $u)
    {
        $q = CashLocation::where('status', 'active')->orderBy('name');
        if ($u->isRecovery()) {
            $q->where(fn ($w) => $w->where('id', $u->cash_location_id ?: 0)->orWhere('type', 'bank_account'));
        }
        return $q->get();
    }
}

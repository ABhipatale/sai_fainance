<?php

namespace App\Services;

use App\Models\AdvanceLedger;
use App\Models\CashLedger;
use App\Models\CashLocation;
use App\Models\CashTransfer;
use App\Models\CustomerLedger;
use App\Models\Payment;
use App\Models\Penalty;
use App\Models\User;
use App\Support\Money;
use App\Support\Scope;
use Illuminate\Support\Collection;

/**
 * Every report returns ['columns' => [key,...], 'rows' => [[...assoc]], 'totals' => assoc|null].
 * Column keys are translated on the frontend (reports.col.<key>).
 */
class ReportService
{
    public const KEYS = [
        'daily-collection', 'weekly-collection', 'monthly-collection', 'pending', 'loan-disbursement',
        'loan-outstanding', 'advance-balance', 'penalty', 'recovery-staff', 'cash-location', 'cash-transfer',
        'customer-ledger', 'closed-khata', 'overdue',
    ];

    public static function run(string $key, array $f, User $u): array
    {
        $from = $f['from'] ?? now()->toDateString();
        $to = $f['to'] ?? $from;
        return match ($key) {
            'daily-collection' => self::collection($f + [], $u, $f['date'] ?? $from, $f['date'] ?? $from, 'date'),
            'weekly-collection' => self::collection($f, $u, $f['from'] ?? now()->startOfWeek()->toDateString(), $f['to'] ?? now()->endOfWeek()->toDateString(), 'date'),
            'monthly-collection' => self::collection($f, $u, $f['from'] ?? now()->startOfMonth()->toDateString(), $f['to'] ?? now()->endOfMonth()->toDateString(), 'date'),
            'pending' => self::pending($f, $u, false),
            'overdue' => self::pending($f, $u, true),
            'loan-disbursement' => self::disbursement($f, $u),
            'loan-outstanding' => self::outstanding($f, $u),
            'advance-balance' => self::advance($f, $u),
            'penalty' => self::penalty($f, $u),
            'recovery-staff' => self::staff($f, $u, $from, $to),
            'cash-location' => self::cash($f, $from, $to),
            'cash-transfer' => self::transfers($f, $from, $to),
            'customer-ledger' => self::ledger($f, $u, $from, $to),
            'closed-khata' => self::closed($f, $u),
            default => abort(404, 'Unknown report'),
        };
    }

    private static function out(array $cols, Collection|array $rows, ?array $totals = null): array
    {
        return ['columns' => $cols, 'rows' => collect($rows)->values()->all(), 'totals' => $totals];
    }

    private static function collection(array $f, User $u, string $from, string $to, string $x): array
    {
        $q = Payment::with(['customer:id,name,mobile', 'loan:id,khata_no', 'cashLocation:id,name', 'collector:id,name'])
            ->where('status', 'completed')->whereBetween('payment_date', [$from, $to]);
        if ($u->isRecovery()) $q->where('collected_by', $u->id);
        elseif (!$u->isAdmin()) $q->whereIn('customer_id', Scope::customerIds($u));
        foreach (['customer_id', 'collected_by', 'cash_location_id', 'payment_type'] as $k) {
            if (!empty($f[$k])) $q->where($k, $f[$k]);
        }
        $rows = $q->orderBy('payment_date')->orderBy('id')->get();
        return self::out(
            ['date', 'receipt_no', 'customer', 'khata_no', 'payment_type', 'cash_location', 'collected_by', 'amount'],
            $rows->map(fn ($p) => [
                'date' => $p->payment_date->toDateString(), 'receipt_no' => $p->receipt_no, 'customer' => $p->customer?->name,
                'khata_no' => $p->loan?->khata_no, 'payment_type' => $p->payment_type, 'cash_location' => $p->cashLocation?->name,
                'collected_by' => $p->collector?->name, 'amount' => $p->amount,
            ]),
            ['amount' => Money::s($rows->sum(fn ($p) => Money::p($p->amount))), 'count' => $rows->count()]
        );
    }

    private static function loanRows(array $f, User $u, ?string $status = 'active')
    {
        $q = Scope::loans(LoanMetrics::query(), $u)->with(['customer.address', 'customer.assignment.recovery']);
        if ($status) $q->where('loan_accounts.status', $status);
        if (!empty($f['customer_id'])) $q->where('loan_accounts.customer_id', $f['customer_id']);
        return $q->orderBy('loan_accounts.id')->get();
    }

    private static function pending(array $f, User $u, bool $overdueOnly): array
    {
        $rows = self::loanRows($f, $u)->map(fn ($l) => [$l, LoanMetrics::format($l)])
            ->filter(fn ($x) => Money::p($x[1][$overdueOnly ? 'net_overdue' : 'net_due_now']) > 0)
            ->sortBy(fn ($x) => $x[1]['remaining_installments'])->values();
        return self::out(
            ['customer', 'mobile', 'village', 'khata_no', 'remaining_installments', 'pending_amount', 'overdue_amount', 'advance_balance', 'next_due_date'],
            $rows->map(fn ($x) => [
                'customer' => $x[0]->customer?->name, 'mobile' => $x[0]->customer?->mobile, 'village' => $x[0]->customer?->address?->village,
                'khata_no' => $x[0]->khata_no, 'remaining_installments' => $x[1]['remaining_installments'],
                'pending_amount' => $x[1]['net_due_now'], 'overdue_amount' => $x[1]['net_overdue'],
                'advance_balance' => $x[1]['advance_balance'], 'next_due_date' => $x[1]['next_due_date'],
            ]),
            ['pending_amount' => Money::s($rows->sum(fn ($x) => Money::p($x[1]['net_due_now']))), 'overdue_amount' => Money::s($rows->sum(fn ($x) => Money::p($x[1]['net_overdue'])))]
        );
    }

    private static function disbursement(array $f, User $u): array
    {
        $q = Scope::loans(\App\Models\LoanAccount::query(), $u)->with('customer:id,name,mobile');
        if (!empty($f['from'])) $q->where('disbursement_date', '>=', $f['from']);
        if (!empty($f['to'])) $q->where('disbursement_date', '<=', $f['to']);
        if (!empty($f['customer_id'])) $q->where('customer_id', $f['customer_id']);
        $rows = $q->orderBy('disbursement_date')->get();
        return self::out(
            ['date', 'khata_no', 'customer', 'principal', 'total_repayment', 'finance_charges', 'installments', 'weekly_amount', 'processing_charges'],
            $rows->map(fn ($l) => [
                'date' => $l->disbursement_date->toDateString(), 'khata_no' => $l->khata_no, 'customer' => $l->customer?->name,
                'principal' => $l->principal_amount, 'total_repayment' => $l->total_repayment,
                'finance_charges' => Money::s(Money::p($l->total_repayment) - Money::p($l->principal_amount)),
                'installments' => $l->installments_count, 'weekly_amount' => $l->weekly_amount, 'processing_charges' => $l->processing_charges,
            ]),
            ['principal' => Money::s($rows->sum(fn ($l) => Money::p($l->principal_amount))), 'total_repayment' => Money::s($rows->sum(fn ($l) => Money::p($l->total_repayment)))]
        );
    }

    private static function outstanding(array $f, User $u): array
    {
        $rows = self::loanRows($f, $u)->map(fn ($l) => [$l, LoanMetrics::format($l)]);
        return self::out(
            ['khata_no', 'customer', 'total_repayment', 'total_paid', 'remaining_installments', 'penalty_outstanding', 'old_khata_remaining', 'advance_balance', 'total_outstanding'],
            $rows->map(fn ($x) => [
                'khata_no' => $x[0]->khata_no, 'customer' => $x[0]->customer?->name, 'total_repayment' => $x[1]['total_repayment'],
                'total_paid' => $x[1]['total_paid'], 'remaining_installments' => $x[1]['remaining_installments'],
                'penalty_outstanding' => $x[1]['penalty_outstanding'], 'old_khata_remaining' => $x[1]['old_khata_remaining'],
                'advance_balance' => $x[1]['advance_balance'], 'total_outstanding' => $x[1]['total_outstanding'],
            ]),
            ['total_outstanding' => Money::s($rows->sum(fn ($x) => Money::p($x[1]['total_outstanding'])))]
        );
    }

    private static function advance(array $f, User $u): array
    {
        $rows = self::loanRows($f, $u)->map(fn ($l) => [$l, LoanMetrics::format($l)])->filter(fn ($x) => Money::p($x[1]['advance_balance']) > 0);
        return self::out(['customer', 'khata_no', 'advance_balance', 'next_due_date'],
            $rows->map(fn ($x) => ['customer' => $x[0]->customer?->name, 'khata_no' => $x[0]->khata_no, 'advance_balance' => $x[1]['advance_balance'], 'next_due_date' => $x[1]['next_due_date']]),
            ['advance_balance' => Money::s($rows->sum(fn ($x) => Money::p($x[1]['advance_balance'])))]);
    }

    private static function penalty(array $f, User $u): array
    {
        $q = Penalty::with(['customer:id,name', 'loan:id,khata_no', 'adder:id,name'])->whereIn('customer_id', Scope::customerIds($u));
        if (!empty($f['from'])) $q->where('penalty_date', '>=', $f['from']);
        if (!empty($f['to'])) $q->where('penalty_date', '<=', $f['to']);
        if (!empty($f['customer_id'])) $q->where('customer_id', $f['customer_id']);
        $rows = $q->orderBy('penalty_date')->get();
        return self::out(['date', 'customer', 'khata_no', 'installment_no', 'amount', 'paid_amount', 'waived_amount', 'status', 'reason', 'added_by'],
            $rows->map(fn ($p) => [
                'date' => $p->penalty_date->toDateString(), 'customer' => $p->customer?->name, 'khata_no' => $p->loan?->khata_no,
                'installment_no' => $p->installment_number, 'amount' => $p->amount, 'paid_amount' => $p->paid_amount,
                'waived_amount' => $p->waived_amount, 'status' => $p->status, 'reason' => $p->reason, 'added_by' => $p->adder?->name,
            ]),
            ['amount' => Money::s($rows->where('status', '!=', 'reversed')->sum(fn ($p) => Money::p($p->amount))), 'paid_amount' => Money::s($rows->sum(fn ($p) => Money::p($p->paid_amount)))]);
    }

    private static function staff(array $f, User $u, string $from, string $to): array
    {
        $staff = Scope::staff(User::query(), $u)->orderBy('name')->get();
        $rows = $staff->map(function ($s) use ($from, $to) {
            $p = Payment::where('collected_by', $s->id)->where('status', 'completed')->whereBetween('payment_date', [$from, $to]);
            return [
                'staff' => $s->name, 'area' => $s->assigned_area,
                'assigned_customers' => \App\Models\RecoveryAssignment::where('recovery_user_id', $s->id)->count(),
                'payments' => (clone $p)->count(), 'collected' => Money::s(Money::p((clone $p)->sum('amount'))),
                'cash_balance' => $s->cash_location_id ? CashLocation::find($s->cash_location_id)?->current_balance : null,
            ];
        });
        return self::out(['staff', 'area', 'assigned_customers', 'payments', 'collected', 'cash_balance'], $rows,
            ['collected' => Money::s($rows->sum(fn ($r) => Money::p($r['collected'])))]);
    }

    private static function cash(array $f, string $from, string $to): array
    {
        $locs = CashLocation::orderBy('name')->when(!empty($f['cash_location_id']), fn ($q) => $q->where('id', $f['cash_location_id']))->get();
        $rows = $locs->map(function ($l) use ($from, $to) {
            $opening = Money::p(CashLedger::where('cash_location_id', $l->id)->where('entry_date', '<', $from)->orderByDesc('id')->value('balance'));
            $r = CashLedger::where('cash_location_id', $l->id)->whereBetween('entry_date', [$from, $to]);
            $s = fn ($t, $c) => Money::p((clone $r)->where('type', $t)->sum($c));
            return [
                'location' => $l->name, 'type' => $l->type, 'opening' => Money::s($opening),
                'collection' => Money::s($s('collection', 'inflow') - $s('reversal', 'outflow')),
                'transfer_in' => Money::s($s('transfer_in', 'inflow')), 'transfer_out' => Money::s($s('transfer_out', 'outflow')),
                'expenses' => Money::s($s('expense', 'outflow')), 'disbursement' => Money::s($s('disbursement', 'outflow')),
                'closing' => Money::s(Money::p((CashLedger::where('cash_location_id', $l->id)->where('entry_date', '<=', $to)->orderByDesc('id')->value('balance')))),
            ];
        });
        return self::out(['location', 'type', 'opening', 'collection', 'transfer_in', 'transfer_out', 'expenses', 'disbursement', 'closing'], $rows,
            ['closing' => Money::s($rows->sum(fn ($r) => Money::p($r['closing'])))]);
    }

    private static function transfers(array $f, string $from, string $to): array
    {
        $rows = CashTransfer::with(['from:id,name', 'to:id,name', 'creator:id,name'])->whereBetween('transfer_date', [$from, $to])->orderBy('transfer_date')->get();
        return self::out(['date', 'from', 'to', 'amount', 'notes', 'created_by'],
            $rows->map(fn ($t) => ['date' => $t->transfer_date->toDateString(), 'from' => $t->from?->name, 'to' => $t->to?->name, 'amount' => $t->amount, 'notes' => $t->notes, 'created_by' => $t->creator?->name]),
            ['amount' => Money::s($rows->sum(fn ($t) => Money::p($t->amount)))]);
    }

    private static function ledger(array $f, User $u, string $from, string $to): array
    {
        abort_if(empty($f['customer_id']), 422, 'customer_id is required for the ledger report.');
        abort_unless(Scope::canSeeCustomer($u, (int) $f['customer_id']), 403);
        $rows = CustomerLedger::with(['creator:id,name', 'loan:id,khata_no'])->where('customer_id', $f['customer_id'])
            ->whereBetween('entry_date', [!empty($f['from']) ? $f['from'] : '1970-01-01', !empty($f['to']) ? $f['to'] : '2999-12-31'])->orderBy('id')->get();
        return self::out(['date', 'type', 'khata_no', 'debit', 'credit', 'balance', 'description', 'created_by'],
            $rows->map(fn ($e) => ['date' => $e->entry_date->toDateString(), 'type' => $e->type, 'khata_no' => $e->loan?->khata_no, 'debit' => $e->debit, 'credit' => $e->credit, 'balance' => $e->balance, 'description' => $e->description, 'created_by' => $e->creator?->name]),
            ['debit' => Money::s($rows->sum(fn ($e) => Money::p($e->debit))), 'credit' => Money::s($rows->sum(fn ($e) => Money::p($e->credit)))]);
    }

    private static function closed(array $f, User $u): array
    {
        $rows = self::loanRows($f, $u, 'closed');
        return self::out(['khata_no', 'customer', 'principal', 'total_repayment', 'closed_at', 'close_type', 'close_note'],
            $rows->map(fn ($l) => ['khata_no' => $l->khata_no, 'customer' => $l->customer?->name, 'principal' => $l->principal_amount, 'total_repayment' => $l->total_repayment, 'closed_at' => $l->closed_at?->toDateString(), 'close_type' => $l->close_type, 'close_note' => $l->close_note]),
            null);
    }
}

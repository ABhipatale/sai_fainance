<?php

namespace App\Http\Controllers\Api;

use App\Models\CashLocation;
use App\Models\FinanceSetting;
use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\OpeningBalance;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\User;
use App\Services\LoanMetrics;
use App\Support\Money;
use App\Support\Scope;
use Carbon\Carbon;
use Illuminate\Http\Request;

/** Every figure is computed from real rows – nothing is cached or hard-coded. */
class DashboardController extends ApiController
{
    public function index(Request $r)
    {
        $u = $this->user($r);
        $today = now();
        $t = $today->toDateString();
        $weekStart = $today->copy()->startOfWeek(Carbon::MONDAY)->toDateString();
        $collectDay = (int) FinanceSetting::get('collection_weekday', 2);
        $dow = $today->dayOfWeek;
        $mode = $dow === 1 ? 'monday' : ($dow === $collectDay ? 'collection' : 'after');

        $loans = Scope::loans(LoanMetrics::query($t), $u)->where('loan_accounts.status', 'active')->get();
        $m = $loans->map(fn ($l) => LoanMetrics::format($l));
        $sum = fn (string $k) => $m->sum(fn ($x) => Money::p($x[$k]));

        $pay = Payment::query()->where('status', 'completed');
        if ($u->isRecovery()) {
            $pay->where('collected_by', $u->id);
        } elseif (!$u->isAdmin()) {
            $pay->whereIn('customer_id', Scope::customerIds($u));
        }
        $todayCollection = Money::p((clone $pay)->where('payment_date', $t)->sum('amount'));
        $penaltyToday = Money::p(PaymentAllocation::where('type', 'penalty')
            ->whereIn('payment_id', (clone $pay)->where('payment_date', $t)->select('id'))->sum('amount'));

        $newLoans = Scope::loans(LoanAccount::query(), $u)->where('disbursement_date', '>=', $weekStart);
        $opening = OpeningBalance::where('week_date', $weekStart)->sum('opening_amount');

        $cards = [
            'active_khata' => $m->count(),
            'active_loan_amount' => Money::s($loans->sum(fn ($l) => Money::p($l->principal_amount))),
            'total_to_collect' => Money::s($sum('total_outstanding')),
            'total_collected' => Money::s(Money::p((clone $pay)->sum('amount'))),
            'total_pending' => Money::s($sum('net_due_now')),
            'total_overdue' => Money::s($sum('net_overdue')),
            'advance_balance' => Money::s($sum('advance_balance')),
            'today_collection' => Money::s($todayCollection),
            'monday_opening_balance' => $u->isRecovery() ? null : Money::s(Money::p($opening)),
            'new_disbursement' => Money::s((clone $newLoans)->get()->sum(fn ($l) => Money::p($l->principal_amount))),
            'today_penalty_collection' => Money::s($penaltyToday),
        ];

        $out = ['mode' => $mode, 'today' => $t, 'cards' => $cards];

        // --- Monday ---------------------------------------------------------------------------------
        $nextCollect = $today->copy();
        while ($nextCollect->dayOfWeek !== $collectDay) {
            $nextCollect->addDay();
        }
        $weeklyExpected = Money::p(LoanInstallment::whereIn('loan_account_id', $loans->pluck('id'))
            ->whereBetween('due_date', [$t, $nextCollect->toDateString()])->selectRaw('coalesce(sum(expected_amount - paid_amount - waived_amount),0) as s')->value('s'));

        // loans handed out in the current collection week (Tue → Mon) – the owner's Monday figure
        $wkStart = $today->copy()->startOfDay();
        while ($wkStart->dayOfWeek !== $collectDay) {
            $wkStart->subDay();
        }
        $given = Scope::loans(LoanAccount::query(), $u)->whereBetween('disbursement_date', [$wkStart->toDateString(), $wkStart->copy()->addDays(6)->toDateString()])->get();

        $locations = $u->isRecovery() ? collect() : CashLocation::where('status', 'active')->orderBy('name')->get();
        $out['monday'] = [
            'confirmed' => OpeningBalance::where('week_date', $weekStart)->exists(),
            'previous_closing' => Money::s($locations->sum(fn ($l) => Money::p($l->current_balance))),
            'cash_by_location' => $locations->map(fn ($l) => ['id' => $l->id, 'name' => $l->name, 'type' => $l->type, 'balance' => $l->current_balance]),
            'available_cash' => Money::s($locations->sum(fn ($l) => Money::p($l->current_balance))),
            'weekly_expected' => Money::s($weeklyExpected),
            'total_pending' => $cards['total_pending'],
            'next_collection_date' => $nextCollect->toDateString(),
            'loans_given' => [
                'week_start' => $wkStart->toDateString(), 'week_end' => $wkStart->copy()->addDays(6)->toDateString(), 'count' => $given->count(),
                'cash_given' => Money::s($given->sum(fn ($l) => Money::p($l->principal_amount) - Money::p($l->processing_charges) - Money::p($l->additional_charges))),
                'total_repayment' => Money::s($given->sum(fn ($l) => Money::p($l->total_repayment))),
            ],
        ];

        // --- Collection day -----------------------------------------------------------------------------
        $expectedToday = $sum('today_due');
        $out['collection'] = [
            'expected_today' => Money::s($expectedToday),
            'collected_today' => Money::s($todayCollection),
            'remaining_today' => $cards['total_pending'],
            'customers_paid' => $m->filter(fn ($x) => Money::p($x['paid_today']) > 0)->count(),
            'customers_pending' => $m->filter(fn ($x) => Money::p($x['net_due_now']) > 0)->count(),
            'missed_installments' => $m->filter(fn ($x) => Money::p($x['net_overdue']) > 0)->count(),
        ];

        // --- After collection day -----------------------------------------------------------------------
        $out['after'] = [
            'new_disbursements' => $cards['new_disbursement'],
            'pending_installments' => $m->filter(fn ($x) => Money::p($x['net_due_now']) > 0)->count(),
            'overdue_recovery' => $cards['total_overdue'],
            'advance_customers' => $m->filter(fn ($x) => Money::p($x['advance_balance']) > 0)->count(),
            'old_khata_outstanding' => Money::s($sum('old_khata_remaining')),
            'total_remaining_recovery' => $cards['total_to_collect'],
        ];

        // --- Recovery staff (targets / performance) ---------------------------------------------------
        if ($u->isRecovery()) {
            $out['staff'] = [UserController::performanceFor($u)];
        } else {
            $staff = Scope::staff(User::query(), $u)->where('status', 'active')->orderBy('name')->get();
            $out['staff'] = $staff->map(fn ($s) => UserController::performanceFor($s))->values();
        }

        return $this->ok($out);
    }
}

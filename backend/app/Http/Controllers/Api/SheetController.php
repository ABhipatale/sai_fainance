<?php

namespace App\Http\Controllers\Api;

use App\Models\FinanceSetting;
use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Services\LoanMetrics;
use App\Support\Money;
use App\Support\Present;
use App\Support\Scope;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Two "at a glance" screens for the owner:
 *  - sheet():  compact khata list (new khata at the bottom) with an optional Excel-like grid of every weekly installment
 *  - weekly(): everything that happened in one collection week (collection day → the day before the next one)
 */
class SheetController extends ApiController
{
    /** Compact, colour-coded list of all khata. Active by default; `status=closed` shows finished ones. */
    public function sheet(Request $r)
    {
        $u = $this->user($r);
        $status = $r->query('status') === 'closed' ? 'closed' : 'active';

        $loans = Scope::loans(LoanMetrics::query(), $u)->where('loan_accounts.status', $status)
            ->with(['customer.address', 'customer.assignment.recovery'])->get();

        $items = $loans->map(fn ($l) => Present::loan($l))->values();

        if ($v = $r->query('recovery_user_id')) {
            $items = $items->filter(fn ($c) => (int) ($c['customer']['recovery_user_id'] ?? 0) === (int) $v);
        }
        if ($v = trim((string) $r->query('village'))) {
            $items = $items->filter(fn ($c) => mb_strtolower($c['customer']['village'] ?? '') === mb_strtolower($v));
        }
        if ($s = mb_strtolower(trim((string) $r->query('q')))) {
            $items = $items->filter(fn ($c) => str_contains(mb_strtolower(($c['customer']['name'] ?? '') . ' ' . ($c['customer']['mobile'] ?? '') . ' ' . $c['khata_no']), $s));
        }

        // counts per colour are taken before the colour filter so the legend always shows every bucket
        $counts = $items->groupBy('tone')->map->count();
        if ($tone = $r->query('tone')) {
            $items = $items->filter(fn ($c) => $c['tone'] === $tone);
        }

        // oldest khata first … brand-new khata at the bottom; "fewest weeks left on top" is the default order
        $by = $r->query('sort', 'remaining');
        $dir = strtolower($r->query('dir', 'asc')) === 'desc' ? -1 : 1;
        $key = fn ($c) => match ($by) {
            'pending' => $c['pending_weeks'],
            'name' => mb_strtolower($c['customer']['name'] ?? ''),
            'village' => mb_strtolower($c['customer']['village'] ?? ''),
            'recent' => (string) $c['disbursement_date'],
            default => $c['remaining_installments'],
        };
        $items = $items->sort(function ($a, $b) use ($key, $dir) {
            return (($key($a) <=> $key($b)) * $dir)
                ?: (strcmp((string) $a['disbursement_date'], (string) $b['disbursement_date']) ?: $a['id'] <=> $b['id']);
        })->values();

        $maxWeeks = (int) ($items->max('installments_count') ?? 0);
        if ($r->boolean('grid') && $items->isNotEmpty()) {
            $today = now()->toDateString();
            $cells = LoanInstallment::whereIn('loan_account_id', $items->pluck('id'))->orderBy('number')->get()->groupBy('loan_account_id');
            $items = $items->map(function ($c) use ($cells, $today) {
                $c['weeks'] = ($cells[$c['id']] ?? collect())->map(fn ($i) => [
                    'n' => $i->number, 'due' => $i->due_date->toDateString(), 'status' => $i->displayStatus($today),
                    'expected' => $i->expected_amount, 'paid' => $i->paid_amount,
                ])->values();
                return $c;
            });
        }

        return response()->json([
            'success' => true,
            'data' => $items,
            'meta' => [
                'total' => $items->count(), 'max_weeks' => $maxWeeks, 'status' => $status,
                'tones' => ['green' => 0, 'yellow' => 0, 'orange' => 0, 'red' => 0, 'done' => 0] + $counts->all(),
                'pending_total' => Money::s($items->sum(fn ($c) => Money::p($c['net_due_now']))),
                'weekly_total' => Money::s($items->sum(fn ($c) => Money::p($c['weekly_amount']))),
            ],
        ]);
    }

    /** Collection weekday ≤ $d – the start of the week that contains $d. */
    private function weekStart(Carbon $d, int $day): Carbon
    {
        $d = $d->copy()->startOfDay();
        return $d->subDays(($d->dayOfWeek - $day + 7) % 7);
    }

    public function weekly(Request $r)
    {
        $u = $this->user($r);
        $day = (int) FinanceSetting::get('collection_weekday', 2);
        $start = $this->weekStart($r->filled('week_start') ? Carbon::parse($r->query('week_start')) : now(), $day);
        $end = $start->copy()->addDays(6);
        $s = $start->toDateString();
        $e = $end->toDateString();
        $customerIds = Scope::customerIds($u);

        // installments falling due inside the week, per khata
        $inst = LoanInstallment::query()
            ->join('loan_accounts', 'loan_accounts.id', '=', 'loan_installments.loan_account_id')
            ->whereBetween('loan_installments.due_date', [$s, $e])
            ->whereIn('loan_accounts.customer_id', $customerIds)
            ->selectRaw('loan_installments.loan_account_id as lid, sum(loan_installments.expected_amount) as due, sum(loan_installments.paid_amount) as paid, sum(loan_installments.expected_amount - loan_installments.paid_amount - loan_installments.waived_amount) as remaining, min(loan_installments.number) as num')
            ->groupBy('loan_installments.loan_account_id')->get()->keyBy('lid');

        // cash actually received inside the week (any purpose)
        $pay = Payment::query()->where('status', 'completed')->whereBetween('payment_date', [$s, $e])->whereIn('customer_id', $customerIds);
        $received = (clone $pay)->selectRaw('loan_account_id as lid, sum(amount) as amt')->groupBy('loan_account_id')->pluck('amt', 'lid');
        $payIds = (clone $pay)->select('id');
        $advDeposit = Money::p(PaymentAllocation::where('type', 'advance_deposit')->whereIn('payment_id', $payIds)->sum('amount'));
        $penaltyPaid = Money::p(PaymentAllocation::where('type', 'penalty')->whereIn('payment_id', $payIds)->sum('amount'));

        // khata given during the week (disbursement day is usually the day before collection day)
        $given = Scope::loans(LoanAccount::query(), $u)->whereBetween('disbursement_date', [$s, $e])->with('customer')->orderBy('disbursement_date')->orderBy('id')->get();
        $givenRows = $given->map(fn ($l) => [
            'id' => $l->id, 'khata_no' => $l->khata_no, 'customer_id' => $l->customer_id, 'customer_name' => $l->customer?->name,
            'disbursement_date' => $l->disbursement_date->toDateString(),
            'cash_given' => Money::s(Money::p($l->principal_amount) - Money::p($l->processing_charges) - Money::p($l->additional_charges)),
            'total_repayment' => $l->total_repayment, 'weekly_amount' => $l->weekly_amount, 'installments_count' => $l->installments_count,
            'first_installment_date' => $l->first_installment_date->toDateString(),
        ])->values();

        $ids = $inst->keys()->merge($received->keys())->unique()->values();
        $loans = $ids->isEmpty() ? collect() : Scope::loans(LoanMetrics::query(), $u)->whereIn('loan_accounts.id', $ids)
            ->with(['customer.address', 'customer.assignment.recovery'])->get();

        $rows = $loans->map(function ($l) use ($inst, $received) {
            $c = Present::loan($l);
            $i = $inst[$l->id] ?? null;
            $due = $i ? Money::p($i->due) : 0;
            $left = $i ? max(0, Money::p($i->remaining)) : 0;
            $c['week'] = [
                'due' => Money::s($due),
                'paid' => Money::s(max(0, $due - $left)),
                'remaining' => Money::s($left),
                'received' => Money::s(Money::p($received[$l->id] ?? 0)),
                'installment_no' => $i?->num,
                'state' => $due === 0 ? 'none' : ($left === 0 ? 'paid' : ($left < $due ? 'partial' : 'pending')),
            ];
            return $c;
        });

        $filter = $r->query('filter', 'all');
        if ($filter === 'pending') {
            $rows = $rows->filter(fn ($c) => in_array($c['week']['state'], ['pending', 'partial'], true));
        } elseif ($filter === 'paid') {
            $rows = $rows->filter(fn ($c) => $c['week']['state'] === 'paid' || Money::p($c['week']['received']) > 0);
        }
        if ($sq = mb_strtolower(trim((string) $r->query('q')))) {
            $rows = $rows->filter(fn ($c) => str_contains(mb_strtolower(($c['customer']['name'] ?? '') . ' ' . $c['khata_no']), $sq));
        }
        // customers still owing this week first, then by weeks left (fewest first)
        $order = ['pending' => 0, 'partial' => 1, 'paid' => 2, 'none' => 3];
        $rows = $rows->sort(fn ($a, $b) => ($order[$a['week']['state']] <=> $order[$b['week']['state']])
            ?: ($a['remaining_installments'] <=> $b['remaining_installments']) ?: ($a['id'] <=> $b['id']))->values();

        $all = $loans->map(fn ($l) => $inst[$l->id] ?? null)->filter();
        $dueTotal = $all->sum(fn ($i) => Money::p($i->due));
        $leftTotal = $all->sum(fn ($i) => max(0, Money::p($i->remaining)));
        // still unpaid from weeks before this one (not part of this week's own due)
        $carry = Money::p(LoanInstallment::query()
            ->join('loan_accounts', 'loan_accounts.id', '=', 'loan_installments.loan_account_id')
            ->where('loan_accounts.status', 'active')->whereIn('loan_accounts.customer_id', $customerIds)
            ->where('loan_installments.due_date', '<', $s)
            ->sum(DB::raw('loan_installments.expected_amount - loan_installments.paid_amount - loan_installments.waived_amount')));

        return response()->json([
            'success' => true,
            'data' => $rows,
            'summary' => [
                'expected' => Money::s($dueTotal),
                'collected' => Money::s(Money::p((clone $pay)->sum('amount'))),
                'pending' => Money::s($leftTotal),
                'carry_pending' => Money::s($carry),
                'advance_deposited' => Money::s($advDeposit),
                'penalty_collected' => Money::s($penaltyPaid),
                'khata_due' => $all->count(),
                'khata_paid' => $loans->filter(fn ($l) => ($i = $inst[$l->id] ?? null) && max(0, Money::p($i->remaining)) === 0)->count(),
                'khata_pending' => $loans->filter(fn ($l) => ($i = $inst[$l->id] ?? null) && max(0, Money::p($i->remaining)) > 0)->count(),
                'loans_given_count' => $given->count(),
                'loans_given_cash' => Money::s($givenRows->sum(fn ($g) => Money::p($g['cash_given']))),
                'loans_given_repayment' => Money::s($givenRows->sum(fn ($g) => Money::p($g['total_repayment']))),
            ],
            'loans_given' => $givenRows,
            'week' => [
                'start' => $s, 'end' => $e, 'prev' => $start->copy()->subWeek()->toDateString(), 'next' => $start->copy()->addWeek()->toDateString(),
                'is_current' => $this->weekStart(now(), $day)->toDateString() === $s, 'weekday' => $day,
            ],
        ]);
    }
}

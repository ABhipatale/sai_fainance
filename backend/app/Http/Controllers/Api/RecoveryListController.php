<?php

namespace App\Http\Controllers\Api;

use App\Models\FinanceSetting;
use App\Services\LoanMetrics;
use App\Support\Money;
use App\Support\Present;
use App\Support\Scope;
use Illuminate\Http\Request;

/**
 * Pending / overdue / collection lists. Loan rows come from one set-based SQL query and are filtered
 * and sorted in memory so the sort order stays fully configurable.
 */
class RecoveryListController extends ApiController
{
    private function base(Request $r)
    {
        $u = $this->user($r);
        return Scope::loans(LoanMetrics::query(), $u)->where('loan_accounts.status', 'active')
            ->with(['customer.address', 'customer.assignment.recovery'])->get()
            ->map(fn ($l) => ['row' => $l, 'card' => Present::loan($l)]);
    }

    private function sortAndPage($items, Request $r)
    {
        $def = FinanceSetting::get('pending_sort', ['by' => 'remaining_installments', 'dir' => 'asc']);
        $by = $r->query('sort', $def['by']);
        $dir = strtolower($r->query('dir', $def['dir'])) === 'desc' ? -1 : 1;

        $key = fn ($i) => match ($by) {
            'overdue_amount' => Money::p($i['card']['overdue_amount']),
            'pending_amount' => Money::p($i['card']['net_due_now']),
            'next_due_date' => (string) $i['card']['next_due_date'],
            'name' => mb_strtolower($i['card']['customer']['name'] ?? ''),
            'village' => mb_strtolower($i['card']['customer']['village'] ?? ''),
            default => $i['card']['remaining_installments'],
        };
        $items = $items->sort(function ($a, $b) use ($key, $dir) {
            $x = $key($a); $y = $key($b);
            return ($x <=> $y) * $dir ?: strcmp($a['card']['customer']['name'] ?? '', $b['card']['customer']['name'] ?? '');
        })->values();

        $per = $this->perPage($r, 30);
        $page = max(1, (int) $r->query('page', 1));
        return [
            'success' => true,
            'data' => $items->slice(($page - 1) * $per, $per)->pluck('card')->values(),
            'meta' => ['page' => $page, 'per_page' => $per, 'total' => $items->count(), 'last_page' => (int) max(1, ceil($items->count() / $per))],
        ];
    }

    private function filter($items, Request $r, string $filter)
    {
        $items = $items->filter(function ($i) use ($filter) {
            $c = $i['card'];
            return match ($filter) {
                'pending' => Money::p($c['net_due_now']) > 0,
                'overdue' => Money::p($c['net_overdue']) > 0,
                'partial' => Money::p($i['row']->m_inst_paid) > 0 && Money::p($c['net_due_now']) > 0 && $this->partialExists($i['row']),
                'advance' => Money::p($c['advance_balance']) > 0,
                'today' => Money::p($c['today_due']) > 0,
                default => true,
            };
        });
        if ($v = $r->query('recovery_user_id')) {
            $items = $items->filter(fn ($i) => (int) ($i['card']['customer']['recovery_user_id'] ?? 0) === (int) $v);
        }
        if ($v = $r->query('village')) {
            $items = $items->filter(fn ($i) => mb_strtolower($i['card']['customer']['village'] ?? '') === mb_strtolower($v));
        }
        if ($v = $r->query('remaining_installments')) {
            $items = $items->filter(fn ($i) => $i['card']['remaining_installments'] == $v);
        }
        if ($s = mb_strtolower(trim((string) $r->query('q')))) {
            $items = $items->filter(fn ($i) => str_contains(mb_strtolower(($i['card']['customer']['name'] ?? '') . ' ' . ($i['card']['customer']['mobile'] ?? '') . ' ' . $i['card']['khata_no']), $s));
        }
        return $items->values();
    }

    private array $partialCache = [];

    private function partialExists($row): bool
    {
        return $this->partialCache[$row->id] ??= \App\Models\LoanInstallment::where('loan_account_id', $row->id)->where('state', 'partial')->exists();
    }

    public function pending(Request $r)
    {
        $filter = $r->query('filter', 'pending');
        $items = $this->filter($this->base($r), $r, $filter);
        $res = $this->sortAndPage($items, $r);
        $res['meta']['pending_total'] = Money::s($items->sum(fn ($i) => Money::p($i['card']['net_due_now'])));
        $res['meta']['overdue_total'] = Money::s($items->sum(fn ($i) => Money::p($i['card']['net_overdue'])));
        return response()->json($res);
    }

    public function overdue(Request $r)
    {
        $r->query->set('filter', 'overdue');
        $items = $this->filter($this->base($r), $r, 'overdue');
        $res = $this->sortAndPage($items, $r);
        $res['meta']['overdue_total'] = Money::s($items->sum(fn ($i) => Money::p($i['card']['net_overdue'])));
        return response()->json($res);
    }

    /** Collection search – customer name / mobile / khata number. Works for any active khata. */
    public function search(Request $r)
    {
        $s = trim((string) $r->query('q'));
        $items = $this->base($r);
        if ($s !== '') {
            $items = $this->filter($items, $r, 'all');
        }
        return $this->ok($items->take(40)->pluck('card')->values());
    }

    /** Tuesday collection screen: summary + quick-collect cards for everything due today or earlier. */
    public function today(Request $r)
    {
        $items = $this->base($r)->filter(fn ($i) => Money::p($i['card']['net_due_now']) > 0 || Money::p($i['card']['paid_today']) > 0 || Money::p($i['card']['today_due']) > 0);
        $items = $this->filter($items->values(), $r, $r->query('filter', 'all'));

        $cards = $items->pluck('card');
        $summary = [
            'expected_today' => Money::s($cards->sum(fn ($c) => Money::p($c['today_due']))),
            'collected_today' => Money::s($cards->sum(fn ($c) => Money::p($c['paid_today']))),
            'remaining_today' => Money::s($cards->sum(fn ($c) => Money::p($c['net_due_now']))),
            'customers_paid' => $cards->filter(fn ($c) => Money::p($c['paid_today']) > 0)->count(),
            'customers_pending' => $cards->filter(fn ($c) => Money::p($c['net_due_now']) > 0)->count(),
            'customers_overdue' => $cards->filter(fn ($c) => Money::p($c['net_overdue']) > 0)->count(),
            'advance_customers' => $cards->filter(fn ($c) => Money::p($c['advance_balance']) > 0)->count(),
            'partial_payments' => $items->filter(fn ($i) => Money::p($i['card']['paid_today']) > 0 && Money::p($i['card']['net_due_now']) > 0)->count(),
        ];
        $res = $this->sortAndPage($items, $r);
        $res['summary'] = $summary;
        return response()->json($res);
    }

    /** Khata owners that currently hold an advance balance (Advance Payment screen). */
    public function advances(Request $r)
    {
        $items = $this->filter($this->base($r), $r, 'advance');
        return $this->ok($items->pluck('card')->sortByDesc(fn ($c) => Money::p($c['advance_balance']))->values());
    }
}

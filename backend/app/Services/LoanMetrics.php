<?php

namespace App\Services;

use App\Models\LoanAccount;
use App\Support\Money;
use Illuminate\Database\Eloquent\Builder;

/**
 * Set-based loan figures (single SQL query, no N+1). Every number shown on dashboards,
 * pending lists and reports comes from here – i.e. from real database records.
 *
 * Definitions (all in the context of "today"):
 *  - due_now     : unpaid installment amount with due_date <= today  (pending + overdue)
 *  - overdue     : unpaid installment amount with due_date <  today
 *  - net_*       : the same minus the khata's advance balance (advance is applied to due installments,
 *                  so it must never be counted twice)
 */
class LoanMetrics
{
    public static function query(?string $today = null): Builder
    {
        $today ??= now()->toDateString();
        $rem = '(li.expected_amount - li.paid_amount - li.waived_amount)';
        $inst = 'from loan_installments li where li.loan_account_id = loan_accounts.id';

        return LoanAccount::query()
            ->select('loan_accounts.*')
            ->selectRaw("(select coalesce(sum(li.paid_amount),0) $inst) as m_inst_paid")
            ->selectRaw("(select coalesce(sum($rem),0) $inst) as m_inst_remaining")
            ->selectRaw("(select count(*) $inst and $rem > 0) as m_rem_count")
            ->selectRaw("(select count(*) $inst and $rem <= 0) as m_paid_count")
            ->selectRaw("(select coalesce(sum($rem),0) $inst and li.due_date <= ?) as m_due_now", [$today])
            ->selectRaw("(select coalesce(sum($rem),0) $inst and li.due_date < ?) as m_overdue", [$today])
            ->selectRaw("(select coalesce(sum($rem),0) $inst and li.due_date = ?) as m_today_due", [$today])
            ->selectRaw("(select min(li.due_date) $inst and $rem > 0) as m_next_due")
            ->selectRaw("(select coalesce(sum(pm.amount),0) from payments pm where pm.loan_account_id = loan_accounts.id and pm.payment_date = ? and pm.status = 'completed') as m_paid_today", [$today])
            ->selectRaw('(select count(*) from loan_comments lc where lc.loan_account_id = loan_accounts.id) as m_comment_count')
            ->selectRaw('(select lc.body from loan_comments lc where lc.loan_account_id = loan_accounts.id order by lc.id desc limit 1) as m_last_comment')
            ->selectRaw('(select lc.created_at from loan_comments lc where lc.loan_account_id = loan_accounts.id order by lc.id desc limit 1) as m_last_comment_at')
            ->selectRaw("(select coalesce(sum(al.credit - al.debit),0) from advance_ledger al where al.loan_account_id = loan_accounts.id) as m_advance")
            ->selectRaw("(select coalesce(sum(p.amount - p.paid_amount - p.waived_amount),0) from penalties p where p.loan_account_id = loan_accounts.id and p.status in ('open','partial')) as m_penalty");
    }

    /** Convert a row from query() into a plain array of money strings + counters. */
    public static function format(LoanAccount $r): array
    {
        $advance = Money::p($r->m_advance);
        $dueNow = Money::p($r->m_due_now);
        $overdue = Money::p($r->m_overdue);
        $instRemaining = Money::p($r->m_inst_remaining);
        $penalty = Money::p($r->m_penalty);
        $oldRemaining = max(0, Money::p($r->old_khata_outstanding) - Money::p($r->old_khata_paid));
        $netDue = max(0, $dueNow - $advance);
        $netOverdue = max(0, $overdue - $advance);
        $totalOutstanding = max(0, $instRemaining + $penalty + $oldRemaining - $advance);
        $weekly = Money::p($r->weekly_amount);
        // how many weekly installments the customer is behind (after advance) – drives the colour coding
        $pendingWeeks = $weekly > 0 ? (int) ceil($netDue / $weekly) : ($netDue > 0 ? 1 : 0);

        return [
            'total_repayment' => Money::s(Money::p($r->total_repayment)),
            'total_paid' => Money::s(Money::p($r->m_inst_paid)),
            'remaining_loan' => Money::s($instRemaining),
            'remaining_installments' => (int) $r->m_rem_count,
            'paid_installments' => (int) $r->m_paid_count,
            'due_now' => Money::s($dueNow),
            'overdue_amount' => Money::s($overdue),
            'net_due_now' => Money::s($netDue),         // after advance
            'net_overdue' => Money::s($netOverdue),     // after advance
            'today_due' => Money::s(Money::p($r->m_today_due)),
            'paid_today' => Money::s(Money::p($r->m_paid_today)),
            'advance_balance' => Money::s($advance),
            'penalty_outstanding' => Money::s($penalty),
            'old_khata_remaining' => Money::s($oldRemaining),
            'total_outstanding' => Money::s($totalOutstanding),
            'payable_now' => Money::s($netDue + $penalty + $oldRemaining), // what to ask the customer for today
            'comment_count' => (int) $r->m_comment_count,
            'last_comment' => $r->m_last_comment,
            'last_comment_at' => $r->m_last_comment_at,
            'pending_weeks' => $pendingWeeks,
            'tone' => self::tone($pendingWeeks, (int) $r->m_rem_count, $r->status ?? 'active'),
            'next_due_date' => $r->m_next_due,
            'can_close' => $instRemaining === 0 && $penalty === 0 && $oldRemaining === 0,
        ];
    }

    /**
     * Colour of a khata in lists: green = up to date, yellow = 1 week behind, orange = 2 weeks, red = 3+ weeks.
     * A finished khata is 'done'.
     */
    public static function tone(int $pendingWeeks, int $remainingInstallments, string $status = 'active'): string
    {
        if ($status === 'closed' || $remainingInstallments === 0) {
            return 'done';
        }
        return match (true) {
            $pendingWeeks <= 0 => 'green',
            $pendingWeeks === 1 => 'yellow',
            $pendingWeeks === 2 => 'orange',
            default => 'red',
        };
    }
}

<?php

namespace Tests\Feature;

use App\Services\PaymentService;
use Illuminate\Support\Carbon;

class SheetTest extends FinanceTestCase
{
    private function pay($loan, $amount)
    {
        return PaymentService::collect([
            'loan_account_id' => $loan->id, 'amount' => $amount, 'payment_type' => 'cash',
            'cash_location_id' => $this->recCash->id, 'collected_by' => $this->recovery->id,
        ], $this->recovery)[0];
    }

    public function test_fully_paid_khata_closes_itself_and_reopens_on_reversal(): void
    {
        $loan = $this->loan($this->customer());
        for ($i = 0; $i < 10; $i++) {
            Carbon::setTestNow(Carbon::parse('2026-11-10')->addWeeks($i)->setHour(10));
            $p = $this->pay($loan, 10000);
        }
        $this->assertSame('closed', $loan->fresh()->status);
        $this->assertSame('full', $loan->fresh()->close_type);

        $this->actingAsToken($this->admin)->postJson("/api/payments/{$p->id}/reverse", ['reason' => 'mistake'])->assertOk();
        $this->assertSame('active', $loan->fresh()->status);
    }

    public function test_paying_every_remaining_week_in_advance_closes_early(): void
    {
        $loan = $this->loan($this->customer());
        $this->pay($loan, 10000);          // week 1
        $this->pay($loan, 90000);          // all remaining weeks at once
        $this->assertSame('closed', $loan->fresh()->status);
        $this->assertSame(0, $loan->installments()->whereIn('state', ['open', 'partial'])->count());
    }

    public function test_sheet_orders_fewest_weeks_left_first_and_colours_by_pending_weeks(): void
    {
        $old = $this->loan($this->customer('Old'));
        $this->pay($old, 30000); // 3 weeks paid
        $this->loan($this->customer('New'), ['disbursement_date' => '2026-11-09']);

        Carbon::setTestNow('2026-11-24 10:00:00'); // third Tuesday: 3 installments due
        $res = $this->actingAsToken($this->admin)->getJson('/api/khata-sheet?grid=1')->assertOk();
        $rows = $res->json('data');
        $this->assertSame(['Old', 'New'], array_map(fn ($r) => $r['customer']['name'], $rows));
        $this->assertSame('green', $rows[0]['tone']);  // Old: advance covers the 3 due weeks → up to date
        $this->assertSame('red', $rows[1]['tone']);    // New: nothing paid, 3 weeks due
        $this->assertCount(10, $rows[0]['weeks']);
        $this->assertSame(10, $res->json('meta.max_weeks'));
    }

    public function test_weekly_report_shows_week_amounts_and_loans_given(): void
    {
        $loan = $this->loan($this->customer());          // disbursed Monday 2026-11-09, first due Tue 2026-11-10
        $this->pay($loan, 4000);

        $res = $this->actingAsToken($this->admin)->getJson('/api/weekly-report?week_start=2026-11-10')->assertOk();
        $this->assertSame('2026-11-10', $res->json('week.start'));
        $this->assertSame('2026-11-16', $res->json('week.end'));
        $this->assertSame('10000.00', $res->json('summary.expected'));
        $this->assertSame('4000.00', $res->json('summary.collected'));
        $this->assertSame('6000.00', $res->json('summary.pending'));
        $this->assertSame('partial', $res->json('data.0.week.state'));

        // the Monday loan belongs to the PREVIOUS week (Tue 2026-11-03 → Mon 2026-11-09)
        $prev = $this->actingAsToken($this->admin)->getJson('/api/weekly-report?week_start=2026-11-03')->assertOk();
        $this->assertSame('80000.00', $prev->json('summary.loans_given_cash'));
        $this->assertSame(1, $prev->json('summary.loans_given_count'));
        // any date inside a week resolves to that week's collection day
        $this->actingAsToken($this->admin)->getJson('/api/weekly-report?week_start=2026-11-13')->assertOk()->assertJsonPath('week.start', '2026-11-10');
    }
}

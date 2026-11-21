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

    public function test_admin_assigns_selected_khata_customers_to_recovery_and_sheet_filters_by_them(): void
    {
        $a = $this->customer('A', false);
        $b = $this->customer('B', false);
        $this->loan($a);
        $this->loan($b);

        $this->actingAsToken($this->admin)->postJson('/api/recovery/assign', ['recovery_user_id' => $this->recovery->id, 'customer_ids' => [$a->id]])->assertOk();

        $mine = $this->actingAsToken($this->admin)->getJson('/api/khata-sheet?recovery_user_id=' . $this->recovery->id)->assertOk();
        $this->assertSame(['A'], array_map(fn ($r) => $r['customer']['name'], $mine->json('data')));
        $free = $this->actingAsToken($this->admin)->getJson('/api/khata-sheet?recovery_user_id=0')->assertOk();
        $this->assertSame(['B'], array_map(fn ($r) => $r['customer']['name'], $free->json('data')));

        // the recovery person only ever sees their own list
        $own = $this->actingAsToken($this->recovery)->getJson('/api/khata-sheet')->assertOk();
        $this->assertSame(['A'], array_map(fn ($r) => $r['customer']['name'], $own->json('data')));

        $this->actingAsToken($this->admin)->postJson('/api/recovery/assign', ['customer_ids' => [$a->id]])->assertOk();
        $this->assertSame(0, \App\Models\RecoveryAssignment::where('customer_id', $a->id)->count());
    }

    public function test_customer_can_be_created_without_recovery_and_recovery_can_be_changed_or_removed(): void
    {
        $base = ['name' => 'Raju', 'occupation' => 'Farmer', 'mobile' => '9876500000', 'village' => 'V', 'taluka' => 'T', 'district' => 'D', 'state' => 'MH', 'pincode' => '413102', 'address' => 'x', 'lat' => 18.1, 'lng' => 74.5];
        \Illuminate\Support\Facades\Storage::fake('local');
        $photo = \Illuminate\Http\UploadedFile::fake()->image('p.jpg');

        $id = $this->actingAsToken($this->admin)->post('/api/customers', $base + ['photo' => $photo], ['Accept' => 'application/json'])->assertSuccessful()->json('data.id');
        $this->assertSame(0, \App\Models\RecoveryAssignment::where('customer_id', $id)->count());

        $this->actingAsToken($this->admin)->post("/api/customers/{$id}", $base + ['_method' => 'PUT', 'recovery_user_id' => $this->recovery->id], ['Accept' => 'application/json'])->assertSuccessful();
        $this->assertSame($this->recovery->id, \App\Models\RecoveryAssignment::where('customer_id', $id)->value('recovery_user_id'));

        $this->actingAsToken($this->admin)->post("/api/customers/{$id}", $base + ['_method' => 'PUT', 'clear_recovery' => 1], ['Accept' => 'application/json'])->assertSuccessful();
        $this->assertSame(0, \App\Models\RecoveryAssignment::where('customer_id', $id)->count());
    }

    public function test_recovery_can_comment_on_own_khata_only_and_comment_shows_in_lists(): void
    {
        $mine = $this->loan($this->customer('Mine'));
        $other = $this->loan($this->customer('Other', false));

        $this->actingAsToken($this->recovery)->postJson("/api/loan-accounts/{$mine->id}/comments", ['body' => 'Will pay next week'])->assertCreated();
        $this->actingAsToken($this->recovery)->postJson("/api/loan-accounts/{$other->id}/comments", ['body' => 'x'])->assertForbidden();
        $this->actingAsToken($this->recovery)->postJson("/api/loan-accounts/{$mine->id}/comments", ['body' => ''])->assertStatus(422);

        $list = $this->actingAsToken($this->admin)->getJson("/api/loan-accounts/{$mine->id}/comments")->assertOk();
        $this->assertSame('Will pay next week', $list->json('data.0.body'));
        $this->assertSame('R', $list->json('data.0.user_name'));

        $row = $this->actingAsToken($this->recovery)->getJson('/api/collection/today?filter=all')->assertOk()->json('data.0');
        $this->assertSame('Will pay next week', $row['last_comment']);
        $this->assertSame(1, $row['comment_count']);
    }
}

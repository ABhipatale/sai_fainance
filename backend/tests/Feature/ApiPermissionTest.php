<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\CustomerDocument;

class ApiPermissionTest extends FinanceTestCase
{
    public function test_login_and_me(): void
    {
        $res = $this->postJson('/api/login', ['username' => 'rec', 'password' => 'password1'])->assertOk();
        $token = $res->json('data.token');
        $this->assertNotEmpty($token);
        $this->withToken($token)->getJson('/api/me')->assertOk()->assertJsonPath('data.user.role', 'recovery');
        $this->postJson('/api/login', ['username' => 'rec', 'password' => 'bad'])->assertStatus(422)->assertJsonPath('success', false);
    }

    public function test_unauthenticated_is_rejected(): void
    {
        $this->getJson('/api/customers')->assertStatus(401);
    }

    public function test_recovery_cannot_create_loans_customers_or_settings(): void
    {
        $c = $this->customer();
        $this->actingAsToken($this->recovery);
        $this->postJson('/api/loan-accounts', ['customer_id' => $c->id])->assertStatus(403);
        $this->postJson('/api/customers', [])->assertStatus(403);
        $this->getJson('/api/settings')->assertStatus(403);
        $this->getJson('/api/audit-logs')->assertStatus(403);
        $this->postJson('/api/cash-locations', ['name' => 'x', 'type' => 'other'])->assertStatus(403);
        $this->getJson('/api/reports/daily-collection')->assertStatus(403);
    }

    public function test_recovery_only_sees_assigned_customers(): void
    {
        $mine = $this->customer('Mine', true);
        $other = $this->customer('Other', false);
        $this->actingAsToken($this->recovery);
        $names = collect($this->getJson('/api/customers')->assertOk()->json('data'))->pluck('name');
        $this->assertTrue($names->contains('Mine'));
        $this->assertFalse($names->contains('Other'));
        $this->getJson("/api/customers/{$other->id}")->assertStatus(403);
        $this->getJson("/api/customers/{$mine->id}")->assertOk();
    }

    public function test_recovery_cannot_collect_on_unassigned_customer(): void
    {
        $other = $this->customer('Other', false);
        $loan = $this->loan($other);
        $this->actingAsToken($this->recovery)->postJson('/api/payments', [
            'loan_account_id' => $loan->id, 'amount' => 1000, 'payment_type' => 'cash', 'cash_location_id' => $this->recCash->id,
        ])->assertStatus(403);
    }

    public function test_recovery_cannot_use_other_cash_location(): void
    {
        $loan = $this->loan($this->customer());
        $this->actingAsToken($this->recovery)->postJson('/api/payments', [
            'loan_account_id' => $loan->id, 'amount' => 1000, 'payment_type' => 'cash', 'cash_location_id' => $this->office->id,
        ])->assertStatus(422);
    }

    public function test_collect_over_api_with_idempotency_and_receipt(): void
    {
        $loan = $this->loan($this->customer());
        $body = ['loan_account_id' => $loan->id, 'amount' => 15000, 'payment_type' => 'upi', 'cash_location_id' => $this->recCash->id, 'idempotency_key' => 'k-1'];
        $r1 = $this->actingAsToken($this->recovery)->postJson('/api/payments', $body)->assertStatus(201);
        $r2 = $this->postJson('/api/payments', $body)->assertOk()->assertJsonPath('data.duplicate', true);
        $this->assertSame($r1->json('data.payment.id'), $r2->json('data.payment.id'));
        $this->assertSame('5000.00', $r1->json('data.receipt.breakdown.advance'));
        $this->assertSame('10000.00', $r1->json('data.receipt.breakdown.installment'));
        $id = $r1->json('data.payment.id');
        $this->getJson("/api/payments/$id/receipt")->assertOk()->assertJsonPath('data.khata_no', $loan->khata_no);
        $this->postJson("/api/payments/$id/reverse", ['reason' => 'x'])->assertStatus(403); // recovery cannot reverse
        $this->actingAsToken($this->admin)->postJson("/api/payments/$id/reverse", ['reason' => 'mistake'])->assertOk();
    }

    public function test_sensitive_documents_hidden_from_recovery(): void
    {
        $c = $this->customer();
        CustomerDocument::create(['customer_id' => $c->id, 'type' => 'aadhaar', 'number' => '123412341234']);
        $rec = $this->actingAsToken($this->recovery)->getJson("/api/customers/{$c->id}")->assertOk()->json('data');
        $this->assertSame('XXXXXXXX1234', $rec['aadhaar_no']);
        $this->getJson("/api/customers/{$c->id}/documents/aadhaar")->assertStatus(403);
        $adm = $this->actingAsToken($this->admin)->getJson("/api/customers/{$c->id}")->assertOk()->json('data');
        $this->assertSame('123412341234', $adm['aadhaar_no']);
    }

    public function test_manager_cannot_waive_or_reverse_but_admin_can(): void
    {
        $loan = $this->loan($this->customer());
        $pen = $this->actingAsToken($this->manager)->postJson('/api/penalties', ['loan_account_id' => $loan->id, 'amount' => 100, 'reason' => 'late'])->assertStatus(201)->json('data.id');
        $this->postJson("/api/penalties/$pen/waive", ['reason' => 'festival'])->assertStatus(403);
        $this->actingAsToken($this->admin)->postJson("/api/penalties/$pen/waive", ['reason' => 'festival'])->assertOk();
    }

    public function test_dashboard_matches_database(): void
    {
        $loan = $this->loan($this->customer());
        $this->actingAsToken($this->recovery)->postJson('/api/payments', [
            'loan_account_id' => $loan->id, 'amount' => 10000, 'payment_type' => 'cash', 'cash_location_id' => $this->recCash->id,
        ])->assertStatus(201);
        $d = $this->actingAsToken($this->admin)->getJson('/api/dashboard')->assertOk()->json('data');
        $this->assertSame('collection', $d['mode']);      // fake "today" is a Tuesday
        $this->assertSame(1, $d['cards']['active_khata']);
        $this->assertSame('10000.00', $d['cards']['today_collection']);
        $this->assertSame('90000.00', $d['cards']['total_to_collect']);
        $this->assertSame('80000.00', $d['cards']['new_disbursement']);
    }

    public function test_pending_list_sorted_by_remaining_installments(): void
    {
        $a = $this->loan($this->customer('A'), ['installments_count' => 5, 'total_repayment' => 50000, 'principal_amount' => 40000]);
        $b = $this->loan($this->customer('B'), ['installments_count' => 10]);
        $asc = collect($this->actingAsToken($this->admin)->getJson('/api/pending-recovery?sort=remaining_installments&dir=asc')->json('data'))->pluck('remaining_installments');
        $desc = collect($this->getJson('/api/pending-recovery?sort=remaining_installments&dir=desc')->json('data'))->pluck('remaining_installments');
        $this->assertSame([5, 10], $asc->all());
        $this->assertSame([10, 5], $desc->all());
    }

    public function test_reports_and_export(): void
    {
        $loan = $this->loan($this->customer());
        $this->actingAsToken($this->recovery)->postJson('/api/payments', [
            'loan_account_id' => $loan->id, 'amount' => 3000, 'payment_type' => 'cash', 'cash_location_id' => $this->recCash->id,
        ])->assertStatus(201);
        $this->actingAsToken($this->admin);
        $r = $this->getJson('/api/reports/daily-collection?date=2026-11-10')->assertOk();
        $this->assertSame('3000.00', $r->json('data.totals.amount'));
        $this->get('/api/reports/daily-collection?date=2026-11-10&export=csv', ['Authorization' => 'Bearer ' . $this->admin->createToken('x')->plainTextToken])->assertOk();
        foreach (\App\Services\ReportService::KEYS as $key) {
            if ($key === 'customer-ledger') continue;
            $this->getJson("/api/reports/$key")->assertOk();
        }
        $cid = Customer::first()->id;
        $this->getJson("/api/reports/customer-ledger?customer_id=$cid")->assertOk();
    }

    public function test_manager_staff_scope(): void
    {
        $other = \App\Models\User::create(['name' => 'R2', 'username' => 'rec2', 'password' => 'password1', 'role' => 'recovery']); // other manager's / none
        $names = collect($this->actingAsToken($this->manager)->getJson('/api/users')->assertOk()->json('data'))->pluck('username');
        $this->assertTrue($names->contains('rec'));
        $this->assertFalse($names->contains('rec2'));
    }
}

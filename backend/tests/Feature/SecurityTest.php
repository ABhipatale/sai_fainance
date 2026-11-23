<?php

namespace Tests\Feature;

use App\Models\CashLocation;
use App\Models\Payment;
use App\Models\User;
use App\Services\PaymentService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/** One test per security control – if any of these fails, a protection has been weakened. */
class SecurityTest extends FinanceTestCase
{
    private function body($loan, array $over = []): array
    {
        return $over + ['loan_account_id' => $loan->id, 'amount' => 1000, 'payment_type' => 'cash', 'cash_location_id' => $this->recCash->id];
    }

    // ---- transport / browser ------------------------------------------------------------------------------

    public function test_security_headers_are_sent_and_server_fingerprint_is_hidden(): void
    {
        $res = $this->actingAsToken($this->admin)->getJson('/api/me')->assertOk();
        $res->assertHeader('X-Content-Type-Options', 'nosniff');
        $res->assertHeader('X-Frame-Options', 'DENY');
        $res->assertHeader('Referrer-Policy', 'same-origin');
        $res->assertHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        $res->assertHeaderMissing('X-Powered-By');
        $this->get('/up')->assertHeader('X-Frame-Options', 'DENY');
    }

    public function test_other_websites_are_not_allowed_by_cors(): void
    {
        $res = $this->withHeaders(['Origin' => 'https://evil.example', 'Access-Control-Request-Method' => 'POST'])->options('/api/login');
        $this->assertNotSame('https://evil.example', $res->headers->get('Access-Control-Allow-Origin'));
        $this->assertNotSame('*', $res->headers->get('Access-Control-Allow-Origin'));
    }

    // ---- authentication ----------------------------------------------------------------------------------------

    public function test_unknown_user_and_wrong_password_look_identical(): void
    {
        $a = $this->postJson('/api/login', ['username' => 'nobody', 'password' => 'x'])->assertStatus(422)->json('message');
        $b = $this->postJson('/api/login', ['username' => 'rec', 'password' => 'wrong'])->assertStatus(422)->json('message');
        $this->assertSame($a, $b);
    }

    public function test_one_account_attacked_from_many_ips_is_locked(): void
    {
        RateLimiter::clear('user|rec');
        for ($i = 1; $i <= 20; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.$i"])->postJson('/api/login', ['username' => 'rec', 'password' => 'wrong'])->assertStatus(422);
        }
        // even the correct password from a fresh IP is refused until the window passes
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.1.1'])->postJson('/api/login', ['username' => 'rec', 'password' => 'password1'])->assertStatus(429);
    }

    public function test_inactive_and_expired_tokens_are_rejected(): void
    {
        $token = $this->recovery->createToken('t')->plainTextToken;
        $this->recovery->update(['status' => 'inactive']);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/collection/today')->assertStatus(401);

        $this->recovery->update(['status' => 'active']);
        $old = $this->recovery->createToken('old', ['*'], now()->addDay())->plainTextToken;
        Carbon::setTestNow(now()->addDays(2));
        $this->app['auth']->forgetGuards();
        $this->withToken($old)->getJson('/api/me')->assertStatus(401);
        $this->app['auth']->forgetGuards();
        $this->withToken('')->getJson('/api/me')->assertStatus(401);
    }

    public function test_password_policy_and_other_sessions_are_signed_out(): void
    {
        $other = $this->recovery->createToken('phone2')->plainTextToken;
        $api = $this->actingAsToken($this->recovery);
        $api->postJson('/api/me/password', ['current_password' => 'password1', 'password' => 'abcdefgh', 'password_confirmation' => 'abcdefgh'])->assertStatus(422);   // no number
        $api->postJson('/api/me/password', ['current_password' => 'password1', 'password' => '12345678', 'password_confirmation' => '12345678'])->assertStatus(422);   // no letter
        $api->postJson('/api/me/password', ['current_password' => 'password1', 'password' => 'password1', 'password_confirmation' => 'password1'])->assertStatus(422); // same as old
        $api->postJson('/api/me/password', ['current_password' => 'nope', 'password' => 'Strong123', 'password_confirmation' => 'Strong123'])->assertStatus(422);
        $api->postJson('/api/me/password', ['current_password' => 'password1', 'password' => 'Strong123', 'password_confirmation' => 'Strong123'])->assertOk();

        $this->assertTrue(Hash::check('Strong123', $this->recovery->fresh()->password));
        $this->app['auth']->forgetGuards();
        $this->withToken($other)->getJson('/api/me')->assertStatus(401);
    }

    // ---- users / roles --------------------------------------------------------------------------------------------

    public function test_new_staff_need_a_strong_password(): void
    {
        $this->actingAsToken($this->admin)->postJson('/api/users', ['name' => 'X', 'username' => 'xuser', 'password' => 'aaaaaaaa', 'role' => 'recovery'])
            ->assertStatus(422)->assertJsonValidationErrors('password');
    }

    public function test_manager_cannot_give_recovery_staff_the_office_cash_or_another_manager(): void
    {
        $api = $this->actingAsToken($this->manager);
        $api->postJson('/api/users', ['name' => 'N', 'username' => 'newrec', 'password' => 'Strong123', 'role' => 'recovery', 'cash_location_id' => $this->office->id])
            ->assertStatus(422)->assertJsonValidationErrors('cash_location_id');

        $otherMgr = User::create(['name' => 'M2', 'username' => 'mgr2', 'password' => 'password1', 'role' => 'manager']);
        $this->actingAsToken($this->manager)->putJson("/api/users/{$this->recovery->id}", ['name' => 'R', 'username' => 'rec', 'role' => 'recovery', 'manager_id' => $otherMgr->id, 'cash_location_id' => $this->recCash->id])->assertOk();
        $this->assertSame($this->manager->id, (int) $this->recovery->fresh()->manager_id);

        $this->actingAsToken($this->manager)->putJson("/api/users/{$this->recovery->id}", ['name' => 'R', 'username' => 'rec', 'role' => 'recovery', 'cash_location_id' => $this->office->id])->assertStatus(422);
        $this->assertSame($this->recCash->id, (int) $this->recovery->fresh()->cash_location_id);
    }

    public function test_manager_cannot_create_or_promote_admins(): void
    {
        $this->actingAsToken($this->manager)->postJson('/api/users', ['name' => 'A', 'username' => 'boss2', 'password' => 'Strong123', 'role' => 'admin'])->assertStatus(403);
        $this->actingAsToken($this->manager)->putJson("/api/users/{$this->recovery->id}", ['name' => 'R', 'username' => 'rec', 'role' => 'admin'])->assertStatus(403);
        $this->assertSame('recovery', $this->recovery->fresh()->role);
    }

    public function test_last_active_admin_cannot_be_removed(): void
    {
        $other = User::create(['name' => 'A2', 'username' => 'admin2', 'password' => 'password1', 'role' => 'admin']);
        $other->update(['status' => 'inactive']);
        $this->actingAsToken($this->admin)->putJson("/api/users/{$this->admin->id}", ['name' => 'A', 'username' => $this->admin->username, 'role' => 'manager'])->assertStatus(422);
        $this->assertSame('admin', $this->admin->fresh()->role);

        $other->update(['status' => 'active']);
        $this->actingAsToken($other)->putJson("/api/users/{$this->admin->id}", ['name' => 'A', 'username' => $this->admin->username, 'role' => 'manager'])->assertOk();
    }

    // ---- data access (IDOR) -----------------------------------------------------------------------------------

    public function test_staff_cannot_open_another_staffs_customer_khata_payment_or_penalty(): void
    {
        $theirs = $this->customer('Theirs', false);
        $otherRec = User::create(['name' => 'R2', 'username' => 'rec2', 'password' => 'password1', 'role' => 'recovery']);
        \App\Models\RecoveryAssignment::create(['customer_id' => $theirs->id, 'recovery_user_id' => $otherRec->id]);
        $loan = $this->loan($theirs);
        $pay = PaymentService::collect($this->body($loan, ['cash_location_id' => $this->office->id, 'collected_by' => $this->admin->id]), $this->admin)[0];
        $pen = \App\Services\PenaltyService::add(['loan_account_id' => $loan->id, 'amount' => 100], $this->admin);

        $api = $this->actingAsToken($this->recovery);
        $api->getJson("/api/customers/{$theirs->id}")->assertForbidden();
        $api->getJson("/api/loan-accounts/{$loan->id}")->assertForbidden();
        $api->getJson("/api/payments/{$pay->id}/receipt")->assertForbidden();
        $api->getJson("/api/loan-accounts/{$loan->id}/comments")->assertForbidden();
        $api->postJson('/api/payments', $this->body($loan))->assertForbidden();
        $this->assertCount(0, $api->getJson('/api/khata-sheet')->json('data'));
        $this->assertCount(0, $api->getJson('/api/penalties')->json('data'));
        $api->putJson("/api/penalties/{$pen->id}", ['amount' => 1])->assertForbidden();
        $this->assertSame('100.00', $pen->fresh()->amount);
    }

    // ---- payments --------------------------------------------------------------------------------------------------

    public function test_a_reused_request_key_cannot_reveal_someone_elses_payment(): void
    {
        $mine = $this->loan($this->customer('Mine'));
        $other = $this->loan($this->customer('Other'));
        $this->actingAsToken($this->recovery)->postJson('/api/payments', $this->body($mine, ['idempotency_key' => 'k-123']))->assertCreated();

        // same user, same khata → harmless duplicate
        $this->actingAsToken($this->recovery)->postJson('/api/payments', $this->body($mine, ['idempotency_key' => 'k-123']))->assertOk()->assertJsonPath('data.duplicate', true);
        // another khata or another user → refused, nothing leaked
        $this->actingAsToken($this->recovery)->postJson('/api/payments', $this->body($other, ['idempotency_key' => 'k-123']))->assertStatus(422)->assertJsonMissingPath('data');
        $this->actingAsToken($this->admin)->postJson('/api/payments', $this->body($mine, ['idempotency_key' => 'k-123', 'cash_location_id' => $this->office->id]))->assertStatus(422);
        $this->assertSame(1, Payment::count());
    }

    public function test_staff_cannot_backdate_payments_beyond_the_offline_window(): void
    {
        $loan = $this->loan($this->customer(), ['disbursement_date' => '2026-10-01', 'first_installment_date' => '2026-10-06']);
        $api = $this->actingAsToken($this->recovery);
        $api->postJson('/api/payments', $this->body($loan, ['payment_date' => now()->subDays(10)->toDateString()]))->assertStatus(422)->assertJsonValidationErrors('payment_date');
        $api->postJson('/api/payments', $this->body($loan, ['payment_date' => now()->subDays(3)->toDateString()]))->assertCreated();
        $this->actingAsToken($this->admin)->postJson('/api/payments', $this->body($loan, ['payment_date' => now()->subDays(30)->toDateString(), 'cash_location_id' => $this->office->id]))->assertCreated();
    }

    public function test_offline_sync_never_returns_internal_error_text(): void
    {
        $hidden = $this->loan($this->customer('Hidden', false));
        \App\Models\RecoveryAssignment::create(['customer_id' => $hidden->customer_id, 'recovery_user_id' => User::create(['name' => 'Z', 'username' => 'z1', 'password' => 'password1', 'role' => 'recovery'])->id]);
        $res = $this->actingAsToken($this->recovery)->postJson('/api/payments/sync', ['items' => [$this->body($hidden, ['idempotency_key' => 'off-1'])]])->assertOk();
        $this->assertFalse($res->json('data.0.ok'));
        $msg = json_encode($res->json('data.0.errors'));
        $this->assertStringNotContainsStringIgnoringCase('sql', $msg);
        $this->assertStringNotContainsString('.php', $msg);
        $this->assertSame(0, Payment::count());
    }

    public function test_recovery_cannot_collect_into_office_cash_or_move_office_cash(): void
    {
        $loan = $this->loan($this->customer());
        $this->actingAsToken($this->recovery)->postJson('/api/payments', $this->body($loan, ['cash_location_id' => $this->office->id]))->assertStatus(422);
        $this->actingAsToken($this->recovery)->postJson('/api/cash-transfers', ['from_location_id' => $this->office->id, 'to_location_id' => $this->recCash->id, 'amount' => 1])->assertStatus(422);
        $this->actingAsToken($this->recovery)->getJson("/api/cash-locations/{$this->office->id}/ledger")->assertForbidden();
        $this->actingAsToken($this->recovery)->postJson("/api/cash-locations/{$this->office->id}/adjust", ['amount' => 5000, 'note' => 'steal'])->assertForbidden();
    }

    // ---- input validation ------------------------------------------------------------------------------------------

    public function test_settings_reject_unknown_keys_and_values(): void
    {
        $api = $this->actingAsToken($this->admin);
        $api->putJson('/api/settings', ['payment_types' => ['cash', '<script>']])->assertStatus(422);
        $api->putJson('/api/settings', ['general' => ['name' => 'X', 'logo_path' => '../../.env']])->assertStatus(422);
        $api->putJson('/api/settings', ['receipt_format' => ['footer' => str_repeat('x', 301)]])->assertStatus(422);
        $api->putJson('/api/settings', ['general' => ['name' => 'Sai Finance', 'phone' => '9999999999']])->assertOk();
        $this->actingAsToken($this->manager)->putJson('/api/settings', ['general' => ['name' => 'Hacked']])->assertForbidden();
    }

    public function test_malformed_input_gives_422_not_a_server_error(): void
    {
        $api = $this->actingAsToken($this->admin);
        $api->getJson('/api/weekly-report?week_start=not-a-date')->assertStatus(422);
        $api->getJson("/api/customers?q=' OR 1=1 --")->assertOk()->assertJsonCount(0, 'data');
        $api->postJson('/api/payments', ['loan_account_id' => 'abc', 'amount' => -5])->assertStatus(422);
    }

    public function test_private_files_cannot_be_reached_by_path_tricks(): void
    {
        $url = \Illuminate\Support\Facades\URL::temporarySignedRoute('media', now()->addHour(), ['p' => 'photos/../../.env'], absolute: false);
        $this->get($url)->assertNotFound();
        $this->get('/api/media?p=photos/x.jpg')->assertStatus(403);   // unsigned
    }
}

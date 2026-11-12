<?php

namespace Tests\Feature;

use App\Models\CashLocation;
use App\Models\Customer;
use App\Models\LoanAccount;
use App\Models\RecoveryAssignment;
use App\Models\User;
use App\Services\LoanService;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

abstract class FinanceTestCase extends TestCase
{
    use RefreshDatabase;

    protected User $admin;
    protected User $manager;
    protected User $recovery;
    protected CashLocation $office;
    protected CashLocation $recCash;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-10 10:00:00'); // a Tuesday
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('role', 'admin')->first();
        $this->manager = User::create(['name' => 'M', 'username' => 'mgr', 'password' => 'password1', 'role' => 'manager']);
        $this->recovery = User::create(['name' => 'R', 'username' => 'rec', 'password' => 'password1', 'role' => 'recovery', 'manager_id' => $this->manager->id]);
        $this->office = CashLocation::where('type', 'office_cash')->first();
        $this->recCash = CashLocation::create(['name' => 'Rec cash', 'type' => 'recovery_cash', 'responsible_user_id' => $this->recovery->id]);
        $this->recovery->update(['cash_location_id' => $this->recCash->id]);
    }

    protected function customer(string $name = 'Ganesh', bool $assign = true): Customer
    {
        $c = Customer::create(['name' => $name, 'mobile' => '9876543210', 'occupation' => 'Farmer', 'created_by' => $this->admin->id]);
        $c->address()->create(['address' => 'x', 'village' => 'V', 'taluka' => 'T', 'district' => 'D', 'state' => 'MH', 'pincode' => '413102', 'lat' => 18.1, 'lng' => 74.5]);
        if ($assign) {
            RecoveryAssignment::create(['customer_id' => $c->id, 'recovery_user_id' => $this->recovery->id]);
        }
        return $c;
    }

    /** ₹80,000 principal → ₹1,00,000 repayment, 10 weekly installments of ₹10,000, first on Tuesday 2026-11-10. */
    protected function loan(Customer $c, array $over = []): LoanAccount
    {
        return LoanService::create($over + [
            'customer_id' => $c->id, 'principal_amount' => 80000, 'total_repayment' => 100000, 'installments_count' => 10,
            'disbursement_date' => '2026-11-09', 'cash_location_id' => $this->office->id,
        ], $this->admin);
    }

    protected function actingAsToken(User $u): static
    {
        $this->app['auth']->forgetGuards(); // the resolved guard user is cached between requests of one test
        return $this->withToken($u->createToken('t')->plainTextToken);
    }
}

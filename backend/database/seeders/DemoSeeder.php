<?php

namespace Database\Seeders;

use App\Models\CashLocation;
use App\Models\Customer;
use App\Models\User;
use App\Services\CashService;
use App\Services\LoanService;
use App\Services\PaymentService;
use Illuminate\Database\Seeder;

/** DEV ONLY: php artisan db:seed --class=DemoSeeder  – creates sample users, customers and khatas through the real services. */
class DemoSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(DatabaseSeeder::class);
        $admin = User::where('role', 'admin')->first();

        $mgr = User::firstOrCreate(['username' => 'manager'], ['name' => 'Ramesh Manager', 'mobile' => '9800000001', 'password' => 'Manager@123', 'role' => 'manager']);
        $rec = User::firstOrCreate(['username' => 'recovery1'], ['name' => 'Suresh Patil', 'mobile' => '9800000002', 'password' => 'Recovery@123', 'role' => 'recovery', 'manager_id' => $mgr->id, 'assigned_area' => 'Baramati']);
        $loc = CashLocation::where('type', 'recovery_cash')->where('responsible_user_id', $rec->id)->first()
            ?? CashService::createLocation(['name' => 'Suresh Patil Cash', 'type' => 'recovery_cash', 'responsible_user_id' => $rec->id, 'opening_balance' => 0], $admin);
        $office = CashLocation::where('type', 'office_cash')->first();
        CashService::post($office->id, 'adjustment', 50000000, 0, 'Demo opening cash', now()->toDateString(), $admin->id);

        $people = [['Ganesh Shinde', 'Sheti', 'Baramati'], ['Sunita Jadhav', 'Vyapar', 'Daund'], ['Mahesh Pawar', 'Dukan', 'Baramati'], ['Anita Kale', 'Shilai', 'Indapur']];
        foreach ($people as $i => [$name, $occ, $village]) {
            $c = Customer::create(['name' => $name, 'mobile' => '98765432' . str_pad((string) (10 + $i), 2, '0', STR_PAD_LEFT), 'occupation' => $occ, 'created_by' => $admin->id, 'area' => 'Baramati']);
            $c->address()->create(['address' => 'Main road, ' . $village, 'village' => $village, 'taluka' => $village, 'district' => 'Pune', 'state' => 'Maharashtra', 'pincode' => '413102', 'lat' => 18.15 + $i / 100, 'lng' => 74.57 + $i / 100]);
            \App\Models\RecoveryAssignment::create(['customer_id' => $c->id, 'recovery_user_id' => $rec->id, 'assigned_by' => $admin->id]);
            $loan = LoanService::create([
                'customer_id' => $c->id, 'principal_amount' => 80000 - $i * 10000, 'total_repayment' => 100000 - $i * 12000,
                'installments_count' => 10, 'disbursement_date' => now()->subWeeks(3 + $i)->toDateString(), 'cash_location_id' => $office->id,
                'old_khata_outstanding' => $i === 1 ? 5000 : 0,
            ], $admin);
            // first customer has paid 2 installments + some advance
            if ($i === 0) {
                PaymentService::collect(['loan_account_id' => $loan->id, 'amount' => 25000, 'payment_type' => 'cash', 'cash_location_id' => $loc->id, 'collected_by' => $rec->id, 'payment_date' => now()->subWeek()->toDateString()], $rec);
            }
        }
    }
}

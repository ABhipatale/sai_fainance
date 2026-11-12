<?php

namespace Database\Seeders;

use App\Models\CashLocation;
use App\Models\FinanceSetting;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Production seeder: roles, permissions, default settings and the first ADMIN login.
 * The admin password comes from SEED_ADMIN_PASSWORD (.env) – change it after first login.
 */
class DatabaseSeeder extends Seeder
{
    public const PERMISSIONS = [
        'dashboard' => ['dashboard.view'],
        'customers' => ['customers.view', 'customers.create', 'customers.update', 'customers.documents'],
        'loans' => ['loans.view', 'loans.create', 'loans.update', 'loans.close'],
        'payments' => ['payments.view', 'payments.collect', 'payments.reverse'],
        'advance' => ['advance.refund'],
        'penalties' => ['penalties.view', 'penalties.create', 'penalties.update', 'penalties.waive', 'penalties.reverse'],
        'cash' => ['cash.view', 'cash.manage', 'cash.transfer', 'cash.opening', 'cash.adjust', 'expenses.manage'],
        'recovery' => ['recovery.view', 'recovery.manage', 'recovery.assign'],
        'users' => ['users.manage', 'managers.manage'],
        'reports' => ['reports.view', 'reports.export'],
        'settings' => ['settings.view', 'settings.manage', 'audit.view'],
    ];

    public const MANAGER = [
        'dashboard.view', 'customers.view', 'customers.create', 'customers.update', 'customers.documents',
        'loans.view', 'loans.create', 'loans.update', 'payments.view', 'payments.collect',
        'penalties.view', 'penalties.create', 'cash.view', 'cash.manage', 'cash.transfer',
        'recovery.view', 'recovery.manage', 'recovery.assign', 'reports.view',
    ];

    public const RECOVERY = [
        'dashboard.view', 'customers.view', 'loans.view', 'payments.view', 'payments.collect',
        'penalties.view', 'cash.view', 'cash.transfer',
    ];

    public function run(): void
    {
        foreach (['admin' => 'Admin', 'manager' => 'Manager', 'recovery' => 'Recovery'] as $k => $n) {
            DB::table('roles')->updateOrInsert(['key' => $k], ['name' => $n, 'updated_at' => now(), 'created_at' => now()]);
        }
        $all = [];
        foreach (self::PERMISSIONS as $group => $keys) {
            foreach ($keys as $k) {
                $all[] = $k;
                DB::table('permissions')->updateOrInsert(['key' => $k], ['group' => $group, 'updated_at' => now(), 'created_at' => now()]);
            }
        }
        // role → permission defaults are only written when the role has none yet (Admin edits are preserved)
        foreach (['admin' => $all, 'manager' => self::MANAGER, 'recovery' => self::RECOVERY] as $role => $perms) {
            if ($role === 'admin' || !DB::table('role_permissions')->where('role_key', $role)->exists()) {
                DB::table('role_permissions')->where('role_key', $role)->delete();
                DB::table('role_permissions')->insert(array_map(fn ($p) => ['role_key' => $role, 'permission_key' => $p], $perms));
            }
        }
        foreach (['admin', 'manager', 'recovery'] as $r) {
            Cache::forget("perms.$r");
        }

        $defaults = [
            'general' => ['name' => 'Sai Finance', 'address' => '', 'phone' => '', 'language' => 'mr', 'currency' => 'INR', 'date_format' => 'DD/MM/YYYY'],
            'loan_defaults' => ['installments_count' => 10, 'installment_weekday' => 2, 'weekly_amount' => null, 'repayment_ratio' => null],
            'payment_types' => ['cash', 'upi', 'bank', 'other'],
            'recovery_areas' => [],
            'receipt_format' => ['show_logo' => true, 'footer' => 'Thank you'],
            'penalty' => ['manager_can_add' => true],
            'collection_weekday' => 2,
            'pending_sort' => ['by' => 'remaining_installments', 'dir' => 'asc'],
        ];
        foreach ($defaults as $k => $v) {
            if (!FinanceSetting::where('key', $k)->exists()) {
                FinanceSetting::put($k, $v);
            }
        }

        if (!User::where('role', 'admin')->exists()) {
            User::create([
                'name' => 'Administrator', 'username' => env('SEED_ADMIN_USERNAME', 'admin'),
                'password' => env('SEED_ADMIN_PASSWORD', 'ChangeMe@123'), 'role' => 'admin', 'language' => 'mr',
            ]);
        }
        if (!CashLocation::exists()) {
            CashLocation::create(['name' => 'Main Office', 'type' => 'office_cash', 'status' => 'active']);
        }
    }
}

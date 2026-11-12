<?php

use App\Models\AppNotification;
use App\Models\LoanAccount;
use App\Models\User;
use App\Services\AdvanceService;
use App\Services\LedgerService;
use App\Services\LoanMetrics;
use App\Support\Money;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

/**
 * Applies advance balances to installments that have fallen due (e.g. every Tuesday).
 * Safe to run repeatedly – it only moves money that is already on the khata's advance ledger.
 */
Artisan::command('finance:apply-advance', function () {
    $today = now()->toDateString();
    $n = 0;
    $ids = LoanAccount::where('status', 'active')->pluck('id');
    foreach ($ids as $id) {
        DB::transaction(function () use ($id, $today, &$n) {
            $loan = LoanAccount::whereKey($id)->lockForUpdate()->first();
            if (LedgerService::advanceBalance($loan->id) > 0) {
                $n += AdvanceService::applyDue($loan, $today) > 0 ? 1 : 0;
            }
        });
    }
    $this->info("Advance applied on $n khata(s).");
})->purpose('Apply advance balances to due installments');

/** Morning reminder for recovery staff / managers with today's expected collection. */
Artisan::command('finance:notify-due', function () {
    $today = now()->toDateString();
    $loans = LoanMetrics::query($today)->where('loan_accounts.status', 'active')->with('customer.assignment')->get();
    $byStaff = [];
    foreach ($loans as $l) {
        $m = LoanMetrics::format($l);
        $rid = $l->customer?->assignment?->recovery_user_id;
        if ($rid && Money::p($m['net_due_now']) > 0) {
            $byStaff[$rid]['n'] = ($byStaff[$rid]['n'] ?? 0) + 1;
            $byStaff[$rid]['amt'] = ($byStaff[$rid]['amt'] ?? 0) + Money::p($m['net_due_now']);
        }
    }
    foreach ($byStaff as $uid => $s) {
        AppNotification::create([
            'user_id' => $uid, 'type' => 'due_today', 'title' => 'Collection due',
            'body' => "{$s['n']} khata • ₹" . Money::s($s['amt']), 'data' => ['count' => $s['n'], 'amount' => Money::s($s['amt'])],
        ]);
    }
    $this->info('Notified ' . count($byStaff) . ' staff.');
})->purpose('Create due-collection notifications');

Schedule::command('finance:apply-advance')->dailyAt('00:10');
Schedule::command('finance:notify-due')->dailyAt('07:00');
Schedule::command('sanctum:prune-expired --hours=24')->daily();

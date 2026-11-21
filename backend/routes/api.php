<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CashController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\GuarantorController;
use App\Http\Controllers\Api\LoanAccountController;
use App\Http\Controllers\Api\MediaController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\PenaltyController;
use App\Http\Controllers\Api\RecoveryListController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\SheetController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

// ---- public ---------------------------------------------------------------------------------------------
Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::get('media', [MediaController::class, 'show'])->middleware('signed:relative')->name('media');

// ---- authenticated (Sanctum token) ----------------------------------------------------------------------------
Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::post('logout', [AuthController::class, 'logout']);
    Route::get('me', [AuthController::class, 'me']);
    Route::post('me/password', [AuthController::class, 'changePassword']);
    Route::post('me/language', [AuthController::class, 'language']);

    Route::get('dashboard', [DashboardController::class, 'index'])->middleware('permission:dashboard.view');

    // customers
    Route::middleware('permission:customers.view')->group(function () {
        Route::get('customers', [CustomerController::class, 'index']);
        Route::get('customers/{customer}', [CustomerController::class, 'show']);
        Route::get('customers/{customer}/ledger', [CustomerController::class, 'ledger']);
        Route::get('customers/{customer}/advance-ledger', [CustomerController::class, 'advanceLedger']);
        Route::get('customers/{customer}/guarantors', [GuarantorController::class, 'index']);
    });
    Route::get('customers/{customer}/documents/{type}', [CustomerController::class, 'document'])->middleware('permission:customers.documents');
    Route::post('customers', [CustomerController::class, 'store'])->middleware('permission:customers.create');
    // multipart uploads cannot use PUT in PHP – the SPA posts with _method=PUT
    Route::match(['put', 'post'], 'customers/{customer}', [CustomerController::class, 'update'])->middleware('permission:customers.update');
    Route::post('customers/{customer}/guarantors', [GuarantorController::class, 'store'])->middleware('permission:customers.update');
    Route::match(['put', 'post'], 'guarantors/{guarantor}', [GuarantorController::class, 'update'])->middleware('permission:customers.update');
    Route::post('customers/{customer}/assign', [CustomerController::class, 'assignOne'])->middleware('permission:recovery.assign');

    // loan accounts (khata)
    Route::post('loan-accounts/preview', [LoanAccountController::class, 'preview'])->middleware('permission:loans.create');
    Route::get('loan-accounts', [LoanAccountController::class, 'index'])->middleware('permission:loans.view');
    Route::post('loan-accounts', [LoanAccountController::class, 'store'])->middleware('permission:loans.create');
    Route::get('loan-accounts/{loanAccount}', [LoanAccountController::class, 'show'])->middleware('permission:loans.view');
    Route::put('loan-accounts/{loanAccount}', [LoanAccountController::class, 'update'])->middleware('permission:loans.update');
    Route::get('loan-accounts/{loanAccount}/installments', [LoanAccountController::class, 'installments'])->middleware('permission:loans.view');
    Route::post('loan-accounts/{loanAccount}/close', [LoanAccountController::class, 'close'])->middleware('permission:loans.close');
    Route::post('loan-accounts/{loanAccount}/advance-refund', [LoanAccountController::class, 'refundAdvance'])->middleware('permission:advance.refund');

    // collection
    Route::get('collection/search', [RecoveryListController::class, 'search'])->middleware('permission:payments.collect');
    Route::get('collection/today', [RecoveryListController::class, 'today'])->middleware('permission:payments.collect');
    Route::get('payments', [PaymentController::class, 'index'])->middleware('permission:payments.view');
    Route::post('payments', [PaymentController::class, 'store'])->middleware('permission:payments.collect');
    Route::post('payments/sync', [PaymentController::class, 'sync'])->middleware('permission:payments.collect');
    Route::get('payments/{payment}', [PaymentController::class, 'show'])->middleware('permission:payments.view');
    Route::get('payments/{payment}/receipt', [PaymentController::class, 'receipt'])->middleware('permission:payments.view');
    Route::post('payments/{payment}/reverse', [PaymentController::class, 'reverse'])->middleware('permission:payments.reverse');

    // advance
    Route::post('advance-payments', [PaymentController::class, 'store'])->middleware('permission:payments.collect')
        ->defaults('mode', 'advance');
    Route::get('advance-balances', [RecoveryListController::class, 'advances'])->middleware('permission:payments.view');

    // pending / overdue
    Route::get('pending-recovery', [RecoveryListController::class, 'pending'])->middleware('permission:payments.view');
    Route::get('overdue-recovery', [RecoveryListController::class, 'overdue'])->middleware('permission:payments.view');

    // khata sheet (compact list + grid) and week-wise report
    Route::get('khata-sheet', [SheetController::class, 'sheet'])->middleware('permission:payments.view');
    Route::get('weekly-report', [SheetController::class, 'weekly'])->middleware('permission:payments.view');

    // penalties
    Route::get('penalties', [PenaltyController::class, 'index'])->middleware('permission:penalties.view');
    Route::post('penalties', [PenaltyController::class, 'store'])->middleware('permission:penalties.create');
    Route::put('penalties/{penalty}', [PenaltyController::class, 'update'])->middleware('permission:penalties.update');
    Route::post('penalties/{penalty}/waive', [PenaltyController::class, 'waive'])->middleware('permission:penalties.waive');
    Route::post('penalties/{penalty}/reverse', [PenaltyController::class, 'reverse'])->middleware('permission:penalties.reverse');

    // cash
    Route::get('cash-locations', [CashController::class, 'index'])->middleware('permission:cash.view,payments.collect');
    Route::post('cash-locations', [CashController::class, 'store'])->middleware('permission:cash.manage');
    Route::put('cash-locations/{cashLocation}', [CashController::class, 'update'])->middleware('permission:cash.manage');
    Route::get('cash-locations/{cashLocation}/ledger', [CashController::class, 'ledger'])->middleware('permission:cash.view');
    Route::post('cash-locations/{cashLocation}/adjust', [CashController::class, 'adjust'])->middleware('permission:cash.adjust');
    Route::get('cash-transfers', [CashController::class, 'transfers'])->middleware('permission:cash.view');
    Route::post('cash-transfers', [CashController::class, 'transfer'])->middleware('permission:cash.transfer');
    Route::get('cash/opening', [CashController::class, 'opening'])->middleware('permission:cash.opening,cash.manage');
    Route::post('cash/opening', [CashController::class, 'confirmOpening'])->middleware('permission:cash.opening');
    Route::get('expenses', [CashController::class, 'expenses'])->middleware('permission:expenses.manage');
    Route::post('expenses', [CashController::class, 'storeExpense'])->middleware('permission:expenses.manage');

    // users / recovery staff
    Route::get('users', [UserController::class, 'index'])->middleware('permission:recovery.view,users.manage,managers.manage');
    Route::post('users', [UserController::class, 'store'])->middleware('permission:recovery.manage,users.manage,managers.manage');
    Route::put('users/{user}', [UserController::class, 'update'])->middleware('permission:recovery.manage,users.manage,managers.manage');
    Route::get('users/{user}/performance', [UserController::class, 'performance'])->middleware('permission:dashboard.view');
    Route::post('recovery/assign', [UserController::class, 'assign'])->middleware('permission:recovery.assign');

    // reports
    Route::get('reports/{key}', [ReportController::class, 'show'])->middleware('permission:reports.view');

    // settings, security
    Route::get('settings', [SettingsController::class, 'show'])->middleware('permission:settings.view');
    Route::put('settings', [SettingsController::class, 'update'])->middleware('permission:settings.manage');
    Route::post('settings/logo', [SettingsController::class, 'logo'])->middleware('permission:settings.manage');
    Route::get('settings/permissions', [SettingsController::class, 'permissions'])->middleware('permission:settings.manage');
    Route::put('settings/permissions', [SettingsController::class, 'updatePermissions'])->middleware('permission:settings.manage');
    Route::get('audit-logs', [SettingsController::class, 'audit'])->middleware('permission:audit.view');

    Route::get('notifications', [SettingsController::class, 'notifications']);
    Route::post('notifications/read', [SettingsController::class, 'readNotifications']);
});

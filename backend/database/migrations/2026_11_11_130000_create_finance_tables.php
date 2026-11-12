<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Core finance schema. All money columns are DECIMAL(14,2) – never FLOAT.
 * Financial rows (payments, ledgers) are immutable; corrections are reversal rows.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('counters', function (Blueprint $t) {
            $t->string('name', 40)->primary();
            $t->unsignedBigInteger('value')->default(0);
        });

        Schema::create('finance_settings', function (Blueprint $t) {
            $t->string('key', 80)->primary();
            $t->json('value')->nullable();
            $t->timestamps();
        });

        Schema::create('cash_locations', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->string('type', 20)->default('office_cash'); // office_cash | recovery_cash | bank_account | other
            $t->foreignId('responsible_user_id')->nullable()->constrained('users')->nullOnDelete();
            $t->decimal('opening_balance', 14, 2)->default(0);
            $t->decimal('current_balance', 14, 2)->default(0);
            $t->string('status', 10)->default('active')->index();
            $t->text('notes')->nullable();
            $t->timestamps();
        });

        Schema::create('customers', function (Blueprint $t) {
            $t->id();
            $t->string('name')->index();
            $t->string('mobile', 15)->index();
            $t->string('alt_mobile', 15)->nullable();
            $t->string('occupation')->nullable();
            $t->string('photo_path')->nullable();
            $t->string('area')->nullable()->index();
            $t->text('notes')->nullable();
            $t->string('status', 10)->default('active')->index();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('customer_addresses', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $t->string('type', 15)->default('residence');
            $t->text('address');
            $t->string('village')->nullable()->index();
            $t->string('taluka')->nullable();
            $t->string('district')->nullable();
            $t->string('state')->nullable();
            $t->string('pincode', 10)->nullable();
            $t->decimal('lat', 10, 7)->nullable();
            $t->decimal('lng', 10, 7)->nullable();
            $t->timestamps();
        });

        // Aadhaar / PAN – numbers + private files
        Schema::create('customer_documents', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $t->string('type', 15); // aadhaar | pan
            $t->text('number')->nullable(); // encrypted
            $t->string('file_path')->nullable(); // private disk
            $t->timestamps();
            $t->unique(['customer_id', 'type']);
        });

        Schema::create('guarantors', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('mobile', 15)->nullable();
            $t->string('photo_path')->nullable();
            $t->text('address')->nullable();
            $t->string('village')->nullable();
            $t->string('taluka')->nullable();
            $t->string('district')->nullable();
            $t->decimal('lat', 10, 7)->nullable();
            $t->decimal('lng', 10, 7)->nullable();
            $t->text('aadhaar_no')->nullable(); // encrypted
            $t->timestamps();
        });

        Schema::create('loan_accounts', function (Blueprint $t) {
            $t->id();
            $t->string('khata_no', 30)->unique();
            $t->foreignId('customer_id')->constrained();
            $t->date('start_date');
            $t->date('disbursement_date');
            $t->decimal('principal_amount', 14, 2);
            $t->decimal('total_repayment', 14, 2);
            $t->unsignedSmallInteger('installments_count');
            $t->decimal('weekly_amount', 14, 2);
            $t->unsignedTinyInteger('installment_weekday')->default(2); // 0=Sun … 2=Tue
            $t->date('first_installment_date');
            $t->decimal('processing_charges', 14, 2)->default(0);
            $t->decimal('additional_charges', 14, 2)->default(0);
            $t->decimal('old_khata_outstanding', 14, 2)->default(0);
            $t->decimal('old_khata_paid', 14, 2)->default(0);
            $t->foreignId('guarantor1_id')->nullable()->constrained('guarantors')->nullOnDelete();
            $t->foreignId('guarantor2_id')->nullable()->constrained('guarantors')->nullOnDelete();
            $t->foreignId('disbursed_from_location_id')->nullable()->constrained('cash_locations')->nullOnDelete();
            $t->text('notes')->nullable();
            $t->string('status', 10)->default('active')->index(); // active | closed
            $t->timestamp('closed_at')->nullable();
            $t->foreignId('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->string('close_type', 15)->nullable(); // full | settlement
            $t->text('close_note')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['customer_id', 'status']);
        });

        Schema::create('loan_installments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('loan_account_id')->constrained()->cascadeOnDelete();
            $t->unsignedSmallInteger('number');
            $t->date('due_date')->index();
            $t->decimal('expected_amount', 14, 2);
            $t->decimal('paid_amount', 14, 2)->default(0);
            $t->decimal('advance_applied', 14, 2)->default(0); // part of paid_amount that came from advance
            $t->decimal('waived_amount', 14, 2)->default(0);   // written off in an authorised settlement
            $t->string('state', 20)->default('open'); // open | partial | paid | advanced_covered | settled
            $t->timestamp('paid_at')->nullable();
            $t->timestamps();
            $t->unique(['loan_account_id', 'number']);
            $t->index(['loan_account_id', 'state']);
        });

        Schema::create('payments', function (Blueprint $t) {
            $t->id();
            $t->string('receipt_no', 30)->unique();
            $t->string('idempotency_key', 64)->nullable()->unique();
            $t->foreignId('loan_account_id')->constrained();
            $t->foreignId('customer_id')->constrained();
            $t->date('payment_date')->index();
            $t->decimal('amount', 14, 2);
            $t->string('payment_type', 15)->default('cash'); // cash | upi | bank | other
            $t->foreignId('cash_location_id')->constrained('cash_locations');
            $t->foreignId('collected_by')->constrained('users');
            $t->foreignId('created_by')->constrained('users');
            $t->string('reference')->nullable();
            $t->text('notes')->nullable();
            $t->string('mode', 10)->default('auto'); // auto | advance
            $t->string('status', 10)->default('completed')->index(); // completed | reversed
            $t->timestamp('reversed_at')->nullable();
            $t->foreignId('reversed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->text('reversal_reason')->nullable();
            $t->boolean('is_offline')->default(false);
            $t->timestamps();
            $t->index(['payment_date', 'status']);
        });

        Schema::create('penalties', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained();
            $t->foreignId('loan_account_id')->constrained();
            $t->foreignId('installment_id')->nullable()->constrained('loan_installments')->nullOnDelete();
            $t->unsignedSmallInteger('installment_number')->nullable();
            $t->decimal('amount', 14, 2);
            $t->decimal('paid_amount', 14, 2)->default(0);
            $t->decimal('waived_amount', 14, 2)->default(0);
            $t->date('penalty_date');
            $t->text('reason')->nullable();
            $t->string('status', 10)->default('open')->index(); // open | partial | paid | waived | reversed
            $t->foreignId('added_by')->constrained('users');
            $t->foreignId('waived_by')->nullable()->constrained('users')->nullOnDelete();
            $t->text('waive_reason')->nullable();
            $t->foreignId('reversed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->text('reverse_reason')->nullable();
            $t->timestamps();
        });

        Schema::create('payment_allocations', function (Blueprint $t) {
            $t->id();
            $t->foreignId('payment_id')->constrained()->cascadeOnDelete();
            $t->string('type', 20); // installment | penalty | old_khata | advance_deposit
            $t->foreignId('loan_installment_id')->nullable()->constrained('loan_installments')->nullOnDelete();
            $t->foreignId('penalty_id')->nullable()->constrained('penalties')->nullOnDelete();
            $t->decimal('amount', 14, 2);
            $t->timestamps();
            $t->index(['payment_id', 'type']);
        });

        Schema::create('customer_ledger', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained();
            $t->foreignId('loan_account_id')->nullable()->constrained();
            $t->date('entry_date')->index();
            $t->string('type', 30)->index();
            $t->decimal('debit', 14, 2)->default(0);   // increases what customer owes
            $t->decimal('credit', 14, 2)->default(0);  // decreases what customer owes
            $t->decimal('balance', 14, 2)->default(0); // running balance for the customer (debit - credit)
            $t->string('description')->nullable();
            $t->foreignId('payment_id')->nullable()->constrained();
            $t->foreignId('penalty_id')->nullable()->constrained();
            $t->unsignedBigInteger('reverses_id')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['customer_id', 'id']);
        });

        Schema::create('advance_ledger', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained();
            $t->foreignId('loan_account_id')->constrained();
            $t->date('entry_date')->index();
            $t->string('type', 15); // deposit | applied | refund | reversal
            $t->decimal('credit', 14, 2)->default(0); // adds to advance balance
            $t->decimal('debit', 14, 2)->default(0);  // reduces advance balance
            $t->decimal('balance', 14, 2)->default(0); // running balance for the loan
            $t->foreignId('payment_id')->nullable()->constrained();
            $t->foreignId('installment_id')->nullable()->constrained('loan_installments')->nullOnDelete();
            $t->string('description')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['loan_account_id', 'id']);
        });

        Schema::create('cash_transfers', function (Blueprint $t) {
            $t->id();
            $t->foreignId('from_location_id')->constrained('cash_locations');
            $t->foreignId('to_location_id')->constrained('cash_locations');
            $t->decimal('amount', 14, 2);
            $t->date('transfer_date');
            $t->text('notes')->nullable();
            $t->string('status', 10)->default('completed');
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });

        Schema::create('expenses', function (Blueprint $t) {
            $t->id();
            $t->foreignId('cash_location_id')->constrained('cash_locations');
            $t->decimal('amount', 14, 2);
            $t->date('expense_date');
            $t->string('category', 60)->nullable();
            $t->text('description')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });

        Schema::create('cash_ledger', function (Blueprint $t) {
            $t->id();
            $t->foreignId('cash_location_id')->constrained('cash_locations');
            $t->date('entry_date')->index();
            // opening | collection | transfer_in | transfer_out | disbursement | expense | adjustment | reversal | refund
            $t->string('type', 20)->index();
            $t->decimal('inflow', 14, 2)->default(0);
            $t->decimal('outflow', 14, 2)->default(0);
            $t->decimal('balance', 14, 2)->default(0);
            $t->foreignId('payment_id')->nullable()->constrained();
            $t->foreignId('cash_transfer_id')->nullable()->constrained();
            $t->foreignId('expense_id')->nullable()->constrained();
            $t->foreignId('loan_account_id')->nullable()->constrained();
            $t->string('description')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['cash_location_id', 'id']);
        });

        Schema::create('opening_balances', function (Blueprint $t) {
            $t->id();
            $t->foreignId('cash_location_id')->constrained('cash_locations');
            $t->date('week_date'); // the Monday
            $t->decimal('system_amount', 14, 2);   // previous closing
            $t->decimal('adjustment', 14, 2)->default(0);
            $t->decimal('opening_amount', 14, 2);
            $t->text('adjustment_note')->nullable();
            $t->foreignId('confirmed_by')->constrained('users');
            $t->timestamp('confirmed_at');
            $t->timestamps();
            $t->unique(['cash_location_id', 'week_date']);
        });

        Schema::create('recovery_assignments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('recovery_user_id')->constrained('users')->cascadeOnDelete();
            $t->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $t->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique('customer_id'); // one active recovery person per customer
        });

        Schema::create('audit_logs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('action', 60)->index();
            $t->string('entity_type', 40)->nullable();
            $t->unsignedBigInteger('entity_id')->nullable();
            $t->json('old_values')->nullable();
            $t->json('new_values')->nullable();
            $t->string('ip', 45)->nullable();
            $t->string('user_agent')->nullable();
            $t->timestamp('created_at')->useCurrent()->index();
            $t->index(['entity_type', 'entity_id']);
        });

        Schema::create('notifications', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('type', 40);
            $t->string('title');
            $t->text('body')->nullable();
            $t->json('data')->nullable();
            $t->timestamp('read_at')->nullable();
            $t->timestamps();
            $t->index(['user_id', 'read_at']);
        });
    }

    public function down(): void
    {
        foreach (['notifications', 'audit_logs', 'recovery_assignments', 'opening_balances', 'cash_ledger', 'expenses',
                  'cash_transfers', 'advance_ledger', 'customer_ledger', 'payment_allocations', 'penalties', 'payments',
                  'loan_installments', 'loan_accounts', 'guarantors', 'customer_documents', 'customer_addresses',
                  'customers', 'cash_locations', 'finance_settings', 'counters'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};

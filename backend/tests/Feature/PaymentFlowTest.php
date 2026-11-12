<?php

namespace Tests\Feature;

use App\Models\CashLedger;
use App\Models\CashLocation;
use App\Models\CustomerLedger;
use App\Models\Payment;
use App\Services\CashService;
use App\Services\LoanMetrics;
use App\Services\LoanService;
use App\Services\PaymentService;
use App\Services\PenaltyService;
use App\Support\Money;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

class PaymentFlowTest extends FinanceTestCase
{
    private function pay($loan, $amount, array $extra = [], $by = null)
    {
        return PaymentService::collect($extra + [
            'loan_account_id' => $loan->id, 'amount' => $amount, 'payment_type' => 'cash',
            'cash_location_id' => $this->recCash->id, 'collected_by' => $this->recovery->id,
        ], $by ?? $this->recovery)[0];
    }

    private function m($loan): array
    {
        return LoanMetrics::format(LoanMetrics::query()->findOrFail($loan->id));
    }

    public function test_exact_installment_payment(): void
    {
        $loan = $this->loan($this->customer());
        $p = $this->pay($loan, 10000);
        $this->assertSame('paid', $loan->installments()->first()->state);
        $this->assertSame('0.00', $this->m($loan)['advance_balance']);
        $this->assertSame(9, $this->m($loan)['remaining_installments']);
        $this->assertStringStartsWith('SF-R26-', $p->receipt_no);
        $this->assertSame('10000.00', $this->recCash->fresh()->current_balance);
    }

    public function test_overpayment_becomes_advance_and_is_applied_next_tuesday_without_double_counting(): void
    {
        $loan = $this->loan($this->customer());
        $this->pay($loan, 15000);
        $m = $this->m($loan);
        $this->assertSame('5000.00', $m['advance_balance']);
        $this->assertSame('90000.00', $m['remaining_loan']);

        Carbon::setTestNow('2026-11-17 09:00:00'); // next Tuesday
        $m = $this->m($loan);
        $this->assertSame('10000.00', $m['due_now']);
        $this->assertSame('5000.00', $m['net_due_now'], 'advance reduces what is asked from the customer');

        $this->pay($loan, 5000);
        $i2 = $loan->installments()->where('number', 2)->first();
        $this->assertSame('10000.00', $i2->paid_amount);
        $this->assertSame('5000.00', $i2->advance_applied);
        $this->assertSame('paid', $i2->state);
        $this->assertSame('0.00', $this->m($loan)['advance_balance']);
        // cash is 15000 + 5000 only – applying advance never creates cash
        $this->assertSame('20000.00', $this->recCash->fresh()->current_balance);
        $this->assertSame(20000.0, (float) Payment::where('status', 'completed')->sum('amount'));
    }

    public function test_partial_payment_and_overdue_status(): void
    {
        $loan = $this->loan($this->customer());
        $this->pay($loan, 4000);
        $i = $loan->installments()->first();
        $this->assertSame('partial', $i->state);
        $this->assertSame('6000.00', Money::s($i->remainingPaise()));
        $this->assertSame('partially_paid', $i->displayStatus('2026-11-10'));
        $this->assertSame('overdue', $i->displayStatus('2026-11-11'));
        Carbon::setTestNow('2026-11-11');
        $this->assertSame('6000.00', $this->m($loan)['net_overdue']);
        Carbon::setTestNow('2026-11-18'); // installment 2 (10,000) is now overdue as well
        $this->assertSame('16000.00', $this->m($loan)['net_overdue']);
    }

    public function test_payment_covers_oldest_dues_first(): void
    {
        $loan = $this->loan($this->customer());
        Carbon::setTestNow('2026-11-24 10:00:00'); // installments 1,2,3 are due
        $this->pay($loan, 25000);
        $s = $loan->installments()->pluck('state', 'number');
        $this->assertSame('paid', $s[1]);
        $this->assertSame('paid', $s[2]);
        $this->assertSame('partial', $s[3]);
    }

    public function test_cannot_exceed_outstanding(): void
    {
        $loan = $this->loan($this->customer());
        $this->expectException(ValidationException::class);
        $this->pay($loan, 150000);
    }

    public function test_penalty_collected_separately_from_principal(): void
    {
        $loan = $this->loan($this->customer());
        $pen = PenaltyService::add(['loan_account_id' => $loan->id, 'installment_number' => 1, 'amount' => 500, 'reason' => 'missed'], $this->admin);
        $this->assertSame('500.00', $this->m($loan)['penalty_outstanding']);
        $this->pay($loan, 10500, ['penalty_amount' => 500]);
        $this->assertSame('paid', $pen->fresh()->status);
        $this->assertSame('paid', $loan->installments()->first()->state);
        $this->assertDatabaseHas('payment_allocations', ['type' => 'penalty', 'amount' => '500.00']);
        $this->assertDatabaseHas('payment_allocations', ['type' => 'installment', 'amount' => '10000.00']);
        $this->expectException(ValidationException::class);
        PenaltyService::update($pen->fresh(), ['amount' => 100], $this->admin);
    }

    public function test_waive_penalty(): void
    {
        $loan = $this->loan($this->customer());
        $pen = PenaltyService::add(['loan_account_id' => $loan->id, 'amount' => 300], $this->admin);
        PenaltyService::waive($pen, 'festival', $this->admin);
        $this->assertSame('0.00', $this->m($loan)['penalty_outstanding']);
        $this->assertSame('waived', $pen->fresh()->status);
    }

    public function test_old_khata_collection(): void
    {
        $loan = $this->loan($this->customer(), ['old_khata_outstanding' => 5000]);
        $this->assertSame('5000.00', $this->m($loan)['old_khata_remaining']);
        $this->pay($loan, 15000, ['old_khata_amount' => 5000]);
        $this->assertSame('0.00', $this->m($loan)['old_khata_remaining']);
        $this->assertSame('paid', $loan->installments()->first()->state);
    }

    public function test_duplicate_submission_is_idempotent(): void
    {
        $loan = $this->loan($this->customer());
        $d = ['loan_account_id' => $loan->id, 'amount' => 3000, 'payment_type' => 'cash', 'cash_location_id' => $this->recCash->id, 'idempotency_key' => 'abc-123'];
        [$a, $d1] = PaymentService::collect($d, $this->recovery);
        [$b, $d2] = PaymentService::collect($d, $this->recovery);
        $this->assertFalse($d1);
        $this->assertTrue($d2);
        $this->assertSame($a->id, $b->id);
        $this->assertSame(1, Payment::count());
        $this->assertSame('3000.00', $this->recCash->fresh()->current_balance);
    }

    public function test_reversal_restores_everything_and_keeps_history(): void
    {
        $loan = $this->loan($this->customer());
        $p = $this->pay($loan, 15000);
        PaymentService::reverse($p, $this->admin, 'wrong entry');
        $this->assertSame('reversed', $p->fresh()->status);
        $this->assertSame('open', $loan->installments()->first()->state);
        $this->assertSame('0.00', $this->m($loan)['advance_balance']);
        $this->assertSame('0.00', $this->recCash->fresh()->current_balance);
        $this->assertDatabaseHas('payments', ['id' => $p->id, 'amount' => '15000.00']);
        $this->assertDatabaseHas('customer_ledger', ['type' => 'reversal', 'payment_id' => $p->id]);
        $bal = CustomerLedger::where('customer_id', $loan->customer_id)->orderByDesc('id')->value('balance');
        $this->assertSame('100000.00', $bal, 'customer owes the full amount again');
    }

    public function test_only_latest_payment_can_be_reversed(): void
    {
        $loan = $this->loan($this->customer());
        $first = $this->pay($loan, 1000);
        $this->pay($loan, 1000);
        $this->expectException(ValidationException::class);
        PaymentService::reverse($first, $this->admin, 'nope');
    }

    public function test_cash_transfer_keeps_total_company_cash(): void
    {
        $loan = $this->loan($this->customer());
        $this->pay($loan, 10000);
        $before = Money::p(CashLocation::sum('current_balance'));
        CashService::transfer(['from_location_id' => $this->recCash->id, 'to_location_id' => $this->office->id, 'amount' => 4000], $this->recovery);
        $this->assertSame('6000.00', $this->recCash->fresh()->current_balance);
        $this->assertSame($before, Money::p(CashLocation::sum('current_balance')));
        $this->expectException(ValidationException::class);
        CashService::transfer(['from_location_id' => $this->recCash->id, 'to_location_id' => $this->office->id, 'amount' => 999999], $this->recovery);
    }

    public function test_cash_ledger_balance_matches_location_balance(): void
    {
        $loan = $this->loan($this->customer());
        $this->pay($loan, 7000);
        CashService::transfer(['from_location_id' => $this->recCash->id, 'to_location_id' => $this->office->id, 'amount' => 2000], $this->admin);
        foreach (CashLocation::all() as $l) {
            $net = CashLedger::where('cash_location_id', $l->id)->selectRaw('sum(inflow) - sum(outflow) as n')->value('n');
            $this->assertEquals((float) $l->current_balance, (float) $net);
        }
    }

    public function test_close_requires_zero_outstanding(): void
    {
        $loan = $this->loan($this->customer(), ['installments_count' => 1, 'total_repayment' => 90000, 'principal_amount' => 80000]);
        try {
            LoanService::close($loan, [], $this->admin);
            $this->fail('must not close with outstanding balance');
        } catch (ValidationException) {
            $this->addToAssertionCount(1);
        }
        $this->pay($loan, 90000);
        $closed = LoanService::close($loan, [], $this->admin);
        $this->assertSame('closed', $closed->status);
        $this->assertSame('full', $closed->close_type);
    }

    public function test_settlement_only_by_admin(): void
    {
        $loan = $this->loan($this->customer());
        $this->expectException(ValidationException::class);
        LoanService::close($loan, ['settlement' => true], $this->manager);
    }

    public function test_advance_covered_installment_and_closing(): void
    {
        $loan = $this->loan($this->customer(), ['installments_count' => 2, 'total_repayment' => 20000, 'principal_amount' => 16000]);
        $this->pay($loan, 20000); // 10000 installment 1 + 10000 advance (== remaining installment 2)
        $this->assertSame('10000.00', $this->m($loan)['advance_balance']);
        $closed = LoanService::close($loan, [], $this->admin);   // closing applies the advance to installment 2
        $this->assertSame('closed', $closed->status);
        $this->assertSame('advanced_covered', $loan->installments()->where('number', 2)->first()->state);
    }
}

<?php

namespace Tests\Feature;

use App\Services\LoanCalculator;
use App\Support\Money;
use Illuminate\Validation\ValidationException;

class LoanCalculationTest extends FinanceTestCase
{
    public function test_example_loan_generates_ten_tuesday_installments(): void
    {
        $loan = $this->loan($this->customer());
        $this->assertSame('SF-K00001', $loan->khata_no);
        $this->assertCount(10, $loan->installments);
        $this->assertSame('2026-11-10', $loan->installments[0]->due_date->toDateString());
        $this->assertSame('2027-01-12', $loan->installments[9]->due_date->toDateString());
        foreach ($loan->installments as $i) {
            $this->assertSame(2, $i->due_date->dayOfWeek, 'every installment falls on Tuesday');
            $this->assertSame('10000.00', $i->expected_amount);
        }
        $this->assertSame('100000.00', $loan->total_repayment);
    }

    public function test_preview_values_and_monday_start_goes_to_next_tuesday(): void
    {
        $p = LoanCalculator::preview(['principal_amount' => 80000, 'total_repayment' => 100000, 'installments_count' => 10, 'disbursement_date' => '2026-11-09']);
        $this->assertSame('20000.00', $p['finance_charges']);
        $this->assertSame('10000.00', $p['weekly_amount']);
        $this->assertSame('2026-11-10', $p['first_installment_date']);
        $this->assertSame('2027-01-12', $p['final_due_date']);
    }

    public function test_last_installment_absorbs_rounding(): void
    {
        $p = LoanCalculator::preview(['principal_amount' => 10000, 'total_repayment' => 12500, 'installments_count' => 3, 'weekly_amount' => 4200, 'disbursement_date' => '2026-11-09']);
        $this->assertSame('4100.00', $p['last_installment_amount']);
        $sum = array_sum(array_map(fn ($r) => Money::p($r['amount']), $p['schedule']));
        $this->assertSame(1250000, $sum);
    }

    public function test_invalid_terms_rejected(): void
    {
        $this->expectException(ValidationException::class);
        LoanCalculator::preview(['principal_amount' => 80000, 'total_repayment' => 70000, 'installments_count' => 10]);
    }

    public function test_money_helper_is_decimal_safe(): void
    {
        $this->assertSame(1999, Money::p('19.99'));
        $this->assertSame('0.30', Money::s(Money::p('0.1') + Money::p('0.2')));
    }

    public function test_old_khata_is_separate_from_principal(): void
    {
        $loan = $this->loan($this->customer(), ['old_khata_outstanding' => 5000]);
        $this->assertSame('100000.00', $loan->total_repayment);
        $this->assertSame('5000.00', $loan->old_khata_outstanding);
        $this->assertDatabaseHas('customer_ledger', ['loan_account_id' => $loan->id, 'type' => 'old_khata', 'debit' => '5000.00']);
    }
}

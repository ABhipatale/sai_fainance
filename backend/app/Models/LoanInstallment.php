<?php

namespace App\Models;

use App\Support\Money;
use Illuminate\Database\Eloquent\Model;

class LoanInstallment extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['expected_amount', 'paid_amount', 'advance_applied', 'waived_amount'];
    protected $guarded = [];
    protected $casts = ['due_date' => 'date:Y-m-d', 'paid_at' => 'datetime'];

    public function loan()
    {
        return $this->belongsTo(LoanAccount::class, 'loan_account_id');
    }

    public function remainingPaise(): int
    {
        return max(0, Money::p($this->expected_amount) - Money::p($this->paid_amount) - Money::p($this->waived_amount));
    }

    /** Recompute the stored payment state from amounts. Does not save. */
    public function refreshState(): void
    {
        $exp = Money::p($this->expected_amount);
        $paid = Money::p($this->paid_amount);
        $adv = Money::p($this->advance_applied);
        $rem = $this->remainingPaise();

        if ($rem === 0) {
            if (Money::p($this->waived_amount) > 0) {
                $this->state = 'settled';
            } elseif ($adv >= $exp) {
                $this->state = 'advanced_covered';
            } else {
                $this->state = 'paid';
            }
            $this->paid_at ??= now();
        } else {
            $this->state = $paid > 0 ? 'partial' : 'open';
            $this->paid_at = null;
        }
    }

    /** upcoming | pending | partially_paid | paid | overdue | advanced_covered | settled */
    public function displayStatus(?string $today = null): string
    {
        return self::statusFor($this->state, $this->due_date->toDateString(), Money::p($this->paid_amount), $today);
    }

    public static function statusFor(string $state, string $due, int $paidPaise, ?string $today = null): string
    {
        $today ??= now()->toDateString();
        if (in_array($state, ['paid', 'advanced_covered', 'settled'], true)) {
            return $state;
        }
        if ($due < $today) {
            return 'overdue';
        }
        if ($paidPaise > 0) {
            return 'partially_paid';
        }
        return $due === $today ? 'pending' : 'upcoming';
    }
}

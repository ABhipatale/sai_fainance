<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Penalty extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['amount', 'paid_amount', 'waived_amount'];
    protected $guarded = [];
    protected $casts = ["penalty_date" => "date:Y-m-d"];
    public function customer() { return $this->belongsTo(Customer::class); }
    public function loan() { return $this->belongsTo(LoanAccount::class, "loan_account_id"); }
    public function adder() { return $this->belongsTo(User::class, "added_by"); }
    public function outstandingPaise(): int
    {
        if (in_array($this->status, ["waived", "reversed"], true)) { return 0; }
        return max(0, \App\Support\Money::p($this->amount) - \App\Support\Money::p($this->paid_amount) - \App\Support\Money::p($this->waived_amount));
    }
}

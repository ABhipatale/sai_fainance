<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['amount'];
    protected $guarded = [];
    protected $casts = ["payment_date" => "date:Y-m-d", "reversed_at" => "datetime", "is_offline" => "boolean"];
    public function loan() { return $this->belongsTo(LoanAccount::class, "loan_account_id"); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function allocations() { return $this->hasMany(PaymentAllocation::class); }
    public function cashLocation() { return $this->belongsTo(CashLocation::class); }
    public function collector() { return $this->belongsTo(User::class, "collected_by"); }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PaymentAllocation extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['amount'];
    protected $guarded = [];
    public function installment() { return $this->belongsTo(LoanInstallment::class, "loan_installment_id"); }
    public function penalty() { return $this->belongsTo(Penalty::class); }
}

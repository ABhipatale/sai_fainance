<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomerLedger extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['debit', 'credit', 'balance'];
    protected $guarded = [];
    protected $table = "customer_ledger";
    protected $casts = ["entry_date" => "date:Y-m-d"];
    public function creator() { return $this->belongsTo(User::class, "created_by"); }
    public function loan() { return $this->belongsTo(LoanAccount::class, "loan_account_id"); }
}

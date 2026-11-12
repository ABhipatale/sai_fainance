<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Expense extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['amount'];
    protected $guarded = [];
    protected $casts = ["expense_date" => "date:Y-m-d"];
    public function location() { return $this->belongsTo(CashLocation::class, "cash_location_id"); }
    public function creator() { return $this->belongsTo(User::class, "created_by"); }
}

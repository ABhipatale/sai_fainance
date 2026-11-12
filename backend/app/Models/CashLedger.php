<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CashLedger extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['inflow', 'outflow', 'balance'];
    protected $guarded = [];
    protected $table = "cash_ledger";
    protected $casts = ["entry_date" => "date:Y-m-d"];
    public function creator() { return $this->belongsTo(User::class, "created_by"); }
    public function location() { return $this->belongsTo(CashLocation::class, "cash_location_id"); }
}

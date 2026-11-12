<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OpeningBalance extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['system_amount', 'adjustment', 'opening_amount'];
    protected $guarded = [];
    protected $casts = ["week_date" => "date:Y-m-d", "confirmed_at" => "datetime"];
    public function location() { return $this->belongsTo(CashLocation::class, "cash_location_id"); }
}

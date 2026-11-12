<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CashTransfer extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['amount'];
    protected $guarded = [];
    protected $casts = ["transfer_date" => "date:Y-m-d"];
    public function from() { return $this->belongsTo(CashLocation::class, "from_location_id"); }
    public function to() { return $this->belongsTo(CashLocation::class, "to_location_id"); }
    public function creator() { return $this->belongsTo(User::class, "created_by"); }
}

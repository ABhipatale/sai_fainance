<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CashLocation extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['opening_balance', 'current_balance'];
    protected $guarded = [];
    public function responsible() { return $this->belongsTo(User::class, "responsible_user_id"); }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RecoveryAssignment extends Model
{
    protected $guarded = [];
    public function customer() { return $this->belongsTo(Customer::class); }
    public function recovery() { return $this->belongsTo(User::class, "recovery_user_id"); }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    protected $guarded = [];
    public function address() { return $this->hasOne(CustomerAddress::class); }
    public function documents() { return $this->hasMany(CustomerDocument::class); }
    public function guarantors() { return $this->hasMany(Guarantor::class); }
    public function loans() { return $this->hasMany(LoanAccount::class); }
    public function assignment() { return $this->hasOne(RecoveryAssignment::class); }
    public function creator() { return $this->belongsTo(User::class, "created_by"); }
}

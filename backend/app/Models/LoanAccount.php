<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LoanAccount extends Model
{
    use \App\Models\Concerns\HasMoney;

    protected array $moneyColumns = ['principal_amount', 'total_repayment', 'weekly_amount', 'processing_charges', 'additional_charges', 'old_khata_outstanding', 'old_khata_paid'];
    protected $guarded = [];
    protected $casts = [
        "start_date" => "date:Y-m-d", "disbursement_date" => "date:Y-m-d", "first_installment_date" => "date:Y-m-d",
        "closed_at" => "datetime",
    ];
    public function customer() { return $this->belongsTo(Customer::class); }
    public function installments() { return $this->hasMany(LoanInstallment::class)->orderBy("number"); }
    public function payments() { return $this->hasMany(Payment::class); }
    public function penalties() { return $this->hasMany(Penalty::class); }
    public function guarantor1() { return $this->belongsTo(Guarantor::class, "guarantor1_id"); }
    public function guarantor2() { return $this->belongsTo(Guarantor::class, "guarantor2_id"); }
    public function creator() { return $this->belongsTo(User::class, "created_by"); }
}

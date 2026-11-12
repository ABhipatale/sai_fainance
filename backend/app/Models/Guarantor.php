<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Guarantor extends Model
{
    protected $guarded = [];
    protected $casts = ["aadhaar_no" => "encrypted", "lat" => "float", "lng" => "float"];
}

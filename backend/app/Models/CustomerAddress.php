<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomerAddress extends Model
{
    protected $guarded = [];
    protected $casts = ["lat" => "float", "lng" => "float"];
}

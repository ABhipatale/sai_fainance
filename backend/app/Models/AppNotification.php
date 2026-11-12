<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppNotification extends Model
{
    protected $guarded = [];
    protected $table = "notifications";
    protected $casts = ["data" => "array", "read_at" => "datetime"];
}

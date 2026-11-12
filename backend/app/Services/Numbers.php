<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/** Race-safe sequence numbers (khata no., receipt no.). Must be called inside a DB transaction. */
class Numbers
{
    public static function next(string $name): int
    {
        $row = DB::table('counters')->where('name', $name)->lockForUpdate()->first();
        if (!$row) {
            DB::table('counters')->insertOrIgnore(['name' => $name, 'value' => 0]);
            $row = DB::table('counters')->where('name', $name)->lockForUpdate()->first();
        }
        $v = $row->value + 1;
        DB::table('counters')->where('name', $name)->update(['value' => $v]);
        return $v;
    }

    public static function khata(): string
    {
        return 'SF-K' . str_pad((string) self::next('khata'), 5, '0', STR_PAD_LEFT);
    }

    public static function receipt(): string
    {
        return 'SF-R' . date('y') . '-' . str_pad((string) self::next('receipt'), 6, '0', STR_PAD_LEFT);
    }
}

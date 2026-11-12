<?php

namespace App\Support;

/**
 * Decimal-safe money helper. All arithmetic is done on integer paise
 * (never floats) and values are returned as 2-decimal strings.
 */
final class Money
{
    public static function p(mixed $v): int
    {
        if ($v === null || $v === '') {
            return 0;
        }
        $s = trim((string) $v);
        $neg = str_starts_with($s, '-');
        $s = ltrim($s, '-+');
        if (!preg_match('/^\d*(\.\d*)?$/', $s)) {
            throw new \InvalidArgumentException("Invalid money value: $v");
        }
        [$whole, $frac] = array_pad(explode('.', $s, 2), 2, '');
        $frac = str_pad(substr($frac, 0, 2), 2, '0');
        $paise = ((int) ($whole === '' ? '0' : $whole)) * 100 + (int) $frac;
        return $neg ? -$paise : $paise;
    }

    public static function s(int $paise): string
    {
        $neg = $paise < 0;
        $paise = abs($paise);
        return ($neg ? '-' : '') . intdiv($paise, 100) . '.' . str_pad((string) ($paise % 100), 2, '0', STR_PAD_LEFT);
    }
}
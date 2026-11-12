<?php

namespace App\Models\Concerns;

/** Money columns are always returned as 2-decimal strings (same result on MySQL and SQLite). */
trait HasMoney
{
    public function initializeHasMoney(): void
    {
        foreach ($this->moneyColumns ?? [] as $c) {
            $this->casts[$c] = 'decimal:2';
        }
    }
}
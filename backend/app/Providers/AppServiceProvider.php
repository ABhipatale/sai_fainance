<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Policies in app/Policies are auto-discovered (CustomerPolicy → Customer, …)
        RateLimiter::for('login', fn (Request $r) => [
            Limit::perMinute(8)->by($r->ip() . '|' . strtolower((string) $r->input('username'))),
            Limit::perMinute(30)->by($r->ip()),
        ]);
        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(240)->by($r->user()?->id ?: $r->ip()));
    }
}

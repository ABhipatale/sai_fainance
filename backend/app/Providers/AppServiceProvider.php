<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
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
        if ($this->app->environment('production') && str_starts_with((string) config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }
        RateLimiter::for('login', fn (Request $r) => [
            Limit::perMinute(8)->by($r->ip() . '|' . strtolower((string) $r->input('username'))),
            Limit::perMinute(30)->by($r->ip()),
            // one account attacked from many IPs: at most 20 tries per 15 minutes
            Limit::perMinutes(15, 20)->by('user|' . strtolower((string) $r->input('username'))),
        ]);
        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(240)->by($r->user()?->id ?: $r->ip()));
    }
}

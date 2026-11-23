<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Defence-in-depth headers for every response (PWA + API). */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $res = $next($request);
        $h = $res->headers;
        $h->set('X-Content-Type-Options', 'nosniff');
        $h->set('X-Frame-Options', 'DENY');                        // no click-jacking inside someone else's frame
        $h->set('Referrer-Policy', 'same-origin');
        $h->set('Cross-Origin-Opener-Policy', 'same-origin');
        $h->set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()');
        $h->remove('X-Powered-By');
        if ($request->isSecure()) {
            $h->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        if ($request->is('api/*') && !$request->is('api/media')) {
            // JSON is data, never a document: nothing may be loaded or framed from it
            $h->set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        }
        return $res;
    }
}

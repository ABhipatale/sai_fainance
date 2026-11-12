<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** Usage: ->middleware('permission:payments.collect') ; several keys = any of them. */
class CheckPermission
{
    public function handle(Request $request, Closure $next, string ...$permissions)
    {
        $user = $request->user();
        if (!$user || $user->status !== 'active') {
            return response()->json(['success' => false, 'message' => 'Unauthenticated.'], 401);
        }
        foreach ($permissions as $p) {
            if ($user->hasPermission($p)) {
                return $next($request);
            }
        }
        return response()->json(['success' => false, 'message' => 'You do not have permission to perform this action.'], 403);
    }
}

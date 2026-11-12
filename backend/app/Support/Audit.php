<?php

namespace App\Support;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;

final class Audit
{
    public static function log(string $action, ?object $entity = null, ?array $old = null, ?array $new = null, ?int $userId = null): void
    {
        $req = app()->bound('request') ? request() : null;
        AuditLog::create([
            'user_id' => $userId ?? Auth::id(),
            'action' => $action,
            'entity_type' => $entity ? class_basename($entity) : null,
            'entity_id' => $entity?->getKey(),
            'old_values' => $old,
            'new_values' => $new,
            'ip' => $req?->ip(),
            'user_agent' => $req ? substr((string) $req->userAgent(), 0, 250) : null,
        ]);
    }
}
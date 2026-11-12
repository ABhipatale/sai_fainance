<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

abstract class ApiController extends Controller
{
    protected function ok(mixed $data = null, ?string $message = null, int $status = 200): JsonResponse
    {
        return response()->json(array_filter([
            'success' => true, 'message' => $message, 'data' => $data,
        ], fn ($v) => $v !== null) + ['success' => true], $status);
    }

    protected function user(Request $r): User
    {
        return $r->user();
    }

    protected function perPage(Request $r, int $default = 20): int
    {
        return max(1, min(100, (int) $r->query('per_page', $default)));
    }
}

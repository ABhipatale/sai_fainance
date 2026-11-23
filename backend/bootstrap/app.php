<?php

use App\Http\Middleware\CheckPermission;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['permission' => CheckPermission::class]);
        $middleware->append(SecurityHeaders::class);
        $middleware->trustProxies(at: '*'); // Hostinger sits behind a proxy – keep https/IP detection correct
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());

        // consistent API error envelope: { success:false, message, errors? }
        $exceptions->render(function (ValidationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['success' => false, 'message' => collect($e->errors())->flatten()->first() ?? 'Validation failed.', 'errors' => $e->errors()], 422);
            }
        });
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['success' => false, 'message' => 'Unauthenticated.'], 401);
            }
        });
        $exceptions->render(function (ModelNotFoundException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['success' => false, 'message' => 'Record not found.'], 404);
            }
        });
        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            if ($request->is('api/*')) {
                $msg = $e->getMessage() ?: match ($e->getStatusCode()) {
                    403 => 'You do not have permission to perform this action.', 404 => 'Not found.', 429 => 'Too many requests.', default => 'Request failed.',
                };
                if ($e->getStatusCode() === 403 && str_contains($msg, 'This action is unauthorized')) {
                    $msg = 'You do not have permission to perform this action.';
                }
                return response()->json(['success' => false, 'message' => $msg], $e->getStatusCode());
            }
        });
    })->create();

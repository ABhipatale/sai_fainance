<?php

use Illuminate\Support\Facades\Route;

// The React PWA is built into /public (app.html + assets). Every non-API URL serves the SPA shell.
Route::get('/{any?}', function () {
    $file = public_path('app.html');
    if (!is_file($file)) {
        return response('Sai Finance API is running. Frontend build (public/app.html) not found – run the frontend build.', 200);
    }
    return response()->file($file, ['Cache-Control' => 'no-cache, no-store, must-revalidate']);
})->where('any', '^(?!api/|up$).*');

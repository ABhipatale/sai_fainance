<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/** Serves photos/logos from private storage via short-lived signed URLs (route middleware: signed:relative). */
class MediaController extends ApiController
{
    public function show(Request $r)
    {
        $path = (string) $r->query('p');
        abort_unless(\App\Support\Media::servable($path) && Storage::disk('local')->exists($path), 404);
        return Storage::disk('local')->response($path, null, ['Cache-Control' => 'private, max-age=3600']);
    }
}

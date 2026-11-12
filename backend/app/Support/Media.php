<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

/**
 * All uploads go to PRIVATE storage (storage/app/private). Photos are exposed through short-lived
 * signed URLs; Aadhaar/PAN files are only available through a permission-checked endpoint.
 */
final class Media
{
    public static function store(?UploadedFile $file, string $dir): ?string
    {
        return $file ? $file->store($dir, 'local') : null;
    }

    public static function replace(?UploadedFile $file, ?string $old, string $dir): ?string
    {
        if (!$file) {
            return $old;
        }
        if ($old) {
            Storage::disk('local')->delete($old);
        }
        return self::store($file, $dir);
    }

    public static function url(?string $path): ?string
    {
        if (!$path) {
            return null;
        }
        return URL::temporarySignedRoute('media', now()->addHours(12), ['p' => $path], absolute: false);
    }

    public static function servable(string $path): bool
    {
        return !str_contains($path, '..') && (str_starts_with($path, 'photos/') || str_starts_with($path, 'logos/'));
    }
}

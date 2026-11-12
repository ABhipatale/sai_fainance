<?php

/**
 * Front controller for the Hostinger layout:
 *   ~/domains/YOUR-DOMAIN/sai-finance/   ← Laravel app (app/, vendor/, storage/, .env …) – NOT web-accessible
 *   ~/domains/YOUR-DOMAIN/public_html/   ← contents of backend/public (this file, app.html, assets/, sw.js …)
 * Adjust APP_DIR if you used a different folder name.
 */

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$appDir = __DIR__ . '/../sai-finance';

if (file_exists($maintenance = $appDir . '/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $appDir . '/vendor/autoload.php';

/** @var Application $app */
$app = require_once $appDir . '/bootstrap/app.php';
$app->usePublicPath(__DIR__);

$app->handleRequest(Request::capture());

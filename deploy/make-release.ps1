<#
  Builds the two upload packages for Hostinger:
    release/sai-finance-app.zip   -> Laravel application (upload to ~/domains/<domain>/sai-finance/ and unzip)
    release/public_html.zip       -> web root contents      (upload to ~/domains/<domain>/public_html/ and unzip)

  Usage (PowerShell, from the project root):   .\deploy\make-release.ps1
  Requires: node + npm, php + composer (same major PHP as the Hostinger plan: 8.3+), tar (built into Windows 10+).
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'release\_stage'
$out = Join-Path $root 'release'

Write-Host '1/5  Building the React PWA into backend/public ...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'frontend')
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
Pop-Location

Write-Host '2/5  Staging Laravel app (without dev files) ...' -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$stage\sai-finance", "$stage\public_html" | Out-Null
$exclude = @('vendor', 'node_modules', 'tests', 'public', '.env', '.phpunit.cache', 'storage')
Get-ChildItem (Join-Path $root 'backend') -Force | Where-Object { $exclude -notcontains $_.Name -and $_.Name -notmatch '^\.env$|\.log$|^CLAUDE\.md$|^AGENTS\.md$' } |
  ForEach-Object { Copy-Item $_.FullName "$stage\sai-finance" -Recurse -Force }
# empty writable storage skeleton
foreach ($d in 'app\private', 'app\public', 'framework\cache\data', 'framework\sessions', 'framework\views', 'logs') {
  New-Item -ItemType Directory -Force -Path "$stage\sai-finance\storage\$d" | Out-Null
}
Copy-Item (Join-Path $root 'backend\.env.production.example') "$stage\sai-finance\.env.example" -Force

Write-Host '3/5  composer install --no-dev (optimised) ...' -ForegroundColor Cyan
Push-Location "$stage\sai-finance"
composer install --no-dev --optimize-autoloader --classmap-authoritative --no-interaction
if ($LASTEXITCODE -ne 0) { throw 'composer install failed' }
Pop-Location

Write-Host '4/5  Staging public_html ...' -ForegroundColor Cyan
Copy-Item (Join-Path $root 'backend\public\*') "$stage\public_html" -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot 'index.hostinger.php') "$stage\public_html\index.php" -Force
if (-not (Test-Path "$stage\public_html\app.html")) { throw 'app.html missing - frontend build did not run' }

Write-Host '5/5  Zipping ...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $out | Out-Null
Remove-Item "$out\*.zip" -Force -ErrorAction SilentlyContinue
tar -a -c -f "$out\sai-finance-app.zip" -C "$stage\sai-finance" .
tar -a -c -f "$out\public_html.zip" -C "$stage\public_html" .
Remove-Item $stage -Recurse -Force
Write-Host "`nDone:" -ForegroundColor Green
Get-ChildItem "$out\*.zip" | ForEach-Object { '{0}  ({1:N1} MB)' -f $_.FullName, ($_.Length / 1MB) }
Write-Host 'Next: follow docs/DEPLOYMENT_HOSTINGER.md'

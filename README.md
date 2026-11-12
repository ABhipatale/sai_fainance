# Sai Finance – Weekly Loan & Collection Management PWA

Marathi‑first (मराठी · हिन्दी · English) mobile PWA for weekly‑installment finance: customers & guarantors, khata (loan accounts),
Tuesday collection, advance, pending recovery, penalties, multi‑location cash ledger, recovery staff, reports.

| Layer | Tech |
|---|---|
| Backend | Laravel 13 (PHP 8.3+), Sanctum, MySQL (SQLite for tests), policies + permission middleware |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form, Zod, Lucide, i18next |
| PWA | vite-plugin-pwa (Workbox), IndexedDB offline payment queue with idempotency keys |

```
backend/    Laravel API (+ serves the built PWA from public/)
frontend/   React PWA source (builds into backend/public)
deploy/     make-release.ps1 + Hostinger front controller
docs/       API.md · DEPLOYMENT_HOSTINGER.md · TESTING.md · BUSINESS_RULES.md
```

## Local development
```bash
# backend  (SQLite by default – no MySQL needed locally)
cd backend
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate --seed                       # admin / ChangeMe@123 (see .env SEED_ADMIN_*)
php artisan db:seed --class=DemoSeeder           # optional: manager/recovery1 + sample customers & khatas
php artisan serve                                # http://127.0.0.1:8000

# frontend (proxies /api → :8000)
cd frontend
npm install
npm run dev                                      # http://localhost:5173
```
Demo logins (DemoSeeder): `admin / ChangeMe@123` · `manager / Manager@123` · `recovery1 / Recovery@123`.

## Tests
```bash
cd backend && php artisan test                   # 35 tests – calculations, allocation, advance, reversal, cash, permissions, API
cd frontend && npx tsc -p tsconfig.app.json --noEmit
```

## Production (Hostinger)
`.\deploy\make-release.ps1` → upload two zips → `php artisan migrate --seed` → cron. Full guide: **docs/DEPLOYMENT_HOSTINGER.md**.

## Documentation
* [API reference](docs/API.md) · [Business rules & decisions](docs/BUSINESS_RULES.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT_HOSTINGER.md)

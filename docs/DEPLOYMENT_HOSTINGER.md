# Deploying Sai Finance on Hostinger

Works on **Hostinger Premium/Business shared hosting** (hPanel, PHP 8.3+, MySQL) and on a VPS.
One domain serves both the React PWA and the Laravel API (`/api`), so there are no CORS or cookie problems.

```
~/domains/YOUR-DOMAIN/
├── sai-finance/        ← Laravel app (private: app/, vendor/, storage/, .env)
└── public_html/        ← web root: index.php, app.html, assets/, sw.js, manifest, icons, .htaccess
```

> The Laravel code lives **outside** `public_html`, so `.env`, source code and the uploaded
> Aadhaar/PAN files can never be downloaded directly.

---

## 0. One-time prerequisites (on your PC)

* Node 20+, PHP 8.3+ and Composer (same PHP major as the Hostinger plan).
* From the project root run:

```powershell
.\deploy\make-release.ps1
```

This builds the PWA, installs production-only Composer packages and creates:

| File | Upload to |
|---|---|
| `release/sai-finance-app.zip` | `~/domains/YOUR-DOMAIN/sai-finance/` |
| `release/public_html.zip` | `~/domains/YOUR-DOMAIN/public_html/` |

## 1. hPanel setup

1. **Domain → SSL**: install the free SSL and switch on *Force HTTPS*. (PWA install, service worker and GPS need HTTPS.)
2. **Advanced → PHP Configuration**: choose **PHP 8.3 or 8.4**; enable extensions `mbstring, openssl, pdo_mysql, fileinfo, gd, zip, intl, ctype, tokenizer, xml, curl, bcmath`.
   Set `upload_max_filesize = 16M`, `post_max_size = 20M`, `max_execution_time = 120`.
3. **Databases → MySQL Databases**: create database + user (note the full names, they carry a `u123…_` prefix) and grant all privileges.

## 2. Upload

1. **File Manager** (or FTP/SFTP): upload `sai-finance-app.zip` into `~/domains/YOUR-DOMAIN/sai-finance/` and *Extract*.
   Upload `public_html.zip` into `public_html/` (delete the default `default.php` first) and *Extract*.
2. Make sure `sai-finance/storage` and `sai-finance/bootstrap/cache` are writable (permission `775`).
3. Copy `sai-finance/.env.example` to `sai-finance/.env` and edit (see `.env.production.example`):

```ini
APP_ENV=production
APP_DEBUG=false
APP_URL=https://YOUR-DOMAIN.com
DB_DATABASE=u123456789_saifinance
DB_USERNAME=u123456789_sai
DB_PASSWORD=********
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<strong password>
```

## 3. Initialise (SSH – Premium/Business plans include SSH; hPanel → Advanced → SSH Access)

```bash
cd ~/domains/YOUR-DOMAIN/sai-finance
php artisan key:generate --force
php artisan migrate --force
php artisan db:seed --force          # roles, permissions, default settings and the first ADMIN login
php artisan config:cache && php artisan route:cache
```

*No SSH?* Use hPanel → **Advanced → PHP** … or ask support to enable SSH; alternatively run the commands once locally
against the remote DB (enable *Remote MySQL* for your IP in hPanel) – then upload.

> `php artisan storage:link` is **not needed** – photos are served through signed `/api/media` URLs and
> Aadhaar/PAN documents only through permission-checked endpoints from private storage.

## 4. Cron job (needed for advance application + daily reminders)

hPanel → **Advanced → Cron Jobs** → *Custom*, every minute:

```
* * * * * /usr/bin/php /home/u123456789/domains/YOUR-DOMAIN/sai-finance/artisan schedule:run >> /dev/null 2>&1
```

It runs `finance:apply-advance` (00:10) – moves advance balances onto installments that fell due – and
`finance:notify-due` (07:00). The app is also correct without cron: advance is applied at collection time as well.

## 5. First login & hardening checklist

- [ ] Open `https://YOUR-DOMAIN.com` → login `admin` / your seed password → **Settings → Change password**.
- [ ] Settings → General: finance name, address, phone, logo.
- [ ] Create *Cash locations* (Main Office, bank account …), create *Recovery staff* (a recovery cash location is auto-linked).
- [ ] Remove `SEED_ADMIN_PASSWORD` from `.env` afterwards.
- [ ] `APP_DEBUG=false` (never `true` in production). Confirm `https://YOUR-DOMAIN.com/.env` returns 403/404.
- [ ] Hostinger **Backups**: enable weekly automatic backups **and** schedule a daily DB export (hPanel → Databases → phpMyAdmin → Export, or a cron `mysqldump`).
- [ ] Install the PWA on Android: Chrome → ⋮ → *Install app* / *Add to Home screen* (an in-app “Install app” button also appears).

## 6. Updating to a new version

1. Run `.\deploy\make-release.ps1` again.
2. Upload & extract `public_html.zip` (overwrite). Upload & extract `sai-finance-app.zip` (overwrite — your `.env` is **not** in the zip, so it is kept).
3. SSH: `php artisan migrate --force && php artisan config:cache && php artisan route:cache`.
4. Phones get the new PWA automatically on next open (service worker `autoUpdate`).

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| 500 error / blank page | `storage` & `bootstrap/cache` writable? PHP ≥ 8.3? `tail storage/logs/laravel-*.log` |
| `Class … not found` | Upload the **whole** `vendor/` folder from the zip; run `composer dump-autoload` only if you have Composer on the server |
| Login works but API returns 401 | The `Authorization` header must reach PHP – keep the `.htaccess` shipped in `public_html` |
| Pages 404 on refresh | `.htaccess` missing in `public_html` (hidden file – enable “show hidden files” in File Manager) |
| Photos not loading | `APP_URL` must be the exact https URL; clear `php artisan config:clear` |
| Reports Excel export fails | `zip` PHP extension enabled? |
| Old UI after update | Hard refresh once, or close and reopen the installed app |
| Time is wrong | `.env` → `APP_TIMEZONE=Asia/Kolkata` then `php artisan config:cache` |

## 8. Capacity notes

Dashboard, pending and collection lists compute figures from one set-based SQL query and filter/sort in PHP — comfortable up to
several thousand active khatas on shared hosting. For much larger books move the lists to SQL `HAVING` filters and add a queue worker (VPS).

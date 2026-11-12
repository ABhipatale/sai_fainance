# Sai Finance – REST API

Base URL: `/api` · JSON · Auth: **Laravel Sanctum bearer token** (`Authorization: Bearer <token>`), tokens expire after 14 days.

Envelope
```json
{ "success": true,  "data": { }, "message": "optional" }
{ "success": true,  "data": [ ], "meta": { "page":1, "per_page":20, "total":57, "last_page":3 } }
{ "success": false, "message": "first error", "errors": { "field": ["…"] } }      // 422
```
Money values are decimal **strings** (`"10000.00"`). Dates are `YYYY-MM-DD`. Every route is protected by a permission
(`permission:<key>` middleware) **and** row-level data scoping (policies) – the frontend guards are only UX.

Rate limits: `POST /login` 8/min per IP+username · authenticated API 240/min per user.

## Roles → default permissions
Admin: everything. Manager / Recovery: see `database/seeders/DatabaseSeeder.php` – Admin can edit them at **Settings → Role permissions**.
Recovery can never be granted `settings.manage, users.manage, managers.manage, audit.view, cash.opening, loans.close`.

Data scope: **admin** all · **manager** customers they created + customers of their recovery staff + unassigned · **recovery** only assigned customers.

## Authentication
| Method | URL | Notes |
|---|---|---|
| POST | `/login` | `{username|mobile, password}` → `{token, user, permissions, finance, config}` |
| POST | `/logout` | revokes current token |
| GET | `/me` | session payload |
| POST | `/me/password` | `{current_password, password, password_confirmation}` – other sessions are signed out |
| POST | `/me/language` | `{language: mr|en|hi}` |

## Customers (`customers.*`)
| Method | URL | Notes |
|---|---|---|
| GET | `/customers?q=&village=&area=&recovery_user_id=&unassigned=1&page=` | search by name / mobile / khata no |
| POST | `/customers` | multipart: name, mobile, occupation, address, village, taluka, district, state, pincode, lat, lng, **photo** (required) + optional alt_mobile, aadhaar_no, aadhaar_photo, pan_no, pan_photo, notes, area, recovery_user_id |
| GET | `/customers/{id}` | profile + loans + totals + guarantors + recent payments (Aadhaar/PAN masked unless `customers.documents`) |
| PUT/POST(+`_method=PUT`) | `/customers/{id}` | multipart update |
| GET | `/customers/{id}/ledger?loan_account_id=&from=&to=` | immutable customer ledger |
| GET | `/customers/{id}/advance-ledger` | advance deposit / applied / refund / reversal |
| GET | `/customers/{id}/documents/{aadhaar|pan}` | image, needs `customers.documents`, audited |
| GET/POST | `/customers/{id}/guarantors` · POST/PUT `/guarantors/{id}` | guarantors belong to the customer (reusable across khatas) |
| POST | `/customers/{id}/assign` | `{recovery_user_id|null}` |

## Loan accounts (khata)
| Method | URL | Notes |
|---|---|---|
| POST | `/loan-accounts/preview` | **no save** → finance charges, weekly amount, final due date, full schedule |
| POST | `/loan-accounts` | `customer_id, principal_amount, total_repayment, installments_count` + optional weekly_amount, installment_weekday (2=Tue), first_installment_date, disbursement_date, processing_charges, additional_charges, old_khata_outstanding, guarantor1_id, guarantor2_id, cash_location_id, notes |
| GET | `/loan-accounts?status=&customer_id=&q=` | |
| GET | `/loan-accounts/{id}` | detail + installments + penalties + payments + metrics |
| PUT | `/loan-accounts/{id}` | notes / guarantors only (terms are immutable once created) |
| GET | `/loan-accounts/{id}/installments` | |
| POST | `/loan-accounts/{id}/close` | `{settlement?, note?, refund_location_id?}` – zero outstanding, or admin settlement |
| POST | `/loan-accounts/{id}/advance-refund` | `advance.refund` |

Metrics returned with every loan: `total_paid, remaining_loan, remaining_installments, due_now, overdue_amount, net_due_now, net_overdue, today_due, paid_today, advance_balance, penalty_outstanding, old_khata_remaining, total_outstanding, payable_now, next_due_date, can_close`.
`net_*` = after subtracting advance (advance is never counted twice).

## Collection & payments
| Method | URL | Notes |
|---|---|---|
| GET | `/collection/search?q=` | active khatas by customer name / mobile / khata no |
| GET | `/collection/today?filter=&sort=&dir=` | Tuesday quick-collection list + `summary` |
| POST | `/payments` | `loan_account_id, amount, payment_type(cash|upi|bank|other), cash_location_id` + `collected_by, payment_date, reference, notes, penalty_amount, old_khata_amount, mode(auto|advance), idempotency_key` → `{payment, duplicate, receipt, loan}` |
| POST | `/payments/sync` | offline queue upload `{items:[payment…]}` – per-item result, idempotent |
| GET | `/payments?from=&to=&date=&customer_id=&collected_by=&status=` | `meta.total_amount` |
| GET | `/payments/{id}` · `/payments/{id}/receipt` | receipt JSON (client renders PDF/print/WhatsApp) |
| POST | `/payments/{id}/reverse` | `{reason}` – latest payment of a khata only; original rows kept |
| POST | `/advance-payments` | same body as `/payments`, forced `mode=advance` |
| GET | `/advance-balances` | khatas holding advance |

**Allocation order** (server side, one DB transaction, loan row locked):
advance on account is first applied to due installments → explicit penalty part (oldest first) → explicit old-khata part → installments that are due (oldest first; if none are due the next upcoming installment is “current”) → remainder becomes **advance deposit** (cannot exceed what is still unpaid on the khata).
Send the same `idempotency_key` to retry safely – the second call returns `duplicate:true` and the original payment.

## Pending / overdue
`GET /pending-recovery?filter=all|pending|overdue|partial|advance|today&sort=remaining_installments|overdue_amount|pending_amount|next_due_date|name|village&dir=asc|desc&recovery_user_id=&village=&remaining_installments=&q=`
`GET /overdue-recovery`

## Penalties (manual only)
`GET /penalties` · `POST /penalties {loan_account_id, installment_number?, amount, penalty_date?, reason?}` · `PUT /penalties/{id}` (before collection) · `POST /penalties/{id}/waive {reason}` · `POST /penalties/{id}/reverse {reason}`. Collected through `/payments` with `penalty_amount`.

## Cash
`GET /cash-locations[?for=collection]` · `POST /cash-locations` · `PUT /cash-locations/{id}` · `GET /cash-locations/{id}/ledger?from=&to=` (with reconciliation: opening, collection, transfer in/out, expenses, disbursement, closing) · `POST /cash-locations/{id}/adjust` ·
`GET/POST /cash-transfers` (never changes total company cash) · `GET/POST /cash/opening` (Monday opening confirm, manual adjustments recorded separately) · `GET/POST /expenses`.

## Users / recovery
`GET /users?role=` · `POST /users` · `PUT /users/{id}` (deactivate instead of delete) · `GET /users/{id}/performance` · `POST /recovery/assign {recovery_user_id, customer_ids[]}`.

## Dashboard & reports
`GET /dashboard` → `{mode: monday|collection|after, cards{…11 cards}, monday{…}, collection{…}, after{…}, staff[]}`.
`GET /reports/{key}` with `key` ∈ `daily-collection, weekly-collection, monthly-collection, pending, loan-disbursement, loan-outstanding, advance-balance, penalty, recovery-staff, cash-location, cash-transfer, customer-ledger, closed-khata, overdue`; filters `from,to,date,customer_id,collected_by,cash_location_id,payment_type`; `&export=csv|xlsx` downloads a file (`reports.export`).

## Settings / security
`GET|PUT /settings` · `POST /settings/logo` · `GET|PUT /settings/permissions` · `GET /audit-logs?action=&user_id=&from=&to=` · `GET /notifications` · `POST /notifications/read` · `GET /media?p=…` (signed URL, photos & logo only).

## Error codes
`401` unauthenticated · `403` no permission / outside your data scope · `404` not found · `422` validation or business rule · `429` rate limited.

# Testing

## Backend (automated) – 35 tests
```bash
cd backend
php artisan test
```
Runs on SQLite in memory with a frozen clock (Tuesday 2026-11-10). Covers:

| Area | Tests |
|---|---|
| **Loan calculation** | example loan ₹80,000 → ₹1,00,000 in 10 weeks = 10 Tuesday installments of ₹10,000; Monday start → next Tuesday; last installment absorbs rounding; invalid terms rejected; decimal-safe money; old khata kept separate from principal |
| **Payment allocation** | exact payment; overpayment → advance; **advance applied next Tuesday without double counting** (cash = ₹20,000 only); partial + overdue status; oldest dues first; cannot exceed outstanding; penalty collected separately; penalty waive/edit rules; old-khata collection |
| **Idempotency** | duplicate submission with the same key returns the original payment and does not touch cash |
| **Reversal** | restores installments, advance, cash and customer ledger; original rows preserved; only latest payment reversible |
| **Cash** | transfers keep total company cash; insufficient balance rejected; cash ledger always equals location balance |
| **Loan closing** | needs zero outstanding; settlement only by admin; advance applied to final installment |
| **Permissions / scope** | recovery cannot create loans/customers, see settings/audit/reports, or access unassigned customers; cannot collect for unassigned customer; limited to own cash location; Aadhaar masked & document endpoint 403; manager cannot waive/reverse; manager sees only own staff |
| **API** | login, 401, receipt, dashboard figures vs DB, pending sort asc/desc, all 14 reports + CSV export |

### Concurrency
`PaymentService::collect` runs in one DB transaction and takes `SELECT … FOR UPDATE` on the loan row (plus the cash location and counters rows), so two
simultaneous collections on the same khata are serialised. A UNIQUE index on `payments.idempotency_key` stops double submissions that race.
To stress-test on MySQL after deploying:

```bash
# 20 parallel identical requests – exactly ONE payment must be created
seq 20 | xargs -P20 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST https://YOUR-DOMAIN/api/payments \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"loan_account_id":1,"amount":1000,"payment_type":"cash","cash_location_id":1,"idempotency_key":"stress-1"}'
# expect one 201 and nineteen 200 (duplicate:true)
```
(SQLite ignores row locks – this MySQL test is the authoritative concurrency check.)

## Frontend
```bash
cd frontend
npx tsc -p tsconfig.app.json --noEmit      # type check
npm run lint                               # oxlint
npm run build                              # production build into ../backend/public
```

## Manual QA checklist (mobile, Chrome DevTools device mode 360×800 and a real Android phone)
- [ ] Login as admin / manager / recovery – menus differ; recovery cannot open `/settings` admin sections, `/reports`, `/cash` admin actions.
- [ ] Marathi is default; switch to हिन्दी / English – labels, validation messages, receipt and reports change.
- [ ] Create customer (GPS capture + map pin + photo) → add 2 guarantors → New Khata wizard shows live preview → save → 10 Tuesday installments.
- [ ] Collect ₹15,000 on a ₹10,000 installment → ₹5,000 advance (purple) → next Tuesday card shows ₹5,000 to collect.
- [ ] Partial payment → installment “partially paid”, then overdue (red) after the due date.
- [ ] Add manual penalty → collect it from the collection sheet → shows separately on receipt/ledger; waive & reverse need confirmation.
- [ ] Double-tap **Save payment** → only one receipt. Turn on airplane mode → collect → “pending sync” badge → go online → synced once.
- [ ] Receipt: Download PDF, Print, Share, WhatsApp.
- [ ] Cash transfer Recovery → Office: total company cash unchanged; Monday opening confirm; expense.
- [ ] Reports: filters, totals, Excel / CSV / PDF / Print.
- [ ] Install as PWA (Android Chrome → Install app); open offline → shell loads, cached lists readable.

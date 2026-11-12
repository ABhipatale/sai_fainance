# Business rules & design decisions

Where the specification left room for interpretation, this is what was implemented (all easy to change in `backend/app/Services`).

## Money
* Every money column is `DECIMAL(14,2)`; PHP arithmetic is done on **integer paise** (`App\Support\Money`) – never floats.
* No interest rate is hard-coded. Admin enters principal, total repayment, installment count, weekly amount, first installment date and weekday; the preview shows finance charges.
* If `weekly × n ≠ total`, the **last installment absorbs the difference** (never negative).

## Installments
* Default weekday Tuesday (2); first installment defaults to the next Tuesday *after* the disbursement date (Monday start → next day) and is editable (must fall on the chosen weekday).
* Stored state: `open | partial | paid | advanced_covered | settled`. Displayed status is computed from today's date:
  `upcoming` (due later) · `pending` (due today) · `partially_paid` · `overdue` (past due & unpaid) · `paid` · `advanced_covered` (fully covered by advance) · `settled`.
* “Pending” totals = everything unpaid with `due_date ≤ today` (pending + overdue) **after** subtracting the khata's advance; “overdue” = `due_date < today`.

## Payment allocation
1. Advance already on the khata is applied to due installments (oldest first).
2. Explicit **penalty** part → oldest penalties first (tracked separately from principal).
3. Explicit **old-khata** part.
4. Remaining → installments due on/before the payment date (oldest first). If none are due, the next upcoming installment is the “current” one.
5. Anything left → **advance deposit**, allowed only up to the amount still unpaid on the khata.

Advance is applied *when installments fall due* (at the next collection, or by the nightly `finance:apply-advance` job). It is a ledger movement, not cash, so dashboards count collected cash exactly once.

## Ledgers (append-only)
* **Customer ledger** (`debit` = customer owes more, `credit` = owes less): loan disbursement posts `total_repayment` once (installments are a schedule, not extra debits); old khata, penalties = debit; every cash receipt (installment, penalty, old khata, advance deposit) = credit; waiver/adjustment = credit; refund = debit; reversals are mirror rows. Advance application is a zero-value memo line (the deposit already credited the customer).
* **Advance ledger** per khata: deposit / applied / refund / reversal with running balance.
* **Cash ledger** per location with running balance, row-locked; `cash_locations.current_balance` is a cache that always equals the ledger sum (tested).

## Reversal & immutability
Payments are never deleted or edited. Reversal marks the payment `reversed` and adds opposite ledger rows (customer, advance, cash). Allowed only for the **latest** completed payment of a khata (reverse newest first) so later allocations are never orphaned. Penalties: edit before collection, waive (authorised), reverse (if nothing collected).

## Loan closing
Needs zero outstanding (installments, penalties, old khata). Admin may close with an authorised **settlement** (remaining amounts written off with an adjustment ledger line + audit). Advance on the khata is first applied to unpaid installments; any excess must be refunded from a chosen cash location.

## Cash
* Collection credits the selected location (office, a recovery person's cash, bank/UPI account…).
* Transfers move money between two locations (never changes total company cash; source balance is checked).
* **Monday opening**: defaults to the previous closing balance; a manual change needs a note, is stored in `opening_balances` and posts a separate `adjustment` cash line; confirmed weeks are immutable.
* Recovery staff may collect into their own location or a bank account location only.

## Pending list sorting
The spec text and example conflict (“fewer remaining installments at the top” vs a 5,4,3,2,1 table). Sorting is therefore **configurable** (Settings → Collection → pending sort, and per-request `sort`/`dir`): default = fewer remaining installments first; one tap flips it.

## Security
* Sanctum bearer tokens (14-day expiry), bcrypt hashing, throttled login, role + permission middleware on every route, policies + row scoping for customer data.
* Aadhaar/PAN numbers are encrypted at rest (Laravel `encrypted` cast), masked for users without `customers.documents`; their images live in private storage and are only streamed by an audited, permission-checked endpoint. Photos use short-lived signed URLs.
* Audit log for logins, customer/loan/payment/penalty/cash/settings/permission/user changes and document views.
* CSV/Excel exports neutralise spreadsheet-formula injection; all input is validated server-side; Eloquent/query builder bindings prevent SQL injection; React escapes output (XSS).

## Offline
Service worker caches the app shell and recent GET data. Payments taken offline are stored in IndexedDB with a client UUID (`idempotency_key`), shown as *pending sync*, and uploaded in order when online (`POST /payments/sync`). The server's UNIQUE key makes retries harmless; entries the server rejects are kept visibly as *failed* instead of being lost.

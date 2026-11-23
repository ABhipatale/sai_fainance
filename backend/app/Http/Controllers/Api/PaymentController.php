<?php

namespace App\Http\Controllers\Api;

use App\Models\FinanceSetting;
use App\Models\LoanAccount;
use App\Models\Payment;
use App\Models\User;
use App\Services\CashService;
use App\Services\LoanMetrics;
use App\Services\PaymentService;
use App\Support\Money;
use App\Support\Present;
use App\Support\Scope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class PaymentController extends ApiController
{
    private function rules(): array
    {
        return [
            'loan_account_id' => 'required|exists:loan_accounts,id',
            'amount' => 'required|numeric|min:0.01|max:99999999',
            'payment_type' => 'required|in:cash,upi,bank,other',
            'cash_location_id' => 'required|exists:cash_locations,id',
            'collected_by' => 'nullable|exists:users,id',
            'payment_date' => 'nullable|date_format:Y-m-d',
            'reference' => 'nullable|string|max:120',
            'notes' => 'nullable|string|max:1000',
            'penalty_amount' => 'nullable|numeric|min:0',
            'old_khata_amount' => 'nullable|numeric|min:0',
            'mode' => 'nullable|in:auto,advance',
            'idempotency_key' => 'nullable|string|max:64',
            'is_offline' => 'boolean',
        ];
    }

    public function index(Request $r)
    {
        $u = $this->user($r);
        $q = Payment::with(['customer:id,name', 'loan:id,khata_no', 'cashLocation:id,name', 'collector:id,name']);
        if ($u->isRecovery()) {
            $q->where('collected_by', $u->id);
        } elseif (!$u->isAdmin()) {
            $q->whereIn('payments.customer_id', Scope::customerIds($u));
        }
        foreach (['loan_account_id', 'customer_id', 'collected_by', 'cash_location_id', 'status', 'payment_type'] as $f) {
            if ($v = $r->query($f)) $q->where("payments.$f", $v);
        }
        if ($v = $r->query('from')) $q->where('payment_date', '>=', $v);
        if ($v = $r->query('to')) $q->where('payment_date', '<=', $v);
        if ($v = $r->query('date')) $q->where('payment_date', $v);
        if ($s = trim((string) $r->query('q'))) {
            $q->where(fn ($w) => $w->where('receipt_no', 'like', "%$s%")
                ->orWhereHas('customer', fn ($c) => $c->where('name', 'like', "%$s%")->orWhere('mobile', 'like', "%$s%")));
        }
        $total = (clone $q)->where('payments.status', 'completed')->sum('payments.amount');
        $page = $q->orderByDesc('payments.id')->paginate($this->perPage($r));
        $res = Present::paginated($page, fn ($p) => Present::payment($p));
        $res['meta']['total_amount'] = Money::s(Money::p($total));
        return response()->json($res);
    }

    public function store(Request $r)
    {
        $u = $this->user($r);
        if ($r->route('mode') === 'advance') {
            $r->merge(['mode' => 'advance']); // POST /advance-payments
        }
        $d = $r->validate($this->rules());
        $loan = LoanAccount::findOrFail($d['loan_account_id']);
        Gate::authorize('collect', $loan);

        if (!CashService::allowedForCollection($u)->contains('id', (int) $d['cash_location_id'])) {
            throw ValidationException::withMessages(['cash_location_id' => ['You cannot receive payments into this cash location.']]);
        }
        $d['collected_by'] = $this->resolveCollector($u, $d['collected_by'] ?? null);
        if (($d['mode'] ?? 'auto') === 'advance' && !$u->hasPermission('payments.collect')) {
            abort(403);
        }

        [$payment, $dupe] = PaymentService::collect($d, $u);
        $payment->load(['customer', 'loan', 'cashLocation', 'collector']);

        return $this->ok([
            'payment' => Present::payment($payment),
            'duplicate' => $dupe,
            'receipt' => $this->receiptData($payment),
            'loan' => Present::loan(LoanMetrics::query()->with('customer.address')->findOrFail($payment->loan_account_id), false),
        ], $dupe ? 'Payment already recorded' : 'Payment saved', $dupe ? 200 : 201);
    }

    /** Offline queue upload – each item is idempotent via its key, so retries never duplicate. */
    public function sync(Request $r)
    {
        $r->validate(['items' => 'required|array|max:50', 'items.*' => 'array']);
        $out = [];
        foreach ($r->input('items') as $i => $item) {
            try {
                $sub = Request::create('/', 'POST', $item + ['is_offline' => true]);
                $sub->setUserResolver(fn () => $r->user());
                $d = validator($item + ['is_offline' => true], $this->rules())->validate();
                $u = $this->user($r);
                $loan = LoanAccount::findOrFail($d['loan_account_id']);
                Gate::forUser($u)->authorize('collect', $loan);
                if (!CashService::allowedForCollection($u)->contains('id', (int) $d['cash_location_id'])) {
                    throw ValidationException::withMessages(['cash_location_id' => ['Not allowed.']]);
                }
                $d['collected_by'] = $this->resolveCollector($u, $d['collected_by'] ?? null);
                [$p, $dupe] = PaymentService::collect($d, $u);
                $out[] = ['index' => $i, 'key' => $item['idempotency_key'] ?? null, 'ok' => true, 'duplicate' => $dupe, 'receipt_no' => $p->receipt_no, 'payment_id' => $p->id];
            } catch (ValidationException $e) {
                $out[] = ['index' => $i, 'key' => $item['idempotency_key'] ?? null, 'ok' => false, 'errors' => $e->errors()];
            } catch (\Illuminate\Auth\Access\AuthorizationException|\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {
                $out[] = ['index' => $i, 'key' => $item['idempotency_key'] ?? null, 'ok' => false, 'errors' => ['_' => ['You do not have permission to perform this action.']]];
            } catch (\Throwable $e) {
                // never send internal error text (SQL, paths) to the device – it goes to the server log instead
                report($e);
                $out[] = ['index' => $i, 'key' => $item['idempotency_key'] ?? null, 'ok' => false, 'errors' => ['_' => ['Could not save this payment. Please try again or contact the office.']]];
            }
        }
        return $this->ok($out);
    }

    public function show(Request $r, Payment $payment)
    {
        Gate::authorize('view', $payment);
        $payment->load(['customer', 'loan', 'cashLocation', 'collector']);
        return $this->ok(Present::payment($payment));
    }

    public function receipt(Request $r, Payment $payment)
    {
        Gate::authorize('view', $payment);
        $payment->load(['customer', 'loan', 'cashLocation', 'collector', 'allocations.installment']);
        return $this->ok($this->receiptData($payment));
    }

    public function reverse(Request $r, Payment $payment)
    {
        Gate::authorize('reverse', $payment);
        $d = $r->validate(['reason' => 'required|string|min:3|max:500']);
        $p = PaymentService::reverse($payment, $this->user($r), $d['reason']);
        return $this->ok(Present::payment($p->load(['customer', 'loan', 'cashLocation', 'collector'])), 'Payment reversed');
    }

    private function resolveCollector(User $u, ?int $requested): int
    {
        if (!$requested || $u->isRecovery()) {
            return $u->id;
        }
        $c = User::where('status', 'active')->findOrFail($requested);
        if ($u->isManager() && $c->id !== $u->id && (int) $c->manager_id !== $u->id) {
            throw ValidationException::withMessages(['collected_by' => ['Select your own recovery staff.']]);
        }
        return $c->id;
    }

    private function receiptData(Payment $p): array
    {
        $p->loadMissing(['customer', 'loan', 'cashLocation', 'collector', 'allocations.installment']);
        $m = LoanMetrics::format(LoanMetrics::query()->findOrFail($p->loan_account_id));
        $alloc = $p->allocations;
        $inst = $alloc->where('type', 'installment')->map(fn ($a) => $a->installment?->number)->filter()->values();

        return [
            'finance' => SettingsController::general(),
            'receipt_no' => $p->receipt_no,
            'status' => $p->status,
            'payment_date' => $p->payment_date->toDateString(),
            'customer_name' => $p->customer?->name,
            'customer_mobile' => $p->customer?->mobile,
            'khata_no' => $p->loan?->khata_no,
            'amount' => $p->amount,
            'payment_type' => $p->payment_type,
            'reference' => $p->reference,
            'installment_numbers' => $inst,
            'breakdown' => [
                'installment' => Money::s(Money::p($alloc->where('type', 'installment')->sum('amount'))),
                'penalty' => Money::s(Money::p($alloc->where('type', 'penalty')->sum('amount'))),
                'old_khata' => Money::s(Money::p($alloc->where('type', 'old_khata')->sum('amount'))),
                'advance' => Money::s(Money::p($alloc->where('type', 'advance_deposit')->sum('amount'))),
            ],
            'remaining_balance' => $m['total_outstanding'],
            'remaining_installments' => $m['remaining_installments'],
            'advance_balance' => $m['advance_balance'],
            'collected_by' => $p->collector?->name,
            'cash_location' => $p->cashLocation?->name,
        ];
    }
}

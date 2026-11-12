<?php

namespace App\Http\Controllers\Api;

use App\Models\Customer;
use App\Models\LoanAccount;
use App\Models\Payment;
use App\Models\Penalty;
use App\Services\AdvanceService;
use App\Services\LoanCalculator;
use App\Services\LoanMetrics;
use App\Services\LoanService;
use App\Support\Audit;
use App\Support\Present;
use App\Support\Scope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class LoanAccountController extends ApiController
{
    private function calcRules(): array
    {
        return [
            'principal_amount' => 'required|numeric|min:1|max:99999999',
            'total_repayment' => 'required|numeric|min:1|max:99999999',
            'installments_count' => 'required|integer|min:1|max:520',
            'weekly_amount' => 'nullable|numeric|min:1',
            'installment_weekday' => 'nullable|integer|between:0,6',
            'first_installment_date' => 'nullable|date_format:Y-m-d',
            'disbursement_date' => 'nullable|date_format:Y-m-d',
            'processing_charges' => 'nullable|numeric|min:0',
            'additional_charges' => 'nullable|numeric|min:0',
            'old_khata_outstanding' => 'nullable|numeric|min:0',
        ];
    }

    /** Calculation preview – nothing is saved. */
    public function preview(Request $r)
    {
        $d = $r->validate($this->calcRules());
        return $this->ok(LoanCalculator::preview($d));
    }

    public function index(Request $r)
    {
        $u = $this->user($r);
        $q = Scope::loans(LoanMetrics::query(), $u)->with(['customer.address', 'customer.assignment.recovery']);
        if ($v = $r->query('status')) $q->where('loan_accounts.status', $v);
        if ($v = $r->query('customer_id')) $q->where('loan_accounts.customer_id', $v);
        if ($s = trim((string) $r->query('q'))) {
            $q->where(fn ($w) => $w->where('khata_no', 'like', "%$s%")
                ->orWhereHas('customer', fn ($c) => $c->where('name', 'like', "%$s%")->orWhere('mobile', 'like', "%$s%")));
        }
        if ($v = $r->query('from')) $q->where('disbursement_date', '>=', $v);
        if ($v = $r->query('to')) $q->where('disbursement_date', '<=', $v);

        $page = $q->orderByDesc('loan_accounts.id')->paginate($this->perPage($r));
        return response()->json(Present::paginated($page, fn ($l) => Present::loan($l)));
    }

    public function store(Request $r)
    {
        $u = $this->user($r);
        $d = $r->validate($this->calcRules() + [
            'customer_id' => 'required|exists:customers,id',
            'start_date' => 'nullable|date_format:Y-m-d',
            'guarantor1_id' => 'nullable|exists:guarantors,id',
            'guarantor2_id' => 'nullable|exists:guarantors,id|different:guarantor1_id',
            'cash_location_id' => 'nullable|exists:cash_locations,id',
            'notes' => 'nullable|string|max:2000',
        ]);
        Gate::authorize('view', Customer::findOrFail($d['customer_id']));

        // financial terms are admin-configurable; managers may only use them as provided in the form
        $loan = LoanService::create($d, $u);
        return $this->ok($this->detail($loan->id, $u), 'Khata created', 201);
    }

    public function show(Request $r, LoanAccount $loanAccount)
    {
        Gate::authorize('view', $loanAccount);
        return $this->ok($this->detail($loanAccount->id, $this->user($r)));
    }

    public function update(Request $r, LoanAccount $loanAccount)
    {
        Gate::authorize('update', $loanAccount);
        $d = $r->validate([
            'notes' => 'nullable|string|max:2000',
            'guarantor1_id' => 'nullable|exists:guarantors,id',
            'guarantor2_id' => 'nullable|exists:guarantors,id|different:guarantor1_id',
        ]);
        foreach (['guarantor1_id', 'guarantor2_id'] as $k) {
            if (!empty($d[$k]) && !\App\Models\Guarantor::where('customer_id', $loanAccount->customer_id)->whereKey($d[$k])->exists()) {
                abort(422, 'Guarantor does not belong to this customer.');
            }
        }
        $old = $loanAccount->only(array_keys($d));
        $loanAccount->update($d);
        Audit::log('loan.updated', $loanAccount, $old, $d);
        return $this->ok($this->detail($loanAccount->id, $this->user($r)), 'Khata updated');
    }

    public function installments(Request $r, LoanAccount $loanAccount)
    {
        Gate::authorize('view', $loanAccount);
        return $this->ok($loanAccount->installments()->get()->map(fn ($i) => Present::installment($i)));
    }

    public function close(Request $r, LoanAccount $loanAccount)
    {
        Gate::authorize('close', $loanAccount);
        $d = $r->validate([
            'settlement' => 'boolean', 'note' => 'nullable|string|max:1000',
            'refund_location_id' => 'nullable|exists:cash_locations,id',
        ]);
        $loan = LoanService::close($loanAccount, $d, $this->user($r));
        return $this->ok($this->detail($loan->id, $this->user($r)), 'Khata closed');
    }

    public function refundAdvance(Request $r, LoanAccount $loanAccount)
    {
        Gate::authorize('view', $loanAccount);
        abort_unless($this->user($r)->hasPermission('advance.refund'), 403);
        $d = $r->validate(['amount' => 'required|numeric|min:0.01', 'cash_location_id' => 'required|exists:cash_locations,id', 'note' => 'nullable|string|max:500']);
        AdvanceService::refund($loanAccount, (string) $d['amount'], (int) $d['cash_location_id'], $this->user($r), $d['note'] ?? null);
        return $this->ok($this->detail($loanAccount->id, $this->user($r)), 'Advance refunded');
    }

    /** Full khata detail incl. schedule, guarantors, penalties and payments. */
    public static function detailFor(int $id, $u): array
    {
        $l = LoanMetrics::query()->with(['customer.address', 'customer.assignment.recovery', 'guarantor1', 'guarantor2'])->findOrFail($id);
        $today = now()->toDateString();
        $installments = $l->installments()->get();
        $current = $installments->first(fn ($i) => $i->remainingPaise() > 0);

        return Present::loan($l) + [
            'installments' => $installments->map(fn ($i) => Present::installment($i, $today)),
            'current_installment_number' => $current?->number,
            'guarantors' => collect([$l->guarantor1, $l->guarantor2])->filter()->map(fn ($g) => Present::guarantor($g, $u))->values(),
            'penalties' => Penalty::where('loan_account_id', $id)->orderByDesc('id')->get()->map(fn ($p) => [
                'id' => $p->id, 'installment_number' => $p->installment_number, 'amount' => $p->amount,
                'paid_amount' => $p->paid_amount, 'waived_amount' => $p->waived_amount, 'status' => $p->status,
                'penalty_date' => $p->penalty_date->toDateString(), 'reason' => $p->reason,
                'outstanding' => \App\Support\Money::s($p->outstandingPaise()),
            ]),
            'payments' => Payment::with(['collector', 'cashLocation'])->where('loan_account_id', $id)->orderByDesc('id')->limit(50)->get()
                ->map(fn ($p) => Present::payment($p)),
        ];
    }

    private function detail(int $id, $u): array
    {
        return self::detailFor($id, $u);
    }
}

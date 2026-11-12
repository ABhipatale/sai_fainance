<?php

namespace App\Http\Controllers\Api;

use App\Models\LoanAccount;
use App\Models\Penalty;
use App\Services\PenaltyService;
use App\Support\Present;
use App\Support\Scope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class PenaltyController extends ApiController
{
    private function map(Penalty $p): array
    {
        return [
            'id' => $p->id, 'customer_id' => $p->customer_id, 'customer_name' => $p->customer?->name,
            'loan_account_id' => $p->loan_account_id, 'khata_no' => $p->loan?->khata_no,
            'installment_number' => $p->installment_number, 'amount' => $p->amount, 'paid_amount' => $p->paid_amount,
            'waived_amount' => $p->waived_amount, 'outstanding' => \App\Support\Money::s($p->outstandingPaise()),
            'status' => $p->status, 'penalty_date' => $p->penalty_date->toDateString(), 'reason' => $p->reason,
            'added_by' => $p->adder?->name, 'waive_reason' => $p->waive_reason, 'reverse_reason' => $p->reverse_reason,
        ];
    }

    public function index(Request $r)
    {
        $u = $this->user($r);
        $q = Penalty::with(['customer:id,name', 'loan:id,khata_no', 'adder:id,name'])
            ->whereIn('penalties.customer_id', Scope::customerIds($u));
        foreach (['customer_id', 'loan_account_id', 'status'] as $f) {
            if ($v = $r->query($f)) $q->where("penalties.$f", $v);
        }
        if ($v = $r->query('from')) $q->where('penalty_date', '>=', $v);
        if ($v = $r->query('to')) $q->where('penalty_date', '<=', $v);
        return response()->json(Present::paginated($q->orderByDesc('penalties.id')->paginate($this->perPage($r)), fn ($p) => $this->map($p)));
    }

    public function store(Request $r)
    {
        $u = $this->user($r);
        $d = $r->validate([
            'loan_account_id' => 'required|exists:loan_accounts,id',
            'installment_number' => 'nullable|integer|min:1',
            'amount' => 'required|numeric|min:0.01|max:9999999',
            'penalty_date' => 'nullable|date_format:Y-m-d',
            'reason' => 'nullable|string|max:500',
        ]);
        Gate::authorize('view', LoanAccount::findOrFail($d['loan_account_id']));
        $p = PenaltyService::add($d, $u);
        return $this->ok($this->map($p->load(['customer', 'loan', 'adder'])), 'Penalty added', 201);
    }

    public function update(Request $r, Penalty $penalty)
    {
        Gate::authorize('update', $penalty);
        $d = $r->validate(['amount' => 'sometimes|numeric|min:0.01', 'penalty_date' => 'sometimes|date_format:Y-m-d', 'reason' => 'nullable|string|max:500']);
        return $this->ok($this->map(PenaltyService::update($penalty, $d, $this->user($r))->load(['customer', 'loan', 'adder'])), 'Penalty updated');
    }

    public function waive(Request $r, Penalty $penalty)
    {
        Gate::authorize('waive', $penalty);
        $d = $r->validate(['reason' => 'required|string|min:3|max:500']);
        return $this->ok($this->map(PenaltyService::waive($penalty, $d['reason'], $this->user($r))->load(['customer', 'loan', 'adder'])), 'Penalty waived');
    }

    public function reverse(Request $r, Penalty $penalty)
    {
        Gate::authorize('reverse', $penalty);
        $d = $r->validate(['reason' => 'required|string|min:3|max:500']);
        return $this->ok($this->map(PenaltyService::reverse($penalty, $d['reason'], $this->user($r))->load(['customer', 'loan', 'adder'])), 'Penalty reversed');
    }
}

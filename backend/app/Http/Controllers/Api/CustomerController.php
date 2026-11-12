<?php

namespace App\Http\Controllers\Api;

use App\Models\AdvanceLedger;
use App\Models\Customer;
use App\Models\CustomerLedger;
use App\Models\Guarantor;
use App\Models\LoanAccount;
use App\Models\Payment;
use App\Models\Penalty;
use App\Models\RecoveryAssignment;
use App\Models\User;
use App\Services\LoanMetrics;
use App\Support\Audit;
use App\Support\Media;
use App\Support\Money;
use App\Support\Present;
use App\Support\Scope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class CustomerController extends ApiController
{
    private function rules(bool $create): array
    {
        $req = $create ? 'required' : 'sometimes|required';
        return [
            'name' => "$req|string|max:150",
            'mobile' => "$req|digits:10",
            'alt_mobile' => 'nullable|digits:10',
            'occupation' => "$req|string|max:120",
            'address' => "$req|string|max:500",
            'village' => "$req|string|max:120",
            'taluka' => "$req|string|max:120",
            'district' => "$req|string|max:120",
            'state' => "$req|string|max:120",
            'pincode' => "$req|digits:6",
            'lat' => "$req|numeric|between:-90,90",
            'lng' => "$req|numeric|between:-180,180",
            'area' => 'nullable|string|max:120',
            'notes' => 'nullable|string|max:2000',
            'aadhaar_no' => 'nullable|digits:12',
            'pan_no' => ['nullable', 'regex:/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/'],
            'photo' => ($create ? 'required' : 'nullable') . '|image|max:4096',
            'aadhaar_photo' => 'nullable|image|max:6144',
            'pan_photo' => 'nullable|image|max:6144',
            'recovery_user_id' => 'nullable|exists:users,id',
        ];
    }

    public function index(Request $r)
    {
        $u = $this->user($r);
        $q = Scope::customers(Customer::query(), $u)->with(['address', 'assignment']);

        if ($s = trim((string) $r->query('q'))) {
            $q->where(function ($w) use ($s) {
                $w->where('customers.name', 'like', "%$s%")->orWhere('customers.mobile', 'like', "%$s%")
                    ->orWhereIn('customers.id', LoanAccount::where('khata_no', 'like', "%$s%")->select('customer_id'));
            });
        }
        if ($v = $r->query('village')) {
            $q->whereHas('address', fn ($a) => $a->where('village', $v));
        }
        if ($v = $r->query('area')) {
            $q->where('area', $v);
        }
        if ($v = $r->query('recovery_user_id')) {
            $q->whereIn('customers.id', RecoveryAssignment::where('recovery_user_id', $v)->select('customer_id'));
        }
        if ($r->query('unassigned')) {
            $q->whereNotIn('customers.id', RecoveryAssignment::select('customer_id'));
        }

        $page = $q->orderBy('customers.name')->paginate($this->perPage($r));

        // per-customer khata summary in a single query
        $ids = collect($page->items())->pluck('id');
        $sum = [];
        LoanMetrics::query()->whereIn('customer_id', $ids)->where('status', 'active')->get()->each(function ($l) use (&$sum) {
            $m = LoanMetrics::format($l);
            $s = &$sum[$l->customer_id];
            $s['active_khata'] = ($s['active_khata'] ?? 0) + 1;
            $s['outstanding'] = ($s['outstanding'] ?? 0) + Money::p($m['total_outstanding']);
            $s['due_now'] = ($s['due_now'] ?? 0) + Money::p($m['net_due_now']);
            $s['advance'] = ($s['advance'] ?? 0) + Money::p($m['advance_balance']);
            $s['khata_nos'][] = $l->khata_no;
        });

        return response()->json(Present::paginated($page, function ($c) use ($u, $sum) {
            $s = $sum[$c->id] ?? [];
            return Present::customer($c, $u) + [
                'active_khata' => $s['active_khata'] ?? 0,
                'outstanding' => Money::s($s['outstanding'] ?? 0),
                'due_now' => Money::s($s['due_now'] ?? 0),
                'advance_balance' => Money::s($s['advance'] ?? 0),
                'khata_nos' => $s['khata_nos'] ?? [],
            ];
        }));
    }

    public function store(Request $r)
    {
        $u = $this->user($r);
        $d = $r->validate($this->rules(true));

        $c = DB::transaction(function () use ($d, $r, $u) {
            $c = Customer::create([
                'name' => $d['name'], 'mobile' => $d['mobile'], 'alt_mobile' => $d['alt_mobile'] ?? null,
                'occupation' => $d['occupation'], 'area' => $d['area'] ?? null, 'notes' => $d['notes'] ?? null,
                'photo_path' => Media::store($r->file('photo'), 'photos'), 'created_by' => $u->id,
            ]);
            $c->address()->create($this->addressData($d));
            $this->saveDocs($c, $d, $r);
            $this->assign($c, $d['recovery_user_id'] ?? null, $u);
            Audit::log('customer.created', $c, null, ['name' => $c->name]);
            return $c;
        });

        return $this->ok(Present::customer($c->load('address', 'assignment'), $u, true), 'Customer created', 201);
    }

    public function show(Request $r, Customer $customer)
    {
        Gate::authorize('view', $customer);
        $u = $this->user($r);
        $customer->load('address', 'assignment.recovery');

        $loans = LoanMetrics::query()->where('customer_id', $customer->id)->orderByDesc('id')->get();
        $tot = ['loan' => 0, 'collected' => 0, 'pending' => 0, 'advance' => 0, 'penalty' => 0];
        $loanRows = $loans->map(function ($l) use (&$tot) {
            $m = LoanMetrics::format($l);
            if ($l->status === 'active') {
                $tot['pending'] += Money::p($m['total_outstanding']);
                $tot['advance'] += Money::p($m['advance_balance']);
                $tot['penalty'] += Money::p($m['penalty_outstanding']);
            }
            $tot['loan'] += Money::p($l->principal_amount);
            return Present::loan($l, false);
        });
        $tot['collected'] = Money::p(Payment::where('customer_id', $customer->id)->where('status', 'completed')->sum('amount'));

        return $this->ok(Present::customer($customer, $u, true) + [
            'recovery_name' => $customer->assignment?->recovery?->name,
            'loans' => $loanRows,
            'guarantors' => $customer->guarantors()->get()->map(fn ($g) => Present::guarantor($g, $u)),
            'totals' => [
                'total_loan_amount' => Money::s($tot['loan']), 'total_collected' => Money::s($tot['collected']),
                'total_pending' => Money::s($tot['pending']), 'advance_balance' => Money::s($tot['advance']),
                'penalty_outstanding' => Money::s($tot['penalty']),
                'active_khata' => $loans->where('status', 'active')->count(), 'closed_khata' => $loans->where('status', 'closed')->count(),
            ],
            'recent_payments' => Payment::with(['loan', 'cashLocation', 'collector'])->where('customer_id', $customer->id)
                ->orderByDesc('id')->limit(15)->get()->map(fn ($p) => Present::payment($p)),
        ]);
    }

    public function update(Request $r, Customer $customer)
    {
        Gate::authorize('update', $customer);
        $u = $this->user($r);
        $d = $r->validate($this->rules(false));
        $old = $customer->toArray();

        DB::transaction(function () use ($customer, $d, $r, $u) {
            $customer->fill(array_intersect_key($d, array_flip(['name', 'mobile', 'alt_mobile', 'occupation', 'area', 'notes'])));
            $customer->photo_path = Media::replace($r->file('photo'), $customer->photo_path, 'photos');
            $customer->save();
            $addr = $this->addressData($d);
            if ($addr) {
                $customer->address()->updateOrCreate([], $addr);
            }
            $this->saveDocs($customer, $d, $r);
            if (array_key_exists('recovery_user_id', $d)) {
                $this->assign($customer, $d['recovery_user_id'], $u);
            }
        });
        Audit::log('customer.updated', $customer, $old, $customer->fresh()->toArray());

        return $this->ok(Present::customer($customer->fresh(['address', 'assignment']), $u, true), 'Customer updated');
    }

    public function ledger(Request $r, Customer $customer)
    {
        Gate::authorize('view', $customer);
        $q = CustomerLedger::with(['creator:id,name', 'loan:id,khata_no'])->where('customer_id', $customer->id);
        if ($v = $r->query('loan_account_id')) $q->where('loan_account_id', $v);
        if ($v = $r->query('from')) $q->where('entry_date', '>=', $v);
        if ($v = $r->query('to')) $q->where('entry_date', '<=', $v);
        $page = $q->orderByDesc('id')->paginate($this->perPage($r, 50));

        return response()->json(Present::paginated($page, fn ($e) => [
            'id' => $e->id, 'date' => $e->entry_date->toDateString(), 'type' => $e->type, 'debit' => $e->debit,
            'credit' => $e->credit, 'balance' => $e->balance, 'description' => $e->description,
            'khata_no' => $e->loan?->khata_no, 'created_by' => $e->creator?->name, 'payment_id' => $e->payment_id,
        ]));
    }

    public function advanceLedger(Request $r, Customer $customer)
    {
        Gate::authorize('view', $customer);
        $q = AdvanceLedger::with(['creator:id,name', 'loan:id,khata_no'])->where('customer_id', $customer->id);
        if ($v = $r->query('loan_account_id')) $q->where('loan_account_id', $v);
        $page = $q->orderByDesc('id')->paginate($this->perPage($r, 50));

        return response()->json(Present::paginated($page, fn ($e) => [
            'id' => $e->id, 'date' => $e->entry_date->toDateString(), 'type' => $e->type, 'credit' => $e->credit,
            'debit' => $e->debit, 'balance' => $e->balance, 'description' => $e->description,
            'khata_no' => $e->loan?->khata_no, 'created_by' => $e->creator?->name,
        ]));
    }

    /** Aadhaar / PAN image – permission checked, never publicly reachable. */
    public function document(Request $r, Customer $customer, string $type)
    {
        Gate::authorize('viewDocuments', $customer);
        abort_unless(in_array($type, ['aadhaar', 'pan'], true), 404);
        $doc = $customer->documents()->where('type', $type)->first();
        abort_unless($doc && $doc->file_path && Storage::disk('local')->exists($doc->file_path), 404);
        Audit::log('customer.document_viewed', $customer, null, ['type' => $type]);
        return Storage::disk('local')->response($doc->file_path);
    }

    public function assignOne(Request $r, Customer $customer)
    {
        Gate::authorize('view', $customer);
        $d = $r->validate(['recovery_user_id' => 'nullable|exists:users,id']);
        $this->assign($customer, $d['recovery_user_id'] ?? null, $this->user($r));
        return $this->ok(null, 'Assigned');
    }

    // ---- helpers -------------------------------------------------------------------------------

    private function addressData(array $d): array
    {
        $keys = ['address', 'village', 'taluka', 'district', 'state', 'pincode', 'lat', 'lng'];
        return array_intersect_key($d, array_flip($keys));
    }

    private function saveDocs(Customer $c, array $d, Request $r): void
    {
        foreach (['aadhaar' => 'aadhaar_no', 'pan' => 'pan_no'] as $type => $field) {
            $file = $r->file($type . '_photo');
            if (!$file && !array_key_exists($field, $d)) {
                continue;
            }
            $doc = $c->documents()->firstOrNew(['type' => $type]);
            if (array_key_exists($field, $d)) {
                $doc->number = $type === 'pan' && $d[$field] ? strtoupper($d[$field]) : $d[$field];
            }
            $doc->file_path = Media::replace($file, $doc->file_path, 'documents');
            $doc->save();
        }
    }

    public static function assignStatic(Customer $c, ?int $recoveryId, User $by): void
    {
        (new self)->assign($c, $recoveryId, $by);
    }

    private function assign(Customer $c, ?int $recoveryId, User $by): void
    {
        if (!$recoveryId) {
            if ($by->hasPermission('recovery.assign')) {
                RecoveryAssignment::where('customer_id', $c->id)->delete();
            }
            return;
        }
        abort_unless($by->hasPermission('recovery.assign'), 403, 'You cannot assign recovery staff.');
        $rec = User::where('role', 'recovery')->where('status', 'active')->findOrFail($recoveryId);
        abort_if($by->isManager() && (int) $rec->manager_id !== $by->id, 403, 'Staff is not under your management.');
        RecoveryAssignment::updateOrCreate(['customer_id' => $c->id], ['recovery_user_id' => $rec->id, 'assigned_by' => $by->id]);
        Audit::log('customer.assigned', $c, null, ['recovery_user_id' => $rec->id]);
    }
}

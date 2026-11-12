<?php

namespace App\Http\Controllers\Api;

use App\Models\CashLedger;
use App\Models\CashLocation;
use App\Models\CashTransfer;
use App\Models\Expense;
use App\Models\OpeningBalance;
use App\Services\CashService;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Present;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CashController extends ApiController
{
    private function loc(CashLocation $l): array
    {
        return [
            'id' => $l->id, 'name' => $l->name, 'type' => $l->type, 'status' => $l->status,
            'responsible_user_id' => $l->responsible_user_id, 'responsible_name' => $l->responsible?->name,
            'opening_balance' => $l->opening_balance, 'current_balance' => $l->current_balance, 'notes' => $l->notes,
        ];
    }

    public function index(Request $r)
    {
        $u = $this->user($r);
        if ($r->query('for') === 'collection') {
            return $this->ok(CashService::allowedForCollection($u)->map(fn ($l) => ['id' => $l->id, 'name' => $l->name, 'type' => $l->type]));
        }
        if ($r->query('for') === 'transfer') {
            // every active location (names only) so staff can hand cash over to the office/bank
            return $this->ok(CashLocation::where('status', 'active')->orderBy('name')->get()->map(fn ($l) => ['id' => $l->id, 'name' => $l->name, 'type' => $l->type]));
        }
        $q = CashLocation::with('responsible')->orderBy('name');
        if ($u->isRecovery()) {
            $q->where('id', $u->cash_location_id ?: 0);
        }
        if ($r->query('status')) $q->where('status', $r->query('status'));
        $rows = $q->get();
        return $this->ok([
            'locations' => $rows->map(fn ($l) => $this->loc($l)),
            'total_cash' => Money::s($rows->sum(fn ($l) => Money::p($l->current_balance))),
        ]);
    }

    private function rules(): array
    {
        return [
            'name' => 'required|string|max:120',
            'type' => 'required|in:office_cash,recovery_cash,bank_account,other',
            'responsible_user_id' => 'nullable|exists:users,id',
            'opening_balance' => 'nullable|numeric|min:0',
            'status' => 'nullable|in:active,inactive',
            'notes' => 'nullable|string|max:500',
        ];
    }

    public function store(Request $r)
    {
        $loc = CashService::createLocation($r->validate($this->rules()), $this->user($r));
        return $this->ok($this->loc($loc->load('responsible')), 'Location created', 201);
    }

    public function update(Request $r, CashLocation $cashLocation)
    {
        // opening/current balances are ledger-driven and cannot be edited here
        $d = $r->validate(collect($this->rules())->except('opening_balance')->map(fn ($v) => str_replace('required|', 'sometimes|', $v))->all());
        $old = $cashLocation->toArray();
        $cashLocation->update($d);
        if (($d['type'] ?? $cashLocation->type) === 'recovery_cash' && $cashLocation->responsible_user_id) {
            \App\Models\User::whereKey($cashLocation->responsible_user_id)->update(['cash_location_id' => $cashLocation->id]);
        }
        Audit::log('cash_location.updated', $cashLocation, $old, $cashLocation->toArray());
        return $this->ok($this->loc($cashLocation->load('responsible')), 'Location updated');
    }

    /** Ledger + reconciliation (opening, collection, transfers, expenses, closing) for a date range. */
    public function ledger(Request $r, CashLocation $cashLocation)
    {
        $u = $this->user($r);
        abort_if($u->isRecovery() && $u->cash_location_id !== $cashLocation->id, 403);
        $from = $r->query('from', now()->startOfMonth()->toDateString());
        $to = $r->query('to', now()->toDateString());

        $before = CashLedger::where('cash_location_id', $cashLocation->id)->where('entry_date', '<', $from)->orderByDesc('id')->value('balance');
        $opening = Money::p($before);
        $rows = CashLedger::where('cash_location_id', $cashLocation->id)->whereBetween('entry_date', [$from, $to]);
        $sum = fn (string $type, string $col) => Money::p((clone $rows)->where('type', $type)->sum($col));

        $collection = $sum('collection', 'inflow') - $sum('reversal', 'outflow');
        $tin = $sum('transfer_in', 'inflow');
        $tout = $sum('transfer_out', 'outflow');
        $exp = $sum('expense', 'outflow');
        $disb = $sum('disbursement', 'outflow');
        $other = Money::p((clone $rows)->whereIn('type', ['opening', 'adjustment', 'refund'])->sum('inflow'))
            - Money::p((clone $rows)->whereIn('type', ['opening', 'adjustment', 'refund'])->sum('outflow'));
        $closing = $opening + $collection + $tin - $tout - $exp - $disb + $other;

        $page = CashLedger::with('creator:id,name')->where('cash_location_id', $cashLocation->id)
            ->whereBetween('entry_date', [$from, $to])->orderByDesc('id')->paginate($this->perPage($r, 50));

        $res = Present::paginated($page, fn ($e) => [
            'id' => $e->id, 'date' => $e->entry_date->toDateString(), 'type' => $e->type, 'inflow' => $e->inflow,
            'outflow' => $e->outflow, 'balance' => $e->balance, 'description' => $e->description, 'created_by' => $e->creator?->name,
        ]);
        $res['reconciliation'] = [
            'opening_balance' => Money::s($opening), 'collection' => Money::s($collection), 'transfer_in' => Money::s($tin),
            'transfer_out' => Money::s($tout), 'expenses' => Money::s($exp), 'disbursement' => Money::s($disb),
            'adjustments' => Money::s($other), 'closing_balance' => Money::s($closing),
            'current_balance' => $cashLocation->current_balance,
        ];
        $res['location'] = $this->loc($cashLocation->load('responsible'));
        return response()->json($res);
    }

    public function adjust(Request $r, CashLocation $cashLocation)
    {
        $d = $r->validate(['amount' => 'required|numeric|not_in:0', 'note' => 'required|string|min:3|max:500']);
        $amt = Money::p($d['amount']);
        DB::transaction(fn () => CashService::post($cashLocation->id, 'adjustment', max(0, $amt), max(0, -$amt), 'Adjustment: ' . $d['note'], now()->toDateString(), $r->user()->id));
        Audit::log('cash.adjustment', $cashLocation, null, $d);
        return $this->ok($this->loc($cashLocation->fresh('responsible')), 'Adjustment recorded');
    }

    public function transfers(Request $r)
    {
        $q = CashTransfer::with(['from:id,name', 'to:id,name', 'creator:id,name']);
        $u = $this->user($r);
        if ($u->isRecovery()) {
            $q->where(fn ($w) => $w->where('from_location_id', $u->cash_location_id)->orWhere('to_location_id', $u->cash_location_id));
        }
        if ($v = $r->query('from')) $q->where('transfer_date', '>=', $v);
        if ($v = $r->query('to')) $q->where('transfer_date', '<=', $v);
        return response()->json(Present::paginated($q->orderByDesc('id')->paginate($this->perPage($r)), fn ($t) => [
            'id' => $t->id, 'from' => $t->from?->name, 'to' => $t->to?->name, 'from_location_id' => $t->from_location_id,
            'to_location_id' => $t->to_location_id, 'amount' => $t->amount, 'transfer_date' => $t->transfer_date->toDateString(),
            'notes' => $t->notes, 'created_by' => $t->creator?->name,
        ]));
    }

    public function transfer(Request $r)
    {
        $d = $r->validate([
            'from_location_id' => 'required|exists:cash_locations,id',
            'to_location_id' => 'required|exists:cash_locations,id',
            'amount' => 'required|numeric|min:0.01',
            'transfer_date' => 'nullable|date_format:Y-m-d',
            'notes' => 'nullable|string|max:500',
        ]);
        $u = $this->user($r);
        // recovery staff may only hand over cash from their own location
        if ($u->isRecovery() && (int) $d['from_location_id'] !== (int) $u->cash_location_id) {
            throw ValidationException::withMessages(['from_location_id' => ['You can only transfer from your own cash location.']]);
        }
        $t = CashService::transfer($d, $u);
        return $this->ok(['id' => $t->id], 'Transfer completed', 201);
    }

    // ---- Monday opening balance ------------------------------------------------------------------

    public function opening(Request $r)
    {
        $week = Carbon::parse($r->query('week', now()->toDateString()))->startOfWeek(Carbon::MONDAY);
        $confirmed = OpeningBalance::where('week_date', $week->toDateString())->get()->keyBy('cash_location_id');
        $locs = CashLocation::where('status', 'active')->orderBy('name')->get();

        return $this->ok([
            'week_date' => $week->toDateString(),
            'locations' => $locs->map(fn ($l) => [
                'id' => $l->id, 'name' => $l->name, 'type' => $l->type,
                'previous_closing' => $confirmed[$l->id]->system_amount ?? $l->current_balance,
                'confirmed' => isset($confirmed[$l->id]),
                'opening_amount' => $confirmed[$l->id]->opening_amount ?? null,
                'adjustment' => $confirmed[$l->id]->adjustment ?? '0.00',
                'adjustment_note' => $confirmed[$l->id]->adjustment_note ?? null,
            ]),
        ]);
    }

    /** Opening defaults to the previous closing; any manual change is stored separately with a ledger adjustment + audit. */
    public function confirmOpening(Request $r)
    {
        $d = $r->validate([
            'week_date' => 'nullable|date_format:Y-m-d',
            'items' => 'required|array|min:1',
            'items.*.cash_location_id' => 'required|exists:cash_locations,id',
            'items.*.adjustment' => 'nullable|numeric',
            'items.*.note' => 'nullable|string|max:500',
        ]);
        $u = $this->user($r);
        $week = Carbon::parse($d['week_date'] ?? now())->startOfWeek(Carbon::MONDAY)->toDateString();

        DB::transaction(function () use ($d, $u, $week) {
            foreach ($d['items'] as $it) {
                if (OpeningBalance::where('cash_location_id', $it['cash_location_id'])->where('week_date', $week)->exists()) {
                    continue; // already confirmed – immutable
                }
                $loc = CashLocation::whereKey($it['cash_location_id'])->lockForUpdate()->first();
                $adj = Money::p($it['adjustment'] ?? 0);
                if ($adj !== 0) {
                    if (empty($it['note'])) {
                        throw ValidationException::withMessages(['items' => ['A note is required for a manual adjustment.']]);
                    }
                    CashService::post($loc->id, 'adjustment', max(0, $adj), max(0, -$adj), 'Monday opening adjustment: ' . $it['note'], $week, $u->id);
                }
                $system = Money::p($loc->current_balance) - $adj;
                OpeningBalance::create([
                    'cash_location_id' => $loc->id, 'week_date' => $week, 'system_amount' => Money::s($system),
                    'adjustment' => Money::s($adj), 'opening_amount' => Money::s($system + $adj),
                    'adjustment_note' => $it['note'] ?? null, 'confirmed_by' => $u->id, 'confirmed_at' => now(),
                ]);
                Audit::log('cash.opening_confirmed', $loc, null, ['week' => $week, 'adjustment' => Money::s($adj), 'note' => $it['note'] ?? null]);
            }
        });
        return $this->ok(null, 'Opening balance confirmed');
    }

    // ---- Expenses ------------------------------------------------------------------------------------

    public function expenses(Request $r)
    {
        $q = Expense::with(['location:id,name', 'creator:id,name']);
        if ($v = $r->query('from')) $q->where('expense_date', '>=', $v);
        if ($v = $r->query('to')) $q->where('expense_date', '<=', $v);
        if ($v = $r->query('cash_location_id')) $q->where('cash_location_id', $v);
        return response()->json(Present::paginated($q->orderByDesc('id')->paginate($this->perPage($r)), fn ($e) => [
            'id' => $e->id, 'location' => $e->location?->name, 'amount' => $e->amount, 'date' => $e->expense_date->toDateString(),
            'category' => $e->category, 'description' => $e->description, 'created_by' => $e->creator?->name,
        ]));
    }

    public function storeExpense(Request $r)
    {
        $d = $r->validate([
            'cash_location_id' => 'required|exists:cash_locations,id', 'amount' => 'required|numeric|min:0.01',
            'expense_date' => 'nullable|date_format:Y-m-d', 'category' => 'nullable|string|max:60', 'description' => 'nullable|string|max:500',
        ]);
        $u = $this->user($r);
        $e = DB::transaction(function () use ($d, $u) {
            $date = $d['expense_date'] ?? now()->toDateString();
            $e = Expense::create($d + ['expense_date' => $date, 'created_by' => $u->id]);
            CashService::post($e->cash_location_id, 'expense', 0, Money::p($e->amount), 'Expense: ' . ($e->category ?? '') . ' ' . ($e->description ?? ''), $date, $u->id, ['expense_id' => $e->id]);
            Audit::log('expense.created', $e, null, $e->toArray());
            return $e;
        });
        return $this->ok(['id' => $e->id], 'Expense saved', 201);
    }
}

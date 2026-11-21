<?php

namespace App\Http\Controllers\Api;

use App\Models\Customer;
use App\Models\CashLocation;
use App\Models\Payment;
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
use Illuminate\Validation\Rule;

/** Recovery staff + manager + admin accounts. Accounts are deactivated, never deleted. */
class UserController extends ApiController
{
    private function canManage(User $by, string $role): bool
    {
        return match ($role) {
            'recovery' => $by->hasPermission('recovery.manage'),
            'manager' => $by->hasPermission('managers.manage'),
            default => $by->hasPermission('users.manage'),
        };
    }

    public function index(Request $r)
    {
        $u = $this->user($r);
        $q = User::query();
        $role = $r->query('role');
        if ($u->isManager()) {
            $q = Scope::staff($q, $u);                       // managers only see their own staff
        } elseif ($role) {
            $q->where('role', $role);
        }
        if ($r->query('status')) $q->where('status', $r->query('status'));
        $rows = $q->orderBy('name')->get();

        $counts = RecoveryAssignment::select('recovery_user_id', DB::raw('count(*) c'))->groupBy('recovery_user_id')->pluck('c', 'recovery_user_id');
        return $this->ok($rows->map(fn ($x) => Present::user($x) + [
            'assigned_customers' => (int) ($counts[$x->id] ?? 0),
            'cash_location' => $x->cash_location_id ? CashLocation::find($x->cash_location_id)?->name : null,
            'last_login_at' => $x->last_login_at?->toDateTimeString(),
        ]));
    }

    private function rules(?User $existing = null): array
    {
        return [
            'name' => 'required|string|max:150',
            'mobile' => 'nullable|digits:10',
            'username' => ['required', 'alpha_dash', 'min:3', 'max:60', Rule::unique('users', 'username')->ignore($existing?->id)],
            'password' => [$existing ? 'nullable' : 'required', 'string', 'min:8'],
            'role' => 'required|in:admin,manager,recovery',
            'assigned_area' => 'nullable|string|max:120',
            'manager_id' => 'nullable|exists:users,id',
            'cash_location_id' => 'nullable|exists:cash_locations,id',
            'status' => 'nullable|in:active,inactive',
            'photo' => 'nullable|image|max:4096',
        ];
    }

    public function store(Request $r)
    {
        $by = $this->user($r);
        $d = $r->validate($this->rules());
        abort_unless($this->canManage($by, $d['role']), 403);
        if ($by->isManager()) {
            $d['manager_id'] = $by->id;                       // managers create staff only under themselves
        }
        $user = DB::transaction(function () use ($d, $r) {
            $u = User::create(collect($d)->except('photo')->all() + ['photo_path' => Media::store($r->file('photo'), 'photos')]);
            if ($u->cash_location_id) {
                CashLocation::whereKey($u->cash_location_id)->whereNull('responsible_user_id')->update(['responsible_user_id' => $u->id]);
            }
            return $u;
        });
        Audit::log('user.created', $user, null, ['username' => $user->username, 'role' => $user->role]);
        return $this->ok(Present::user($user), 'User created', 201);
    }

    public function update(Request $r, User $user)
    {
        $by = $this->user($r);
        abort_unless($this->canManage($by, $user->role), 403);
        abort_if($by->isManager() && (int) $user->manager_id !== $by->id, 403);
        $d = $r->validate($this->rules($user));
        abort_if($d['role'] !== $user->role && !$by->isAdmin(), 403);
        abort_if($user->id === $by->id && ($d['status'] ?? 'active') !== 'active', 422, 'You cannot deactivate your own account.');

        $old = $user->only(['name', 'role', 'status', 'assigned_area', 'cash_location_id']);
        $user->fill(collect($d)->except(['photo', 'password'])->all());
        if (!empty($d['password'])) {
            $user->password = $d['password'];
            $user->tokens()->delete();
        }
        $user->photo_path = Media::replace($r->file('photo'), $user->photo_path, 'photos');
        if (($d['status'] ?? 'active') === 'inactive') {
            $user->tokens()->delete();
        }
        $user->save();
        Audit::log('user.updated', $user, $old, $user->only(array_keys($old)));
        return $this->ok(Present::user($user), 'User updated');
    }

    /** Assign customers to a recovery person (bulk). */
    public function assign(Request $r)
    {
        $by = $this->user($r);
        $d = $r->validate(['recovery_user_id' => 'nullable|exists:users,id', 'customer_ids' => 'required|array|min:1', 'customer_ids.*' => 'integer|exists:customers,id']);
        if (empty($d['recovery_user_id'])) {
            // no recovery person given = take these customers off whoever has them
            $visible = Scope::customers(Customer::query(), $by)->whereIn('customers.id', $d['customer_ids'])->pluck('customers.id');
            RecoveryAssignment::whereIn('customer_id', $visible)->delete();
            Audit::log('recovery.unassigned', $by, null, ['customers' => $visible->all()]);
            return $this->ok(['assigned' => 0, 'unassigned' => $visible->count()], 'Customers unassigned');
        }
        $rec = User::where('role', 'recovery')->where('status', 'active')->findOrFail($d['recovery_user_id']);
        abort_if($by->isManager() && (int) $rec->manager_id !== $by->id, 403, 'Staff is not under your management.');

        $visible = Scope::customers(Customer::query(), $by)->whereIn('customers.id', $d['customer_ids'])->pluck('customers.id');
        DB::transaction(function () use ($visible, $rec, $by) {
            foreach ($visible as $cid) {
                RecoveryAssignment::updateOrCreate(['customer_id' => $cid], ['recovery_user_id' => $rec->id, 'assigned_by' => $by->id]);
            }
        });
        Audit::log('recovery.assigned', $rec, null, ['customers' => $visible->all()]);
        return $this->ok(['assigned' => $visible->count()], 'Customers assigned');
    }

    /** Recovery staff dashboard / performance. */
    public function performance(Request $r, User $user)
    {
        $by = $this->user($r);
        abort_if($by->isRecovery() && $by->id !== $user->id, 403);
        abort_if($by->isManager() && $user->id !== $by->id && (int) $user->manager_id !== $by->id, 403);

        return $this->ok(self::performanceFor($user));
    }

    public static function performanceFor(User $user): array
    {
        $today = now()->toDateString();
        $ids = RecoveryAssignment::where('recovery_user_id', $user->id)->pluck('customer_id');
        $loans = LoanMetrics::query()->whereIn('customer_id', $ids)->where('status', 'active')->get()->map(fn ($l) => LoanMetrics::format($l));

        $expected = $loans->sum(fn ($m) => Money::p($m['today_due']));
        $collected = Money::p(Payment::where('collected_by', $user->id)->where('payment_date', $today)->where('status', 'completed')->sum('amount'));
        $pending = $loans->sum(fn ($m) => Money::p($m['net_due_now']));
        $weekStart = now()->startOfWeek(\Carbon\Carbon::MONDAY)->toDateString();
        $weekCollected = Money::p(Payment::where('collected_by', $user->id)->where('payment_date', '>=', $weekStart)->where('status', 'completed')->sum('amount'));

        return [
            'user' => Present::user($user),
            'assigned_customers' => $ids->count(),
            'active_khata' => $loans->count(),
            'expected_today' => Money::s($expected),
            'collected_today' => Money::s($collected),
            'remaining_today' => Money::s($pending),
            'total_pending' => Money::s($pending),
            'week_collected' => Money::s($weekCollected),
            'performance_pct' => ($expected + 0) > 0 ? round(min(100, $collected * 100 / $expected), 1) : null,
            'cash_balance' => $user->cash_location_id ? CashLocation::find($user->cash_location_id)?->current_balance : null,
        ];
    }
}

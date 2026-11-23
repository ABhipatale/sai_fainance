<?php

namespace App\Http\Controllers\Api;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\FinanceSetting;
use App\Support\Audit;
use App\Support\Media;
use App\Support\Present;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class SettingsController extends ApiController
{
    public const KEYS = ['general', 'loan_defaults', 'payment_types', 'recovery_areas', 'receipt_format', 'penalty', 'collection_weekday', 'pending_sort'];

    public static function general(): array
    {
        $g = FinanceSetting::get('general', []);
        $g['logo_url'] = Media::url($g['logo_path'] ?? null);
        return $g;
    }

    public function show()
    {
        $out = [];
        foreach (self::KEYS as $k) {
            $out[$k] = FinanceSetting::get($k);
        }
        $out['general'] = self::general();
        return $this->ok($out);
    }

    public function update(Request $r)
    {
        $d = $r->validate([
            'general' => 'sometimes|array:name,address,phone,language,currency,date_format',
            'general.name' => 'sometimes|string|max:150',
            'general.address' => 'nullable|string|max:500',
            'general.phone' => 'nullable|string|max:30',
            'general.language' => 'sometimes|in:mr,en,hi',
            'general.currency' => 'sometimes|string|max:5',
            'general.date_format' => 'sometimes|string|max:20',
            'loan_defaults' => 'sometimes|array:installments_count,installment_weekday,weekly_amount,repayment_ratio',
            'loan_defaults.installments_count' => 'nullable|integer|min:1|max:520',
            'loan_defaults.installment_weekday' => 'nullable|integer|between:0,6',
            'loan_defaults.weekly_amount' => 'nullable|numeric|min:0',
            'loan_defaults.repayment_ratio' => 'nullable|numeric|min:1|max:10', // only a *suggestion* in the form; never forced
            'payment_types' => 'sometimes|array|min:1',
            'payment_types.*' => 'in:cash,upi,bank,other',
            'recovery_areas' => 'sometimes|array|max:200',
            'recovery_areas.*' => 'string|max:120',
            'receipt_format' => 'sometimes|array:show_logo,footer',
            'receipt_format.show_logo' => 'boolean',
            'receipt_format.footer' => 'nullable|string|max:300',
            'penalty' => 'sometimes|array:manager_can_add',
            'penalty.manager_can_add' => 'boolean',
            'collection_weekday' => 'sometimes|integer|between:0,6',
            'pending_sort' => 'sometimes|array:by,dir',
            'pending_sort.by' => 'in:remaining_installments,overdue_amount,pending_amount,next_due_date,name,village',
            'pending_sort.dir' => 'in:asc,desc',
        ]);
        foreach ($d as $k => $v) {
            if ($k === 'general') {
                $v = array_merge(FinanceSetting::get('general', []), $v);
            }
            $old = FinanceSetting::get($k);
            FinanceSetting::put($k, $v);
            Audit::log('settings.updated', null, ['key' => $k, 'value' => $old], ['key' => $k, 'value' => $v]);
        }
        return $this->show();
    }

    public function logo(Request $r)
    {
        $r->validate(['logo' => 'required|image|max:2048']);
        $g = FinanceSetting::get('general', []);
        if (!empty($g['logo_path'])) {
            Storage::disk('local')->delete($g['logo_path']);
        }
        $g['logo_path'] = Media::store($r->file('logo'), 'logos');
        FinanceSetting::put('general', $g);
        Audit::log('settings.logo_changed');
        return $this->ok(['logo_url' => Media::url($g['logo_path'])], 'Logo updated');
    }

    // ---- role permissions ------------------------------------------------------------------------------

    public function permissions()
    {
        $perms = DB::table('permissions')->orderBy('group')->orderBy('key')->get(['key', 'group']);
        $map = DB::table('role_permissions')->get()->groupBy('role_key')->map(fn ($g) => $g->pluck('permission_key'));
        return $this->ok(['permissions' => $perms, 'roles' => ['admin' => $map['admin'] ?? [], 'manager' => $map['manager'] ?? [], 'recovery' => $map['recovery'] ?? []]]);
    }

    public function updatePermissions(Request $r)
    {
        $d = $r->validate(['role' => 'required|in:manager,recovery', 'permissions' => 'array', 'permissions.*' => 'string|exists:permissions,key']);
        // recovery can never be granted administrative functions
        $forbidden = ['settings.manage', 'users.manage', 'managers.manage', 'audit.view', 'cash.opening', 'loans.close'];
        $keys = collect($d['permissions'] ?? [])->unique();
        if ($d['role'] === 'recovery') {
            $keys = $keys->reject(fn ($k) => in_array($k, $forbidden, true));
        }
        DB::transaction(function () use ($d, $keys) {
            DB::table('role_permissions')->where('role_key', $d['role'])->delete();
            DB::table('role_permissions')->insert($keys->map(fn ($k) => ['role_key' => $d['role'], 'permission_key' => $k])->all());
        });
        Cache::forget('perms.' . $d['role']);
        Audit::log('settings.permissions_changed', null, null, ['role' => $d['role'], 'permissions' => $keys->values()]);
        return $this->permissions();
    }

    // ---- audit log ----------------------------------------------------------------------------------------

    public function audit(Request $r)
    {
        $q = AuditLog::with('user:id,name,role');
        if ($v = $r->query('action')) $q->where('action', 'like', "$v%");
        if ($v = $r->query('user_id')) $q->where('user_id', $v);
        if ($v = $r->query('entity_type')) $q->where('entity_type', $v);
        if ($v = $r->query('from')) $q->where('created_at', '>=', $v . ' 00:00:00');
        if ($v = $r->query('to')) $q->where('created_at', '<=', $v . ' 23:59:59');
        return response()->json(Present::paginated($q->orderByDesc('id')->paginate($this->perPage($r, 50)), fn ($a) => [
            'id' => $a->id, 'action' => $a->action, 'entity_type' => $a->entity_type, 'entity_id' => $a->entity_id,
            'user' => $a->user?->name, 'role' => $a->user?->role, 'old' => $a->old_values, 'new' => $a->new_values,
            'ip' => $a->ip, 'created_at' => $a->created_at?->toDateTimeString(),
        ]));
    }

    // ---- notifications -----------------------------------------------------------------------------------

    public function notifications(Request $r)
    {
        $q = AppNotification::where('user_id', $r->user()->id)->orderByDesc('id');
        return $this->ok([
            'unread' => AppNotification::where('user_id', $r->user()->id)->whereNull('read_at')->count(),
            'items' => $q->limit(30)->get()->map(fn ($n) => ['id' => $n->id, 'type' => $n->type, 'title' => $n->title, 'body' => $n->body, 'data' => $n->data, 'read' => (bool) $n->read_at, 'created_at' => $n->created_at->toDateTimeString()]),
        ]);
    }

    public function readNotifications(Request $r)
    {
        AppNotification::where('user_id', $r->user()->id)->whereNull('read_at')->update(['read_at' => now()]);
        return $this->ok(null, 'OK');
    }
}

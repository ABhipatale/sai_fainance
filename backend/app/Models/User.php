<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens;

    protected $guarded = [];
    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return ['password' => 'hashed', 'last_login_at' => 'datetime'];
    }

    public function isAdmin(): bool { return $this->role === 'admin'; }
    public function isManager(): bool { return $this->role === 'manager'; }
    public function isRecovery(): bool { return $this->role === 'recovery'; }

    /** @return string[] */
    public function permissionKeys(): array
    {
        return Cache::remember('perms.' . $this->role, 300, fn () =>
            DB::table('role_permissions')->where('role_key', $this->role)->pluck('permission_key')->all());
    }

    public function hasPermission(string $key): bool
    {
        return $this->status === 'active' && in_array($key, $this->permissionKeys(), true);
    }

    public function manager(): BelongsTo { return $this->belongsTo(User::class, 'manager_id'); }
    public function staff(): HasMany { return $this->hasMany(User::class, 'manager_id'); }
    public function cashLocation(): BelongsTo { return $this->belongsTo(CashLocation::class); }
    public function assignments(): HasMany { return $this->hasMany(RecoveryAssignment::class, 'recovery_user_id'); }
}
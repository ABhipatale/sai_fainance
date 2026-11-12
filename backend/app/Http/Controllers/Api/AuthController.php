<?php

namespace App\Http\Controllers\Api;

use App\Models\FinanceSetting;
use App\Models\User;
use App\Support\Audit;
use App\Support\Present;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends ApiController
{
    public function login(Request $r)
    {
        $d = $r->validate(['username' => 'required|string', 'password' => 'required|string']);

        $user = User::where('username', $d['username'])->orWhere('mobile', $d['username'])->first();
        if (!$user || !Hash::check($d['password'], $user->password)) {
            Audit::log('auth.login_failed', null, null, ['username' => $d['username']]);
            throw ValidationException::withMessages(['username' => ['Invalid username or password.']]);
        }
        if ($user->status !== 'active') {
            throw ValidationException::withMessages(['username' => ['This account is inactive.']]);
        }

        $user->update(['last_login_at' => now()]);
        $token = $user->createToken('pwa', ['*'], now()->addDays(14))->plainTextToken;
        Audit::log('auth.login', $user, null, null, $user->id);

        return $this->ok($this->payload($user) + ['token' => $token], 'Logged in');
    }

    public function logout(Request $r)
    {
        $r->user()->currentAccessToken()?->delete();
        Audit::log('auth.logout');
        return $this->ok(null, 'Logged out');
    }

    public function me(Request $r)
    {
        return $this->ok($this->payload($r->user()));
    }

    public function changePassword(Request $r)
    {
        $d = $r->validate([
            'current_password' => 'required|string',
            'password' => 'required|string|min:8|confirmed',
        ]);
        $u = $r->user();
        if (!Hash::check($d['current_password'], $u->password)) {
            throw ValidationException::withMessages(['current_password' => ['Current password is incorrect.']]);
        }
        $u->update(['password' => $d['password']]);
        $u->tokens()->where('id', '!=', $u->currentAccessToken()->id)->delete(); // sign out other sessions
        Audit::log('auth.password_changed', $u);
        return $this->ok(null, 'Password changed');
    }

    public function language(Request $r)
    {
        $d = $r->validate(['language' => 'required|in:mr,en,hi']);
        $r->user()->update($d);
        return $this->ok(null, 'Saved');
    }

    private function payload(User $u): array
    {
        return [
            'user' => Present::user($u),
            'permissions' => $u->permissionKeys(),
            'finance' => SettingsController::general(),
            'config' => [
                'collection_weekday' => (int) FinanceSetting::get('collection_weekday', 2),
                'payment_types' => FinanceSetting::get('payment_types', ['cash', 'upi', 'bank', 'other']),
                'recovery_areas' => FinanceSetting::get('recovery_areas', []),
                'pending_sort' => FinanceSetting::get('pending_sort', ['by' => 'remaining_installments', 'dir' => 'asc']),
                'loan_defaults' => FinanceSetting::get('loan_defaults', []),
            ],
        ];
    }
}

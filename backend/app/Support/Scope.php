<?php

namespace App\Support;

use App\Models\Customer;
use App\Models\RecoveryAssignment;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/** Row-level data scoping – enforced on the server for every query. */
final class Scope
{
    /** Restrict a Customer query to what $u may see. */
    public static function customers(Builder $q, User $u): Builder
    {
        if ($u->isAdmin()) {
            return $q;
        }
        if ($u->isRecovery()) {
            return $q->whereIn('customers.id', RecoveryAssignment::where('recovery_user_id', $u->id)->select('customer_id'));
        }
        // manager: own registrations, customers of own recovery staff, and unassigned customers
        return $q->where(function ($w) use ($u) {
            $w->where('customers.created_by', $u->id)
                ->orWhereIn('customers.id', RecoveryAssignment::whereIn('recovery_user_id', User::where('manager_id', $u->id)->select('id'))->select('customer_id'))
                ->orWhereNotIn('customers.id', RecoveryAssignment::select('customer_id'));
        });
    }

    public static function customerIds(User $u): Builder
    {
        return self::customers(Customer::query(), $u)->select('customers.id');
    }

    public static function loans(Builder $q, User $u): Builder
    {
        return $u->isAdmin() ? $q : $q->whereIn($q->getModel()->getTable() . '.customer_id', self::customerIds($u));
    }

    public static function canSeeCustomer(User $u, int $customerId): bool
    {
        return self::customers(Customer::query(), $u)->whereKey($customerId)->exists();
    }

    /** Recovery users assigned to / managed by $u (for staff screens). */
    public static function staff(Builder $q, User $u): Builder
    {
        $q->where('role', 'recovery');
        return $u->isManager() ? $q->where('manager_id', $u->id) : $q;
    }
}

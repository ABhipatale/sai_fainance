<?php

namespace App\Policies;

use App\Models\Penalty;
use App\Models\User;
use App\Support\Scope;

class PenaltyPolicy
{
    public function view(User $u, Penalty $p): bool
    {
        return $u->hasPermission('penalties.view') && Scope::canSeeCustomer($u, $p->customer_id);
    }

    public function update(User $u, Penalty $p): bool
    {
        return $u->hasPermission('penalties.update') && Scope::canSeeCustomer($u, $p->customer_id);
    }

    public function waive(User $u, Penalty $p): bool
    {
        return $u->hasPermission('penalties.waive') && Scope::canSeeCustomer($u, $p->customer_id);
    }

    public function reverse(User $u, Penalty $p): bool
    {
        return $u->hasPermission('penalties.reverse') && Scope::canSeeCustomer($u, $p->customer_id);
    }
}

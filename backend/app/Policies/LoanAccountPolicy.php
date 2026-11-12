<?php

namespace App\Policies;

use App\Models\LoanAccount;
use App\Models\User;
use App\Support\Scope;

class LoanAccountPolicy
{
    public function view(User $u, LoanAccount $l): bool
    {
        return $u->hasPermission('loans.view') && Scope::canSeeCustomer($u, $l->customer_id);
    }

    public function update(User $u, LoanAccount $l): bool
    {
        return $u->hasPermission('loans.update') && Scope::canSeeCustomer($u, $l->customer_id);
    }

    public function close(User $u, LoanAccount $l): bool
    {
        return $u->hasPermission('loans.close') && Scope::canSeeCustomer($u, $l->customer_id);
    }

    public function collect(User $u, LoanAccount $l): bool
    {
        return $u->hasPermission('payments.collect') && Scope::canSeeCustomer($u, $l->customer_id);
    }
}

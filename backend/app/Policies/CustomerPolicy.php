<?php

namespace App\Policies;

use App\Models\Customer;
use App\Models\User;
use App\Support\Scope;

class CustomerPolicy
{
    public function view(User $u, Customer $c): bool
    {
        return $u->hasPermission('customers.view') && Scope::canSeeCustomer($u, $c->id);
    }

    public function update(User $u, Customer $c): bool
    {
        return $u->hasPermission('customers.update') && Scope::canSeeCustomer($u, $c->id);
    }

    public function viewDocuments(User $u, Customer $c): bool
    {
        return $u->hasPermission('customers.documents') && Scope::canSeeCustomer($u, $c->id);
    }
}

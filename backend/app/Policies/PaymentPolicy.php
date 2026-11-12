<?php

namespace App\Policies;

use App\Models\Payment;
use App\Models\User;
use App\Support\Scope;

class PaymentPolicy
{
    public function view(User $u, Payment $p): bool
    {
        if (!$u->hasPermission('payments.view')) {
            return false;
        }
        if ($u->isRecovery()) {
            return $p->collected_by === $u->id || Scope::canSeeCustomer($u, $p->customer_id);
        }
        return Scope::canSeeCustomer($u, $p->customer_id);
    }

    public function reverse(User $u, Payment $p): bool
    {
        return $u->hasPermission('payments.reverse') && Scope::canSeeCustomer($u, $p->customer_id);
    }
}

<?php

namespace App\Support;

use App\Models\Customer;
use App\Models\Guarantor;
use App\Models\LoanAccount;
use App\Models\LoanInstallment;
use App\Models\Payment;
use App\Models\User;
use App\Services\LoanMetrics;

/** Converts models into API arrays (single place that decides what is exposed to which role). */
final class Present
{
    public static function mask(?string $v, bool $show): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        return $show ? $v : str_repeat('X', max(0, strlen($v) - 4)) . substr($v, -4);
    }

    public static function user(User $u): array
    {
        return [
            'id' => $u->id, 'name' => $u->name, 'username' => $u->username, 'mobile' => $u->mobile,
            'role' => $u->role, 'status' => $u->status, 'photo_url' => Media::url($u->photo_path),
            'assigned_area' => $u->assigned_area, 'manager_id' => $u->manager_id,
            'cash_location_id' => $u->cash_location_id, 'language' => $u->language,
        ];
    }

    public static function customer(Customer $c, User $viewer, bool $detail = false): array
    {
        $a = $c->relationLoaded('address') ? $c->address : $c->address()->first();
        $canDocs = $viewer->hasPermission('customers.documents');
        $out = [
            'id' => $c->id, 'name' => $c->name, 'mobile' => $c->mobile, 'alt_mobile' => $c->alt_mobile,
            'occupation' => $c->occupation, 'photo_url' => Media::url($c->photo_path), 'area' => $c->area,
            'status' => $c->status,
            'address' => $a?->address, 'village' => $a?->village, 'taluka' => $a?->taluka, 'district' => $a?->district,
            'state' => $a?->state, 'pincode' => $a?->pincode, 'lat' => $a?->lat, 'lng' => $a?->lng,
            'recovery_user_id' => $c->relationLoaded('assignment') ? $c->assignment?->recovery_user_id : null,
        ];
        if ($detail) {
            $docs = $c->documents()->get()->keyBy('type');
            $out['notes'] = $c->notes;
            $out['aadhaar_no'] = self::mask($docs['aadhaar']->number ?? null, $canDocs);
            $out['pan_no'] = self::mask($docs['pan']->number ?? null, $canDocs);
            $out['has_aadhaar_photo'] = $canDocs && !empty($docs['aadhaar']->file_path ?? null);
            $out['has_pan_photo'] = $canDocs && !empty($docs['pan']->file_path ?? null);
            $out['documents_visible'] = $canDocs;
            $out['created_at'] = $c->created_at?->toDateTimeString();
        }
        return $out;
    }

    public static function guarantor(Guarantor $g, User $viewer): array
    {
        return [
            'id' => $g->id, 'customer_id' => $g->customer_id, 'name' => $g->name, 'mobile' => $g->mobile,
            'photo_url' => Media::url($g->photo_path), 'address' => $g->address, 'village' => $g->village,
            'taluka' => $g->taluka, 'district' => $g->district, 'lat' => $g->lat, 'lng' => $g->lng,
            'aadhaar_no' => self::mask($g->aadhaar_no, $viewer->hasPermission('customers.documents')),
        ];
    }

    /** $loan must come from LoanMetrics::query() (carries m_* columns). */
    public static function loan(LoanAccount $l, bool $withCustomer = true): array
    {
        $out = [
            'id' => $l->id, 'khata_no' => $l->khata_no, 'customer_id' => $l->customer_id, 'status' => $l->status,
            'start_date' => $l->start_date?->toDateString(), 'disbursement_date' => $l->disbursement_date?->toDateString(),
            'principal_amount' => $l->principal_amount, 'total_repayment' => $l->total_repayment,
            'finance_charges' => Money::s(Money::p($l->total_repayment) - Money::p($l->principal_amount)),
            'installments_count' => $l->installments_count, 'weekly_amount' => $l->weekly_amount,
            'installment_weekday' => $l->installment_weekday, 'first_installment_date' => $l->first_installment_date?->toDateString(),
            'processing_charges' => $l->processing_charges, 'additional_charges' => $l->additional_charges,
            'old_khata_outstanding' => $l->old_khata_outstanding, 'notes' => $l->notes,
            'guarantor1_id' => $l->guarantor1_id, 'guarantor2_id' => $l->guarantor2_id,
            'closed_at' => $l->closed_at?->toDateTimeString(), 'close_type' => $l->close_type, 'close_note' => $l->close_note,
        ] + LoanMetrics::format($l);

        if ($withCustomer && $l->relationLoaded('customer') && $l->customer) {
            $c = $l->customer;
            $a = $c->relationLoaded('address') ? $c->address : null;
            $out['customer'] = [
                'id' => $c->id, 'name' => $c->name, 'mobile' => $c->mobile, 'photo_url' => Media::url($c->photo_path),
                'village' => $a?->village, 'lat' => $a?->lat, 'lng' => $a?->lng, 'area' => $c->area,
                'recovery_user_id' => $c->relationLoaded('assignment') ? $c->assignment?->recovery_user_id : null,
                'recovery_name' => ($c->relationLoaded('assignment') && $c->assignment?->relationLoaded('recovery')) ? $c->assignment->recovery?->name : null,
            ];
        }
        return $out;
    }

    public static function installment(LoanInstallment $i, ?string $today = null): array
    {
        return [
            'id' => $i->id, 'number' => $i->number, 'due_date' => $i->due_date->toDateString(),
            'expected_amount' => $i->expected_amount, 'paid_amount' => $i->paid_amount,
            'advance_applied' => $i->advance_applied, 'waived_amount' => $i->waived_amount,
            'remaining_amount' => Money::s($i->remainingPaise()),
            'status' => $i->displayStatus($today), 'paid_at' => $i->paid_at?->toDateTimeString(),
        ];
    }

    public static function payment(Payment $p): array
    {
        return [
            'id' => $p->id, 'receipt_no' => $p->receipt_no, 'loan_account_id' => $p->loan_account_id,
            'customer_id' => $p->customer_id, 'payment_date' => $p->payment_date->toDateString(),
            'amount' => $p->amount, 'payment_type' => $p->payment_type, 'cash_location_id' => $p->cash_location_id,
            'collected_by' => $p->collected_by, 'reference' => $p->reference, 'notes' => $p->notes, 'mode' => $p->mode,
            'status' => $p->status, 'reversal_reason' => $p->reversal_reason, 'is_offline' => $p->is_offline,
            'created_at' => $p->created_at?->toDateTimeString(),
            'customer_name' => $p->relationLoaded('customer') ? $p->customer?->name : null,
            'khata_no' => $p->relationLoaded('loan') ? $p->loan?->khata_no : null,
            'location_name' => $p->relationLoaded('cashLocation') ? $p->cashLocation?->name : null,
            'collector_name' => $p->relationLoaded('collector') ? $p->collector?->name : null,
        ];
    }

    public static function paginated($paginator, callable $map): array
    {
        return [
            'success' => true,
            'data' => collect($paginator->items())->map($map)->values(),
            'meta' => [
                'page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(),
                'total' => $paginator->total(), 'last_page' => $paginator->lastPage(),
            ],
        ];
    }
}

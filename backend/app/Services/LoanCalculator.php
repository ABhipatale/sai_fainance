<?php

namespace App\Services;

use App\Support\Money;
use Carbon\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Pure calculation service – no interest/repayment values are hard-coded.
 * Everything is configurable by the Admin and calculated in integer paise.
 */
class LoanCalculator
{
    /**
     * @param array{principal_amount:mixed,total_repayment:mixed,installments_count:int,weekly_amount?:mixed,
     *              installment_weekday?:int,first_installment_date?:string,disbursement_date?:string,
     *              processing_charges?:mixed,additional_charges?:mixed,old_khata_outstanding?:mixed} $in
     */
    public static function preview(array $in): array
    {
        $principal = Money::p($in['principal_amount'] ?? 0);
        $total = Money::p($in['total_repayment'] ?? 0);
        $n = (int) ($in['installments_count'] ?? 0);
        $weekday = (int) ($in['installment_weekday'] ?? 2);

        if ($principal <= 0 || $total <= 0 || $n < 1) {
            throw ValidationException::withMessages(['total_repayment' => ['Principal, total repayment and installment count are required.']]);
        }
        if ($total < $principal) {
            throw ValidationException::withMessages(['total_repayment' => ['Total repayment cannot be less than principal.']]);
        }

        $weekly = isset($in['weekly_amount']) && $in['weekly_amount'] !== '' && $in['weekly_amount'] !== null
            ? Money::p($in['weekly_amount'])
            : (int) (ceil($total / $n / 100) * 100); // round up to whole rupee by default
        if ($weekly <= 0) {
            throw ValidationException::withMessages(['weekly_amount' => ['Weekly installment must be greater than zero.']]);
        }
        $last = $total - $weekly * ($n - 1);
        if ($last <= 0) {
            throw ValidationException::withMessages(['weekly_amount' => ['Weekly installment is too large for this repayment and installment count.']]);
        }

        $disb = Carbon::parse($in['disbursement_date'] ?? now()->toDateString())->startOfDay();
        $first = !empty($in['first_installment_date'])
            ? Carbon::parse($in['first_installment_date'])->startOfDay()
            : self::nextWeekday($disb, $weekday);

        if ($first->dayOfWeek !== $weekday) {
            throw ValidationException::withMessages(['first_installment_date' => ['First installment date must fall on the selected installment day.']]);
        }
        if ($first->lt($disb)) {
            throw ValidationException::withMessages(['first_installment_date' => ['First installment date cannot be before disbursement date.']]);
        }

        $schedule = [];
        for ($i = 1; $i <= $n; $i++) {
            $schedule[] = [
                'number' => $i,
                'due_date' => $first->copy()->addWeeks($i - 1)->toDateString(),
                'amount' => Money::s($i === $n ? $last : $weekly),
            ];
        }

        $processing = Money::p($in['processing_charges'] ?? 0);
        $additional = Money::p($in['additional_charges'] ?? 0);

        return [
            'principal_amount' => Money::s($principal),
            'total_repayment' => Money::s($total),
            'finance_charges' => Money::s($total - $principal),
            'weekly_amount' => Money::s($weekly),
            'last_installment_amount' => Money::s($last),
            'last_installment_adjusted' => $last !== $weekly,
            'installments_count' => $n,
            'installment_weekday' => $weekday,
            'first_installment_date' => $first->toDateString(),
            'final_due_date' => end($schedule)['due_date'],
            'processing_charges' => Money::s($processing),
            'additional_charges' => Money::s($additional),
            'net_disbursed' => Money::s($principal - $processing - $additional),
            'old_khata_outstanding' => Money::s(Money::p($in['old_khata_outstanding'] ?? 0)),
            'schedule' => $schedule,
        ];
    }

    /** Next date strictly after $from that falls on $weekday (0=Sunday … 6=Saturday). */
    public static function nextWeekday(Carbon $from, int $weekday): Carbon
    {
        $d = $from->copy()->addDay();
        while ($d->dayOfWeek !== $weekday) {
            $d->addDay();
        }
        return $d;
    }
}

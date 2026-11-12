import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, MessageCircle, Phone } from 'lucide-react'
import { mapsUrl, num, telUrl, waUrl } from '@/lib/format'
import { cn } from './ui'

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms)
    return () => clearTimeout(h)
  }, [value, ms])
  return v
}

export interface LoanCard {
  id: number
  khata_no: string
  customer_id: number
  weekly_amount: string
  principal_amount: string
  total_repayment: string
  total_paid: string
  remaining_loan: string
  remaining_installments: number
  net_due_now: string
  net_overdue: string
  today_due: string
  paid_today: string
  advance_balance: string
  penalty_outstanding: string
  old_khata_remaining: string
  total_outstanding: string
  payable_now: string
  next_due_date: string | null
  customer?: { id: number; name: string; mobile: string; photo_url?: string | null; village?: string | null; lat?: number | null; lng?: number | null; recovery_user_id?: number | null; recovery_name?: string | null }
  [k: string]: any
}

/** Display-only status derived from API-provided amounts (no financial calculation). */
export function loanStatus(c: LoanCard): 'overdue' | 'pending' | 'paid' | 'upcoming' {
  if (num(c.net_overdue) > 0) return 'overdue'
  if (num(c.net_due_now) > 0) return 'pending'
  if (num(c.paid_today) > 0) return 'paid'
  return 'upcoming'
}

export const statusBorder: Record<string, string> = {
  overdue: 'border-l-over',
  pending: 'border-l-pend',
  paid: 'border-l-ok',
  upcoming: 'border-l-slate-200',
}

/** Call / WhatsApp / Open location icon buttons. */
export function ContactButtons({ customer, className }: { customer?: LoanCard['customer']; className?: string }) {
  const { t } = useTranslation()
  if (!customer) return null
  const base = 'grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white'
  const map = mapsUrl(customer.lat, customer.lng)
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {customer.mobile && (
        <a href={telUrl(customer.mobile)} aria-label={t('call')} title={t('call')} className={cn(base, 'text-navy-800')}>
          <Phone className="h-[18px] w-[18px]" />
        </a>
      )}
      {customer.mobile && (
        <a href={waUrl(customer.mobile)} target="_blank" rel="noreferrer" aria-label={t('whatsapp')} title={t('whatsapp')} className={cn(base, 'text-ok')}>
          <MessageCircle className="h-[18px] w-[18px]" />
        </a>
      )}
      {map && (
        <a href={map} target="_blank" rel="noreferrer" aria-label={t('openMap')} title={t('openMap')} className={cn(base, 'text-over')}>
          <MapPin className="h-[18px] w-[18px]" />
        </a>
      )}
    </div>
  )
}

export function Metric({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'ok' | 'pend' | 'over' | 'adv' }) {
  const c = { ok: 'text-ok', pend: 'text-pend', over: 'text-over', adv: 'text-adv' }
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn('truncate text-[15px] font-bold tabular-nums text-slate-900', tone && c[tone])}>{children}</div>
    </div>
  )
}

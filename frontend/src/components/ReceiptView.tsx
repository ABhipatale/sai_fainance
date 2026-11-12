import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { fdate, money, num } from '@/lib/format'

export interface ReceiptData {
  finance?: { name?: string; address?: string; phone?: string; logo_url?: string | null }
  receipt_no: string
  status: string
  payment_date: string
  customer_name: string
  customer_mobile: string
  khata_no: string
  amount: string
  payment_type: string
  reference?: string | null
  installment_numbers: number[]
  breakdown: { installment: string; penalty: string; old_khata: string; advance: string }
  remaining_balance: string
  remaining_installments: number
  advance_balance: string
  collected_by?: string | null
  cash_location?: string | null
}

/** Route path for a receipt – use right after saving a payment. */
export const receiptPath = (paymentId: number | string) => `/receipt/${paymentId}`

const R = ({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) => (
  <div className="flex items-start justify-between gap-4 py-1.5 text-[13px]">
    <span className="text-slate-500">{k}</span>
    <span className={`text-right ${bold ? 'font-bold' : 'font-medium'} text-slate-900`}>{v}</span>
  </div>
)

/** The printable / PDF-able receipt. Rendered as plain DOM so the browser shapes Marathi/Hindi text correctly. */
const ReceiptView = forwardRef<HTMLDivElement, { r: ReceiptData }>(({ r }, ref) => {
  const { t } = useTranslation()
  const reversed = r.status === 'reversed'
  const parts: [string, string][] = [
    [t('receipt.installmentPart'), r.breakdown.installment],
    [t('receipt.penaltyPart'), r.breakdown.penalty],
    [t('receipt.oldKhataPart'), r.breakdown.old_khata],
    [t('receipt.advancePart'), r.breakdown.advance],
  ]
  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-card print:shadow-none">
      {reversed && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <span className="-rotate-25 rounded-xl border-4 border-over px-4 py-2 text-3xl font-black uppercase tracking-widest text-over/40">{t('receipt.reversed')}</span>
        </div>
      )}
      <div className="flex items-center gap-3 border-b-2 border-navy-800 pb-3">
        <img src={r.finance?.logo_url || '/icons/icon-192.png'} crossOrigin="anonymous" alt="" className="h-12 w-12 rounded-xl object-contain" />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold text-navy-900">{r.finance?.name || t('appName')}</div>
          {r.finance?.address && <div className="truncate text-xs text-slate-500">{r.finance.address}</div>}
          {r.finance?.phone && <div className="text-xs text-slate-500">{r.finance.phone}</div>}
        </div>
      </div>

      <div className="mt-3 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">{t('receipt.title')}</div>
        <div className="text-sm font-bold text-navy-800">{r.receipt_no}</div>
      </div>

      <div className="my-3 rounded-2xl bg-green-50 py-3 text-center">
        <div className="text-xs font-medium text-green-700">{t('receipt.amountReceived')}</div>
        <div className="text-3xl font-extrabold tabular-nums text-ok">{money(r.amount, { decimals: true })}</div>
      </div>

      <div className="divide-y divide-slate-100">
        <R k={t('receipt.customer')} v={r.customer_name} bold />
        <R k={t('mobile')} v={r.customer_mobile} />
        <R k={t('khataNo')} v={r.khata_no} />
        <R k={t('date')} v={fdate(r.payment_date)} />
        <R k={t('paymentType')} v={t(`payTypes.${r.payment_type}`, r.payment_type)} />
        {r.reference && <R k={t('reference')} v={r.reference} />}
        {r.installment_numbers.length > 0 && <R k={t('receipt.installmentNo')} v={`#${r.installment_numbers.join(', #')}`} />}
      </div>

      <div className="mt-2 rounded-xl bg-slate-50 px-3 py-1">
        {parts.filter(([, v]) => num(v) > 0).map(([k, v]) => (
          <R key={k} k={k} v={money(v, { decimals: true })} />
        ))}
      </div>

      <div className="mt-2 divide-y divide-slate-100">
        <R k={t('receipt.remainingBalance')} v={money(r.remaining_balance, { decimals: true })} bold />
        <R k={t('receipt.remainingInstallments')} v={r.remaining_installments} />
        {num(r.advance_balance) > 0 && <R k={t('receipt.advanceBalance')} v={money(r.advance_balance, { decimals: true })} />}
        <R k={t('receipt.collectedBy')} v={r.collected_by || '—'} />
        <R k={t('receipt.cashLocation')} v={r.cash_location || '—'} />
      </div>

      <div className="mt-4 border-t border-dashed border-slate-300 pt-3 text-center text-xs text-slate-400">{t('receipt.thanks')}</div>
    </div>
  )
})
ReceiptView.displayName = 'ReceiptView'
export default ReceiptView

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudOff, MessageCircle, Receipt as ReceiptIcon } from 'lucide-react'
import { ApiError, get, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { enqueuePayment, newKey } from '@/lib/offline'
import { fdate, money, num, todayISO, waUrl } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Badge, Button, ConfirmDialog, Field, Input, Segmented, SearchSelect, Select, Sheet, Textarea, errMsg } from './ui'
import type { LoanCard } from './FlowParts'

export type CollectMode = 'auto' | 'advance'

interface Props {
  open: boolean
  onClose: () => void
  loan: LoanCard | null
  mode?: CollectMode // 'advance' locks the sheet to advance deposits
  partial?: boolean // partial payment: amount starts empty
  onDone?: () => void
}

const Line = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="flex items-center justify-between py-1.5 text-sm">
    <span className="text-slate-600">{label}</span>
    <span className={`font-semibold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</span>
  </div>
)

/**
 * Payment bottom-sheet. The idempotency key is generated ONCE per opening of the sheet, so a double tap,
 * a retry after a timeout, or an offline replay can never create a second payment. Server is authoritative.
 */
export default function CollectSheet({ open, onClose, loan, mode: initialMode = 'auto', partial, onDone }: Props) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { session, can } = useAuth()
  const isRecovery = session?.user.role === 'recovery'
  const keyRef = useRef(newKey())
  const [mode, setMode] = useState<CollectMode>(initialMode)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<null | { id?: number; receipt?: any; offline?: boolean; amount: string }>(null)
  const payload = useRef<Record<string, any> | null>(null)

  const types = (session?.config.payment_types?.length ? session.config.payment_types : ['cash', 'upi', 'bank', 'other']) as ('cash' | 'upi' | 'bank' | 'other')[]

  const schema = useMemo(
    () =>
      z.object({
        amount: z.string().refine((v) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0, t('validation.positive')),
        payment_type: z.string().min(1, t('validation.required')),
        cash_location_id: z.union([z.string(), z.number()]).nullable().refine((v) => !!v, t('validation.required')),
        collected_by: z.union([z.string(), z.number()]).nullable().optional(),
        payment_date: z.string().min(1, t('validation.required')),
        reference: z.string().optional(),
        notes: z.string().optional(),
        penalty_amount: z.string().optional(),
        old_khata_amount: z.string().optional(),
      }),
    [t],
  )
  type FV = z.infer<typeof schema>
  const f = useForm<FV>({ resolver: zodResolver(schema) })

  const detail = useQuery({ queryKey: ['loan', loan?.id], queryFn: () => get(`/loan-accounts/${loan!.id}`), enabled: open && !!loan })
  const locs = useQuery({ queryKey: ['cash-locations', 'collection'], queryFn: () => get<any[]>('/cash-locations', { for: 'collection' }), enabled: open })
  const staff = useQuery({
    queryKey: ['users', 'recovery'],
    queryFn: () => get<any[]>('/users', { role: 'recovery' }),
    enabled: open && !isRecovery && can('recovery.view'),
  })

  // reset the form (and create a fresh idempotency key) every time the sheet opens
  useEffect(() => {
    if (!open || !loan) return
    keyRef.current = newKey()
    setMode(initialMode)
    setDone(null)
    setErr('')
    setConfirm(false)
    setBusy(false)
    const prefill = initialMode === 'auto' && !partial && num(loan.payable_now) > 0 ? String(num(loan.payable_now)) : ''
    f.reset({
      amount: prefill, payment_type: types[0] ?? 'cash', cash_location_id: null, collected_by: null, payment_date: todayISO(),
      reference: '', notes: '', penalty_amount: '', old_khata_amount: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loan?.id, initialMode, partial])

  // default cash location: the user's own, otherwise the only one available
  useEffect(() => {
    if (!open || !locs.data || f.getValues('cash_location_id')) return
    const own = locs.data.find((l) => l.id === session?.user.cash_location_id)
    const pick = own ?? (locs.data.length === 1 ? locs.data[0] : null)
    if (pick) f.setValue('cash_location_id', pick.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locs.data])

  if (!loan) return null
  const d = detail.data
  const installments: any[] = d?.installments ?? []
  const current = installments.find((i) => i.number === d?.current_installment_number)
  const openInst = installments.filter((i) => num(i.remaining_amount) > 0 && ['pending', 'overdue', 'partially_paid'].includes(i.status))
  const advanceMode = mode === 'advance'
  const watch = f.watch()
  const penOut = num(loan.penalty_outstanding)
  const oldOut = num(loan.old_khata_remaining)

  const submit = f.handleSubmit((v) => {
    setErr('')
    if (!advanceMode && num(v.penalty_amount) + num(v.old_khata_amount) > num(v.amount)) {
      f.setError('amount', { message: t('collection.sheet.partsExceed') })
      return
    }
    payload.current = {
      loan_account_id: loan.id,
      amount: v.amount,
      payment_type: v.payment_type,
      cash_location_id: v.cash_location_id,
      collected_by: isRecovery ? undefined : v.collected_by || undefined,
      payment_date: v.payment_date,
      reference: v.reference || undefined,
      notes: v.notes || undefined,
      mode,
      penalty_amount: !advanceMode && num(v.penalty_amount) > 0 ? v.penalty_amount : undefined,
      old_khata_amount: !advanceMode && num(v.old_khata_amount) > 0 ? v.old_khata_amount : undefined,
      idempotency_key: keyRef.current, // same key for every retry of THIS payment
    }
    setConfirm(true)
  })

  const send = async () => {
    if (busy || !payload.current) return
    setBusy(true)
    setErr('')
    const label = `${loan.customer?.name ?? ''} · ${loan.khata_no}`
    try {
      const res = await post('/payments', payload.current)
      setConfirm(false)
      setDone({ id: res.payment.id, receipt: res.receipt, amount: res.payment.amount })
      if (res.duplicate) toast.success(t('collection.sheet.duplicate'))
      ;['collection', 'pending', 'advance', 'dashboard', 'loan', 'customer', 'payments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      onDone?.()
    } catch (e) {
      setConfirm(false)
      if (e instanceof ApiError && e.network) {
        // no connection → keep it on the device; the server de-duplicates by key when it syncs
        await enqueuePayment(payload.current, label)
        setDone({ offline: true, amount: String(payload.current.amount) })
        onDone?.()
      } else {
        setErr(errMsg(e, t))
        if (e instanceof ApiError) {
          Object.entries(e.errors).forEach(([k, m]) => {
            if (k in f.getValues()) f.setError(k as keyof FV, { message: m[0] })
          })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const title = advanceMode ? t('collection.sheet.titleAdvance') : partial ? t('collection.sheet.titlePartial') : t('collection.sheet.title')
  const typeLabel = t(`payTypes.${watch.payment_type}`, String(watch.payment_type))
  const locName = locs.data?.find((l) => String(l.id) === String(watch.cash_location_id))?.name

  /* ------------------------------------------------------- success screen */
  if (done) {
    const r = done.receipt
    const text = r
      ? `${r.finance?.name ?? t('appName')}\n${t('receipt.receiptNo')}: ${r.receipt_no}\n${r.customer_name} · ${r.khata_no}\n${t('amount')}: ${money(r.amount)}\n${fdate(r.payment_date)}`
      : ''
    return (
      <Sheet open={open} onClose={onClose} title={title}>
        <div className="py-4 text-center">
          <div className={`mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full ${done.offline ? 'bg-orange-50 text-pend' : 'bg-green-50 text-ok'}`}>
            {done.offline ? <CloudOff className="h-8 w-8" /> : <CheckCircle2 className="h-9 w-9" />}
          </div>
          <div className="text-2xl font-bold tabular-nums text-navy-900">{money(done.amount)}</div>
          <div className="mt-1 font-semibold text-slate-800">{done.offline ? t('collection.sheet.savedOffline') : t('collection.sheet.saved')}</div>
          {done.offline && <p className="mt-2 text-sm text-slate-500">{t('collection.sheet.savedOfflineText')}</p>}
          {r && <Badge tone="navy" className="mt-3">{t('receipt.receiptNo')}: {r.receipt_no}</Badge>}
        </div>
        <div className="space-y-2 pb-2">
          {done.id && (
            <Button full size="lg" icon={<ReceiptIcon className="h-5 w-5" />} onClick={() => { onClose(); nav(`/receipt/${done.id}`) }}>
              {t('collection.sheet.viewReceipt')}
            </Button>
          )}
          {r?.customer_mobile && (
            <a href={waUrl(r.customer_mobile, text)} target="_blank" rel="noreferrer" className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-ok font-semibold text-white">
              <MessageCircle className="h-5 w-5" />
              {t('collection.sheet.shareWhatsApp')}
            </a>
          )}
          <Button variant="secondary" full onClick={onClose}>{t('collection.sheet.done')}</Button>
        </div>
      </Sheet>
    )
  }

  /* ------------------------------------------------------------- form */
  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        footer={<Button size="lg" full onClick={submit} variant={advanceMode ? 'primary' : 'success'}>{t('collection.sheet.save')}</Button>}
      >
        {/* who */}
        <div className="mb-3 rounded-2xl bg-navy-50 p-3">
          <div className="font-bold text-navy-900">{loan.customer?.name}</div>
          <div className="text-xs text-slate-600">{loan.khata_no} · {loan.customer?.mobile}</div>
        </div>

        {/* amounts – all straight from the API */}
        <div className="mb-4 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-3">
          {current && (
            <Line
              label={`${t('collection.sheet.currentInstallment')} #${current.number} (${fdate(current.due_date)})`}
              value={money(current.remaining_amount)}
            />
          )}
          {openInst.length > 1 && <Line label={t('collection.sheet.pendingInstallments')} value={String(openInst.length)} />}
          <Line label={t('collection.sheet.overdue')} value={money(loan.net_overdue)} tone={num(loan.net_overdue) > 0 ? 'text-over' : undefined} />
          <Line label={t('collection.sheet.advanceBalance')} value={money(loan.advance_balance)} tone={num(loan.advance_balance) > 0 ? 'text-adv' : undefined} />
          {oldOut > 0 && <Line label={t('collection.sheet.oldKhata')} value={money(loan.old_khata_remaining)} />}
          {penOut > 0 && <Line label={t('collection.sheet.penalty')} value={money(loan.penalty_outstanding)} tone="text-pend" />}
          <Line label={t('collection.sheet.payableNow')} value={money(loan.payable_now)} tone="text-navy-800 text-base" />
        </div>

        {!(initialMode === 'advance') && (
          <Segmented
            className="mb-4"
            value={mode}
            onChange={setMode}
            options={[{ value: 'auto', label: t('collection.sheet.modeAuto') }, { value: 'advance', label: t('collection.sheet.modeAdvance') }]}
          />
        )}

        <div className="space-y-4">
          <Field label={t('amount')} required error={f.formState.errors.amount?.message} hint={advanceMode ? t('collection.sheet.advanceHint') : t('collection.sheet.amountHint')}>
            <Input {...f.register('amount')} inputMode="decimal" placeholder="0" className="h-14 text-2xl font-bold tabular-nums" invalid={!!f.formState.errors.amount} />
          </Field>

          {!advanceMode && (penOut > 0 || oldOut > 0) && (
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3">
              {penOut > 0 && (
                <Field label={t('collection.sheet.penaltyPart')}>
                  <Input {...f.register('penalty_amount')} inputMode="decimal" placeholder="0" />
                  <button type="button" className="mt-1 text-xs font-semibold text-navy-600" onClick={() => f.setValue('penalty_amount', String(penOut))}>
                    {t('collection.sheet.fillFull')} {money(penOut)}
                  </button>
                </Field>
              )}
              {oldOut > 0 && (
                <Field label={t('collection.sheet.oldKhataPart')}>
                  <Input {...f.register('old_khata_amount')} inputMode="decimal" placeholder="0" />
                  <button type="button" className="mt-1 text-xs font-semibold text-navy-600" onClick={() => f.setValue('old_khata_amount', String(oldOut))}>
                    {t('collection.sheet.fillFull')} {money(oldOut)}
                  </button>
                </Field>
              )}
            </div>
          )}

          <Field label={t('paymentType')} required>
            <Select {...f.register('payment_type')}>
              {types.map((p) => (
                <option key={p} value={p}>{t(`payTypes.${p}`)}</option>
              ))}
            </Select>
          </Field>

          <Field label={t('collection.sheet.cashLocation')} required error={f.formState.errors.cash_location_id?.message as string | undefined} hint={locs.data && locs.data.length === 0 ? t('collection.sheet.noLocation') : undefined}>
            <SearchSelect
              options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name, sub: t(`cashTypes.${l.type}`) }))}
              value={watch.cash_location_id}
              onChange={(v) => f.setValue('cash_location_id', v, { shouldValidate: true })}
              invalid={!!f.formState.errors.cash_location_id}
            />
          </Field>

          {!isRecovery && can('recovery.view') && (
            <Field label={t('recoveryPerson')}>
              <SearchSelect
                clearable
                placeholder={t('collection.sheet.me')}
                options={(staff.data ?? []).filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: u.name }))}
                value={watch.collected_by}
                onChange={(v) => f.setValue('collected_by', v)}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('date')} required error={f.formState.errors.payment_date?.message}>
              <Input type="date" max={todayISO()} {...f.register('payment_date')} />
            </Field>
            <Field label={t('reference')}>
              <Input {...f.register('reference')} placeholder={t('optional')} />
            </Field>
          </div>
          <Field label={t('notes')}>
            <Textarea {...f.register('notes')} rows={2} placeholder={t('optional')} />
          </Field>
          {err && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-over">{err}</div>}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={send}
        loading={busy}
        title={t('collection.sheet.confirmTitle')}
        confirmLabel={t('collection.sheet.save')}
      >
        <div className="text-center">
          <div className="text-3xl font-bold tabular-nums text-navy-900">{money(watch.amount)}</div>
          <div className="mt-1 text-sm text-slate-600">{loan.customer?.name} · {loan.khata_no}</div>
        </div>
        <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 text-sm">
          <Line label={t('paymentType')} value={typeLabel} />
          <Line label={t('collection.sheet.cashLocation')} value={locName ?? '—'} />
          <Line label={t('date')} value={fdate(watch.payment_date)} />
          {advanceMode && <Line label={t('status.advanced_covered')} value={t('collection.sheet.modeAdvance')} tone="text-adv" />}
        </div>
        <p className="mt-3 text-sm text-slate-600">{t('collection.sheet.confirmText')}</p>
      </ConfirmDialog>
    </>
  )
}

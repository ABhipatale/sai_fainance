import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { Check, Plus, UserPlus } from 'lucide-react'
import { get, getPage, post, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, money, todayISO } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { useDebounce } from '@/components/useDebounce'
import GuarantorForm from '@/components/GuarantorForm'
import { Avatar, Button, Card, ConfirmDialog, EmptyState, Field, Input, ListSkeleton, PageHeader, Row, SearchInput, Select, Skeleton, StickyBar, Textarea, cn, errMsg } from '@/components/ui'

interface Vals {
  start_date: string; disbursement_date: string; principal_amount: string; total_repayment: string; installments_count: string
  weekly_amount: string; installment_weekday: string; first_installment_date: string; processing_charges: string
  additional_charges: string; old_khata_outstanding: string; notes: string; cash_location_id: string
}

export default function NewKhata() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [sp] = useSearchParams()
  const [step, setStep] = useState(sp.get('customer') ? 2 : 1)
  const [customerId, setCustomerId] = useState<number | null>(sp.get('customer') ? Number(sp.get('customer')) : null)
  const [g1, setG1] = useState('')
  const [g2, setG2] = useState('')
  const [gOpen, setGOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounce(q)

  const d = session?.config.loan_defaults ?? {}
  const f = useForm<Vals>({
    defaultValues: {
      start_date: todayISO(), disbursement_date: todayISO(), principal_amount: '', total_repayment: '',
      installments_count: String(d.installments_count ?? 10), weekly_amount: d.weekly_amount ? String(d.weekly_amount) : '',
      installment_weekday: String(d.installment_weekday ?? session?.config.collection_weekday ?? 2), first_installment_date: '',
      processing_charges: '', additional_charges: '', old_khata_outstanding: '', notes: '', cash_location_id: '',
    },
  })
  const { register, watch } = f
  const v = watch()

  const cust = useQuery({ queryKey: ['customer', String(customerId)], queryFn: () => get<any>(`/customers/${customerId}`), enabled: !!customerId })
  const results = useQuery({ queryKey: ['customers', 'pick', dq], queryFn: () => getPage('/customers', { q: dq || undefined, per_page: 12 }), enabled: step === 1 && !customerId })
  const gs = useQuery({ queryKey: ['guarantors', customerId], queryFn: () => get<any[]>(`/customers/${customerId}/guarantors`), enabled: !!customerId })
  const locs = useQuery({ queryKey: ['cash-locations', 'collection'], queryFn: () => get<any[]>('/cash-locations', { for: 'collection' }), enabled: step === 3 })

  const body = useMemo(() => {
    const o: Record<string, unknown> = {}
    ;(['principal_amount', 'total_repayment', 'installments_count', 'weekly_amount', 'installment_weekday', 'first_installment_date', 'disbursement_date', 'processing_charges', 'additional_charges', 'old_khata_outstanding'] as const).forEach((k) => { if (v[k] !== '') o[k] = v[k] })
    return o
  }, [v.principal_amount, v.total_repayment, v.installments_count, v.weekly_amount, v.installment_weekday, v.first_installment_date, v.disbursement_date, v.processing_charges, v.additional_charges, v.old_khata_outstanding]) // eslint-disable-line
  const dbody = useDebounce(body, 500)
  const ready = step === 3 && Number(dbody.principal_amount) > 0 && Number(dbody.total_repayment) > 0 && Number(dbody.installments_count) >= 1
  const prev = useQuery({ queryKey: ['loan-preview', dbody], queryFn: () => post<any>('/loan-accounts/preview', dbody), enabled: ready, retry: false })
  const P = prev.data
  const prevErr = prev.error instanceof ApiError ? prev.error.message : prev.error ? errMsg(prev.error, t) : ''

  useEffect(() => { if (g1 && g1 === g2) setG2('') }, [g1, g2])

  const create = useMutation({
    mutationFn: () => {
      const b: Record<string, unknown> = { ...body, customer_id: customerId, start_date: v.start_date || undefined, notes: v.notes || undefined, cash_location_id: v.cash_location_id || undefined, guarantor1_id: g1 || undefined, guarantor2_id: g2 || undefined }
      return post<any>('/loan-accounts', b)
    },
    onSuccess: (l) => { toast.success(t('khata.created')); nav(`/khata/${l.id}`, { replace: true }) },
    onError: (e) => { setConfirm(false); toast.error(errMsg(e, t)) },
  })

  const weekdays = t('weekdays', { returnObjects: true }) as unknown as string[]
  const steps = [t('khata.stepCustomer'), t('khata.stepGuarantors'), t('khata.stepLoan')]

  const addGuarantor = (g: { id: number }) => { if (!g1) setG1(String(g.id)); else if (!g2) setG2(String(g.id)) }

  return (
    <div>
      <PageHeader back title={t('nav.newKhata')} />
      <div className="mb-5 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold', step > i + 1 ? 'bg-ok text-white' : step === i + 1 ? 'bg-navy-800 text-white' : 'bg-slate-200 text-slate-500')}>{step > i + 1 ? <Check className="h-4 w-4" /> : i + 1}</div>
            <div className={cn('hidden text-sm font-semibold sm:block', step === i + 1 ? 'text-navy-900' : 'text-slate-400')}>{s}</div>
            {i < 2 && <div className="h-0.5 flex-1 bg-slate-200" />}
          </div>
        ))}
      </div>

      {/* ---------------- Step 1 ---------------- */}
      {step === 1 && (
        <div className="space-y-3">
          {customerId && cust.data ? (
            <Card className="flex items-center gap-3 p-4">
              <Avatar src={cust.data.photo_url} name={cust.data.name} size={52} />
              <div className="flex-1"><div className="font-bold">{cust.data.name}</div><div className="text-sm text-slate-500">{cust.data.mobile} • {cust.data.village}</div></div>
              <Button variant="secondary" size="sm" onClick={() => { setCustomerId(null); setG1(''); setG2('') }}>{t('khata.change')}</Button>
            </Card>
          ) : (
            <>
              <SearchInput value={q} onChange={setQ} autoFocus />
              {results.isLoading ? <ListSkeleton rows={3} h="h-20" /> : (results.data?.data ?? []).length === 0 ? <EmptyState title={t('customers.empty')} /> : (
                (results.data?.data ?? []).map((c: any) => (
                  <Card key={c.id} onClick={() => setCustomerId(c.id)} className="flex items-center gap-3 p-3">
                    <Avatar src={c.photo_url} name={c.name} />
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{c.name}</div><div className="text-xs text-slate-500">{c.mobile} • {c.village} • {c.active_khata} {t('customers.activeKhata')}</div></div>
                  </Card>
                ))
              )}
              <Link to="/customers/new" className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy-200 font-semibold text-navy-800"><UserPlus className="h-5 w-5" />{t('khata.newCustomer')}</Link>
            </>
          )}
        </div>
      )}

      {/* ---------------- Step 2 ---------------- */}
      {step === 2 && (
        <div className="space-y-4">
          {cust.data && <Card className="flex items-center gap-3 p-3"><Avatar src={cust.data.photo_url} name={cust.data.name} /><div><div className="font-bold">{cust.data.name}</div><div className="text-xs text-slate-500">{cust.data.mobile}</div></div></Card>}
          <p className="text-sm text-slate-500">{t('khata.guarantorsHint')}</p>
          {gs.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <>
              {([['1', g1, setG1], ['2', g2, setG2]] as const).map(([n, val, set]) => (
                <Field key={n} label={`${t('khata.guarantor')} ${n}`}>
                  <Select value={val} onChange={(e) => set(e.target.value)}>
                    <option value="">— {t('none')} —</option>
                    {(gs.data ?? []).filter((g) => String(g.id) !== (n === '1' ? g2 : g1)).map((g) => <option key={g.id} value={g.id}>{g.name} {g.mobile ? `(${g.mobile})` : ''}</option>)}
                  </Select>
                </Field>
              ))}
              <Button variant="secondary" full icon={<Plus className="h-5 w-5" />} onClick={() => setGOpen(true)} disabled={!!g1 && !!g2}>{t('customers.addGuarantor')}</Button>
            </>
          )}
          {customerId && <GuarantorForm open={gOpen} onClose={() => setGOpen(false)} customerId={customerId} onSaved={addGuarantor} />}
        </div>
      )}

      {/* ---------------- Step 3 ---------------- */}
      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('khata.startDate')}><Input type="date" {...register('start_date')} /></Field>
              <Field label={t('khata.disbursementDate')}><Input type="date" {...register('disbursement_date')} /></Field>
              <Field label={t('khata.principal')} required><Input {...register('principal_amount')} inputMode="decimal" /></Field>
              <Field label={t('khata.totalRepayment')} required><Input {...register('total_repayment')} inputMode="decimal" /></Field>
              <Field label={t('khata.installmentsCount')} required><Input {...register('installments_count')} inputMode="numeric" /></Field>
              <Field label={t('khata.weekly')} hint={t('khata.weeklyHint')}><Input {...register('weekly_amount')} inputMode="decimal" /></Field>
              <Field label={t('khata.weekday')}>
                <Select {...register('installment_weekday')}>{weekdays.map((w, i) => <option key={i} value={i}>{w}</option>)}</Select>
              </Field>
              <Field label={t('khata.firstInstallment')} hint={P ? `${t('khata.default')}: ${fdate(P.first_installment_date)}` : undefined}><Input type="date" {...register('first_installment_date')} /></Field>
              <Field label={t('khata.processing')}><Input {...register('processing_charges')} inputMode="decimal" /></Field>
              <Field label={t('khata.additional')}><Input {...register('additional_charges')} inputMode="decimal" /></Field>
            </div>
            <Field label={t('khata.oldKhata')} hint={t('khata.oldKhataHint')}><Input {...register('old_khata_outstanding')} inputMode="decimal" /></Field>
            <Field label={t('khata.disbursedFrom')} hint={t('khata.disbursedFromHint')}>
              <Select {...register('cash_location_id')}>
                <option value="">—</option>
                {(locs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label={t('notes')}><Textarea {...register('notes')} /></Field>
          </Card>

          <div className="space-y-3">
            <Card className="p-4">
              <h2 className="mb-2 font-bold text-navy-900">{t('khata.preview')}</h2>
              {!ready ? <p className="text-sm text-slate-500">{t('khata.previewHint')}</p> : prev.isFetching && !P ? <Skeleton className="h-40 w-full" /> : prevErr ? <p className="text-sm font-medium text-over">{prevErr}</p> : P && (
                <>
                  <Row label={t('khata.loanAmount')}>{money(P.principal_amount)}</Row>
                  <Row label={t('khata.totalRepayment')}><b>{money(P.total_repayment)}</b></Row>
                  <Row label={t('khata.financeCharges')}>{money(P.finance_charges)}</Row>
                  <Row label={t('khata.weekly')}><b className="text-navy-800">{money(P.weekly_amount)}</b></Row>
                  <Row label={t('khata.installmentsCount')}>{P.installments_count}</Row>
                  <Row label={t('khata.finalDue')}>{fdate(P.final_due_date)}</Row>
                  <Row label={t('khata.netDisbursed')}>{money(P.net_disbursed)}</Row>
                  {Number(P.old_khata_outstanding) > 0 && <Row label={t('khata.oldKhata')}>{money(P.old_khata_outstanding)}</Row>}
                  {P.last_installment_adjusted && <p className="mt-2 rounded-lg bg-orange-50 p-2 text-xs text-pend">{t('khata.lastAdjusted', { amount: money(P.last_installment_amount) })}</p>}
                </>
              )}
            </Card>
            {P && !prevErr && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-bold text-slate-600">{t('khata.schedule')}</h3>
                <div className="max-h-72 divide-y divide-slate-100 overflow-auto text-sm">
                  {P.schedule.map((s: any) => (
                    <div key={s.number} className="flex items-center justify-between py-2"><span className="text-slate-500">#{s.number}</span><span>{fdate(s.due_date)}</span><b className="tabular-nums">{money(s.amount)}</b></div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      <StickyBar>
        <div className="flex gap-3">
          {step > 1 && <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)}>{t('back')}</Button>}
          {step === 1 && <Button size="lg" full disabled={!customerId} onClick={() => setStep(2)}>{t('next')}</Button>}
          {step === 2 && <Button size="lg" full onClick={() => setStep(3)}>{g1 || g2 ? t('next') : t('khata.skipGuarantors')}</Button>}
          {step === 3 && <Button size="lg" full disabled={!P || !!prevErr} onClick={() => setConfirm(true)}>{t('khata.create')}</Button>}
        </div>
      </StickyBar>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => create.mutate()} loading={create.isPending}
        title={t('khata.confirmCreate')} confirmLabel={t('khata.create')}>
        {P && (
          <div className="text-sm">
            <Row label={t('customer')}>{cust.data?.name}</Row>
            <Row label={t('khata.loanAmount')}>{money(P.principal_amount)}</Row>
            <Row label={t('khata.totalRepayment')}>{money(P.total_repayment)}</Row>
            <Row label={t('khata.weekly')}>{money(P.weekly_amount)} × {P.installments_count}</Row>
            <Row label={t('khata.firstInstallment')}>{fdate(P.first_installment_date)}</Row>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}

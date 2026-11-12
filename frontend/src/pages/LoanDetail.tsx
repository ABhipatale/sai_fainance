import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Banknote, MapPin, Pencil, Phone, Plus, Receipt, ShieldAlert } from 'lucide-react'
import { get, post, put } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, mapsUrl, telUrl } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Avatar, Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, ListSkeleton, Money, PageHeader, Row, Select, Sheet, StatusBadge, Textarea, cn, errMsg } from '@/components/ui'

// shared payment sheet is owned by the collection screens (lazy so this page works even before it is opened)
const CollectSheet: any = lazy(() => import('@/components/CollectSheet').then((m: any) => ({ default: m.CollectSheet ?? m.default })))

type Dlg =
  | { kind: 'penalty'; edit?: any }
  | { kind: 'waive' | 'reverse'; p: any }
  | { kind: 'close' | 'refund' | 'edit' | 'collect' | 'collectPenalty' }
  | null

export default function LoanDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [dlg, setDlg] = useState<Dlg>(null)

  const q = useQuery({ queryKey: ['loan', id], queryFn: () => get<any>(`/loan-accounts/${id}`) })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['loan', id] })
    qc.invalidateQueries({ queryKey: ['customer'] })
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['penalties'] })
  }

  if (q.isLoading) return <ListSkeleton rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const l = q.data
  const active = l.status === 'active'
  const done = () => { setDlg(null); refresh() }

  return (
    <div>
      <PageHeader back title={l.khata_no} subtitle={l.customer?.name} actions={<StatusBadge status={l.status} />} />

      {l.customer && (
        <Card className="mb-4 flex items-center gap-3 p-3">
          <Avatar src={l.customer.photo_url} name={l.customer.name} />
          <Link to={`/customers/${l.customer.id}`} className="min-w-0 flex-1"><div className="truncate font-bold text-navy-900">{l.customer.name}</div><div className="text-xs text-slate-500">{l.customer.mobile} • {l.customer.village}</div></Link>
          <a href={telUrl(l.customer.mobile)} className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy-800"><Phone className="h-5 w-5" /></a>
          {mapsUrl(l.customer.lat, l.customer.lng) && <a href={mapsUrl(l.customer.lat, l.customer.lng)} target="_blank" rel="noreferrer" className="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-pend"><MapPin className="h-5 w-5" /></a>}
        </Card>
      )}

      {active && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {can('payments.collect') && <Button size="lg" variant="success" icon={<Banknote className="h-5 w-5" />} onClick={() => setDlg({ kind: 'collect' })}>{t('khata.collect')}</Button>}
          {can('penalties.create') && <Button size="lg" variant="warn" icon={<ShieldAlert className="h-5 w-5" />} onClick={() => setDlg({ kind: 'penalty' })}>{t('penalties.add')}</Button>}
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-1 font-bold text-navy-900">{t('khata.summary')}</h2>
          <Row label={t('khata.principal')}><Money v={l.principal_amount} /></Row>
          <Row label={t('khata.totalRepayment')}><Money v={l.total_repayment} /></Row>
          <Row label={t('khata.financeCharges')}><Money v={l.finance_charges} /></Row>
          <Row label={t('khata.weekly')}><Money v={l.weekly_amount} /></Row>
          <Row label={t('khata.installmentsCount')}>{l.installments_count} ({t('khata.paidCount')}: {l.paid_installments})</Row>
          <Row label={t('khata.disbursementDate')}>{fdate(l.disbursement_date)}</Row>
          <Row label={t('khata.nextDue')}>{fdate(l.next_due_date)}</Row>
          {(Number(l.processing_charges) > 0 || Number(l.additional_charges) > 0) && <Row label={t('khata.processing')}><Money v={l.processing_charges} /> / <Money v={l.additional_charges} /></Row>}
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-bold text-navy-900">{t('khata.position')}</h2>
          <Row label={t('khata.totalPaid')}><Money v={l.total_paid} tone="ok" /></Row>
          <Row label={t('khata.remainingLoan')}><Money v={l.remaining_loan} /></Row>
          <Row label={t('khata.remainingInstallments')}>{l.remaining_installments}</Row>
          <Row label={t('khata.pendingNow')}><Money v={l.net_due_now} tone="pend" /></Row>
          <Row label={t('khata.overdue')}><Money v={l.net_overdue} tone="over" /></Row>
          <Row label={t('advance')}><Money v={l.advance_balance} tone="adv" /></Row>
          <Row label={t('khata.penaltyOutstanding')}><Money v={l.penalty_outstanding} tone="over" /></Row>
          <Row label={t('khata.oldKhataRemaining')}><Money v={l.old_khata_remaining} />{Number(l.old_khata_outstanding) > 0 && <span className="text-xs text-slate-400"> / <Money v={l.old_khata_outstanding} /></span>}</Row>
          <Row label={t('khata.totalOutstanding')} className="border-t border-slate-100 text-base"><Money v={l.total_outstanding} className="text-lg font-bold" /></Row>
        </Card>
      </div>

      <h2 className="mb-2 font-bold text-navy-900">{t('khata.schedule')}</h2>
      <div className="mb-5 space-y-2 md:hidden">
        {l.installments.map((i: any) => (
          <Card key={i.id} className={cn('p-3', i.number === l.current_installment_number && 'ring-2 ring-navy-200')}>
            <div className="flex items-center justify-between"><b>#{i.number}</b><span className="text-sm text-slate-500">{fdate(i.due_date)}</span><StatusBadge status={i.status} /></div>
            <div className="mt-2 grid grid-cols-3 text-xs">
              <div><div className="text-slate-400">{t('khata.expected')}</div><Money v={i.expected_amount} /></div>
              <div><div className="text-slate-400">{t('paid')}</div><Money v={i.paid_amount} tone="ok" /></div>
              <div><div className="text-slate-400">{t('remaining')}</div><Money v={i.remaining_amount} tone={Number(i.remaining_amount) > 0 ? 'pend' : undefined} /></div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="mb-5 hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">#</th><th>{t('khata.dueDate')}</th><th className="text-right">{t('khata.expected')}</th><th className="text-right">{t('paid')}</th><th className="text-right">{t('remaining')}</th><th className="text-right">{t('advance')}</th><th className="pr-3 text-right">{t('status')}</th></tr></thead>
          <tbody>
            {l.installments.map((i: any) => (
              <tr key={i.id} className={cn('border-t border-slate-100', i.number === l.current_installment_number && 'bg-navy-50/50')}>
                <td className="p-3 font-semibold">{i.number}</td><td>{fdate(i.due_date)}</td>
                <td className="text-right"><Money v={i.expected_amount} /></td><td className="text-right"><Money v={i.paid_amount} tone="ok" /></td>
                <td className="text-right"><Money v={i.remaining_amount} /></td><td className="text-right"><Money v={i.advance_applied} tone="adv" /></td>
                <td className="pr-3 text-right"><StatusBadge status={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* penalties */}
      <div className="mb-2 flex items-center justify-between"><h2 className="font-bold text-navy-900">{t('penalties.title')}</h2>
        {active && Number(l.penalty_outstanding) > 0 && can('payments.collect') && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'collectPenalty' })}>{t('penalties.collect')}</Button>}
      </div>
      {l.penalties.length === 0 ? <p className="mb-5 text-sm text-slate-500">{t('penalties.none')}</p> : (
        <div className="mb-5 space-y-2">
          {l.penalties.map((p: any) => <PenaltyRow key={p.id} p={p} onAction={(kind) => setDlg({ kind, p, edit: p } as any)} />)}
        </div>
      )}

      {/* guarantors */}
      <h2 className="mb-2 font-bold text-navy-900">{t('customers.guarantors')}</h2>
      {l.guarantors.length === 0 ? <p className="mb-5 text-sm text-slate-500">{t('customers.noGuarantors')}</p> : (
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {l.guarantors.map((g: any) => (
            <Card key={g.id} className="flex items-center gap-3 p-3">
              <Avatar src={g.photo_url} name={g.name} />
              <div className="min-w-0 flex-1 text-sm"><div className="font-semibold">{g.name}</div><div className="text-xs text-slate-500">{g.mobile} • {g.village}</div></div>
              {g.mobile && <a href={telUrl(g.mobile)} className="grid h-9 w-9 place-items-center rounded-lg bg-navy-50 text-navy-800"><Phone className="h-4 w-4" /></a>}
              {mapsUrl(g.lat, g.lng) && <a href={mapsUrl(g.lat, g.lng)} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-lg bg-orange-50 text-pend"><MapPin className="h-4 w-4" /></a>}
            </Card>
          ))}
        </div>
      )}

      {/* payments */}
      <h2 className="mb-2 font-bold text-navy-900">{t('customers.payments')}</h2>
      {l.payments.length === 0 ? <p className="mb-5 text-sm text-slate-500">{t('customers.noPayments')}</p> : (
        <div className="mb-5 space-y-2">
          {l.payments.map((p: any) => (
            <Link key={p.id} to={`/receipt/${p.id}`}>
              <Card className="mb-2 flex items-center gap-3 p-3">
                <Receipt className="h-5 w-5 text-navy-600" />
                <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{p.receipt_no}</div><div className="text-xs text-slate-500">{fdate(p.payment_date)} • {t(`payTypes.${p.payment_type}`)} • {p.collector_name}</div></div>
                <div className="text-right"><Money v={p.amount} className="font-bold" />{p.status === 'reversed' && <div><StatusBadge status="reversed" /></div>}</div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {l.notes && <Card className="mb-5 p-4 text-sm"><div className="mb-1 text-xs font-medium text-slate-500">{t('notes')}</div>{l.notes}</Card>}

      <div className="flex flex-wrap gap-2">
        {can('loans.update') && active && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setDlg({ kind: 'edit' })}>{t('khata.editKhata')}</Button>}
        {can('advance.refund') && active && Number(l.advance_balance) > 0 && <Button variant="secondary" onClick={() => setDlg({ kind: 'refund' })}>{t('khata.refundAdvance')}</Button>}
        {can('loans.close') && active && <Button variant="danger" onClick={() => setDlg({ kind: 'close' })}>{t('khata.closeKhata')}</Button>}
      </div>
      {l.status === 'closed' && <Card className="mt-4 p-4 text-sm"><Badge tone="gray">{t('status.closed')}</Badge> {fdate(l.closed_at)} — {t(`khata.closeType.${l.close_type}`, l.close_type ?? '')} {l.close_note && `• ${l.close_note}`}</Card>}

      {/* dialogs */}
      {dlg?.kind === 'penalty' && <PenaltyDialog loan={l} edit={dlg.edit} onClose={() => setDlg(null)} onDone={done} />}
      {dlg && (dlg.kind === 'waive' || dlg.kind === 'reverse') && <ReasonDialog kind={dlg.kind} p={dlg.p} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'close' && <CloseDialog loan={l} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'refund' && <RefundDialog loan={l} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'edit' && <EditDialog loan={l} onClose={() => setDlg(null)} onDone={done} />}
      {(dlg?.kind === 'collect' || dlg?.kind === 'collectPenalty') && (
        <Suspense fallback={null}>
          <CollectSheet open onClose={() => setDlg(null)} loan={l} onDone={done} initialMode={dlg.kind === 'collectPenalty' ? 'penalty' : undefined} />
        </Suspense>
      )}
    </div>
  )

  function PenaltyRow({ p, onAction }: { p: any; onAction: (k: 'penalty' | 'waive' | 'reverse') => void }) {
    const open = p.status === 'open' && Number(p.paid_amount) === 0
    return (
      <Card className="p-3">
        <div className="flex items-center justify-between"><div className="text-sm font-semibold">{p.installment_number ? `#${p.installment_number} • ` : ''}{fdate(p.penalty_date)}</div><StatusBadge status={p.status} /></div>
        <div className="mt-1 text-xs text-slate-500">{p.reason}</div>
        <div className="mt-2 grid grid-cols-3 text-xs"><div><div className="text-slate-400">{t('amount')}</div><Money v={p.amount} /></div><div><div className="text-slate-400">{t('paid')}</div><Money v={p.paid_amount} tone="ok" /></div><div><div className="text-slate-400">{t('remaining')}</div><Money v={p.outstanding} tone="over" /></div></div>
        {Number(p.outstanding) > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {open && can('penalties.update') && <Button size="sm" variant="secondary" onClick={() => onAction('penalty')}>{t('edit')}</Button>}
            {can('penalties.waive') && <Button size="sm" variant="secondary" onClick={() => onAction('waive')}>{t('penalties.waive')}</Button>}
            {open && can('penalties.reverse') && <Button size="sm" variant="secondary" onClick={() => onAction('reverse')}>{t('penalties.reverse')}</Button>}
          </div>
        )}
      </Card>
    )
  }
}

/* ------------------------------------------------------------------ dialogs */
function useAct(fn: () => Promise<unknown>, onDone: () => void, ok: string) {
  const { t } = useTranslation()
  const toast = useToast()
  return useMutation({ mutationFn: fn, onSuccess: () => { toast.success(ok || t('success')); onDone() }, onError: (e) => toast.error(errMsg(e, t)) })
}

function PenaltyDialog({ loan, edit, onClose, onDone }: { loan: any; edit?: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [num, setNum] = useState(edit?.installment_number ? String(edit.installment_number) : '')
  const [amount, setAmount] = useState(edit?.amount ?? '')
  const [date, setDate] = useState(edit?.penalty_date ?? new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState(edit?.reason ?? '')
  const m = useAct(() => edit
    ? put(`/penalties/${edit.id}`, { amount, penalty_date: date, reason })
    : post('/penalties', { loan_account_id: loan.id, installment_number: num || undefined, amount, penalty_date: date, reason: reason || undefined }), onDone, t('penalties.saved'))
  return (
    <Sheet open onClose={onClose} title={edit ? t('penalties.edit') : t('penalties.add')} footer={<div className="flex gap-3 pb-1"><Button variant="secondary" full onClick={onClose}>{t('cancel')}</Button><Button full loading={m.isPending} disabled={!(Number(amount) > 0)} onClick={() => m.mutate()}>{t('save')}</Button></div>}>
      <div className="space-y-3">
        {!edit && (
          <Field label={t('penalties.installmentNo')}>
            <Select value={num} onChange={(e) => setNum(e.target.value)}>
              <option value="">—</option>
              {loan.installments.map((i: any) => <option key={i.number} value={i.number}>#{i.number} — {fdate(i.due_date)}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('amount')} required hint={t('penalties.manualHint')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('date')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('reason')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}

export function ReasonDialog({ kind, p, onClose, onDone }: { kind: 'waive' | 'reverse'; p: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const m = useAct(() => post(`/penalties/${p.id}/${kind}`, { reason }), onDone, t('penalties.saved'))
  return (
    <ConfirmDialog open onClose={onClose} danger onConfirm={() => reason.trim().length >= 3 && m.mutate()} loading={m.isPending}
      title={kind === 'waive' ? t('penalties.waive') : t('penalties.reverse')} confirmLabel={kind === 'waive' ? t('penalties.waive') : t('penalties.reverse')}
      message={`${t('penalties.title')}: ₹${p.outstanding}`}>
      <Field label={t('reason')} required className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </ConfirmDialog>
  )
}

function useLocs() {
  return useQuery({ queryKey: ['cash-locations', 'collection'], queryFn: () => get<any[]>('/cash-locations', { for: 'collection' }) })
}

function CloseDialog({ loan, onClose, onDone }: { loan: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const locs = useLocs()
  const [settlement, setSettlement] = useState(false)
  const [note, setNote] = useState('')
  const [loc, setLoc] = useState('')
  const needsSettlement = !loan.can_close
  const m = useAct(() => post(`/loan-accounts/${loan.id}/close`, { settlement: needsSettlement ? settlement : false, note: note || undefined, refund_location_id: loc || undefined }), onDone, t('khata.closedOk'))
  const isAdmin = session?.user.role === 'admin'
  return (
    <ConfirmDialog open onClose={onClose} danger onConfirm={() => m.mutate()} loading={m.isPending} title={t('khata.closeKhata')} confirmLabel={t('khata.closeKhata')}
      message={needsSettlement ? t('khata.closeOutstanding') : t('khata.closeConfirm')}>
      <div className="mt-3 space-y-3">
        {needsSettlement && (isAdmin ? (
          <label className="flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={settlement} onChange={(e) => setSettlement(e.target.checked)} /><span>{t('khata.settlement')}</span></label>
        ) : <p className="rounded-xl bg-red-50 p-3 text-sm text-over">{t('khata.settlementAdminOnly')}</p>)}
        {Number(loan.advance_balance) > 0 && (
          <Field label={t('khata.refundFrom')} required hint={t('khata.refundHint', { amount: loan.advance_balance })}>
            <Select value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">{t('select')}</option>{(locs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          </Field>
        )}
        <Field label={t('notes')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </ConfirmDialog>
  )
}

function RefundDialog({ loan, onClose, onDone }: { loan: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const locs = useLocs()
  const [amount, setAmount] = useState(loan.advance_balance)
  const [loc, setLoc] = useState('')
  const m = useAct(() => post(`/loan-accounts/${loan.id}/advance-refund`, { amount, cash_location_id: loc }), onDone, t('khata.refunded'))
  return (
    <ConfirmDialog open onClose={onClose} onConfirm={() => loc && m.mutate()} loading={m.isPending} title={t('khata.refundAdvance')}>
      <div className="space-y-3">
        <Field label={t('amount')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('khata.refundFrom')} required><Select value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">{t('select')}</option>{(locs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      </div>
    </ConfirmDialog>
  )
}

function EditDialog({ loan, onClose, onDone }: { loan: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const gs = useQuery({ queryKey: ['guarantors', loan.customer_id], queryFn: () => get<any[]>(`/customers/${loan.customer_id}/guarantors`) })
  const [notes, setNotes] = useState(loan.notes ?? '')
  const [g1, setG1] = useState(loan.guarantor1_id ? String(loan.guarantor1_id) : '')
  const [g2, setG2] = useState(loan.guarantor2_id ? String(loan.guarantor2_id) : '')
  const m = useAct(() => put(`/loan-accounts/${loan.id}`, { notes, guarantor1_id: g1 || null, guarantor2_id: g2 || null }), onDone, t('success'))
  const opt = (exclude: string): ReactNode => (gs.data ?? []).filter((g) => String(g.id) !== exclude).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)
  return (
    <Sheet open onClose={onClose} title={t('khata.editKhata')} footer={<div className="flex gap-3 pb-1"><Button variant="secondary" full onClick={onClose}>{t('cancel')}</Button><Button full loading={m.isPending} onClick={() => m.mutate()}>{t('save')}</Button></div>}>
      <div className="space-y-3">
        <Field label={`${t('khata.guarantor')} 1`}><Select value={g1} onChange={(e) => setG1(e.target.value)}><option value="">—</option>{opt(g2)}</Select></Field>
        <Field label={`${t('khata.guarantor')} 2`}><Select value={g2} onChange={(e) => setG2(e.target.value)}><option value="">—</option>{opt(g1)}</Select></Field>
        <Field label={t('notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-xs text-slate-500"><Plus className="mr-1 inline h-3 w-3" />{t('khata.editHint')}</p>
      </div>
    </Sheet>
  )
}

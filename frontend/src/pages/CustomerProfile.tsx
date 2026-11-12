import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FilePlus2, MapPin, MessageCircle, Pencil, Phone, Plus, Receipt } from 'lucide-react'
import { get, getPage, post, fetchBlobUrl } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, mapsUrl, telUrl, waUrl } from '@/lib/format'
import { useToast } from '@/lib/toast'
import GuarantorForm, { type GuarantorData } from '@/components/GuarantorForm'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, Money, PageHeader, Pagination, Row, Select, Sheet, StatCard, StatusBadge, Tabs, errMsg } from '@/components/ui'

type Tab = 'khata' | 'ledger' | 'advance' | 'payments' | 'guarantors' | 'documents'

export default function CustomerProfile() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('khata')

  const q = useQuery({ queryKey: ['customer', id], queryFn: () => get<any>(`/customers/${id}`) })
  const staff = useQuery({ queryKey: ['staff-list'], queryFn: () => get<any[]>('/users', { role: 'recovery' }), enabled: can('recovery.assign') })
  const assign = useMutation({
    mutationFn: (rid: string) => post(`/customers/${id}/assign`, { recovery_user_id: rid ? Number(rid) : null }),
    onSuccess: () => { toast.success(t('success')); qc.invalidateQueries({ queryKey: ['customer', id] }) },
    onError: (e) => toast.error(errMsg(e, t)),
  })

  if (q.isLoading) return <ListSkeleton rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const c = q.data
  const tot = c.totals

  const tabs: { value: Tab; label: string }[] = [
    { value: 'khata', label: t('khata.title') },
    { value: 'ledger', label: t('customers.ledger') },
    { value: 'advance', label: t('advance') },
    { value: 'payments', label: t('customers.payments') },
    { value: 'guarantors', label: t('customers.guarantors') },
    ...(c.documents_visible ? [{ value: 'documents' as Tab, label: t('customers.documents') }] : []),
  ]

  return (
    <div>
      <PageHeader back="/customers" title={c.name} actions={can('customers.update') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => nav(`/customers/${id}/edit`)}>{t('edit')}</Button>} />

      <Card className="mb-4 p-4">
        <div className="flex gap-4">
          <Avatar src={c.photo_url} name={c.name} size={76} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="text-lg font-bold text-navy-900">{c.name}</div>
            <div className="text-slate-600">{c.mobile}{c.alt_mobile ? ` / ${c.alt_mobile}` : ''}</div>
            <div className="text-slate-500">{c.occupation}</div>
            <div className="mt-1 text-slate-600">{[c.address, c.village, c.taluka, c.district, c.state, c.pincode].filter(Boolean).join(', ')}</div>
            {c.recovery_name && <Badge tone="navy" className="mt-2">{t('recoveryPerson')}: {c.recovery_name}</Badge>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <a href={telUrl(c.mobile)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-navy-50 text-sm font-semibold text-navy-800"><Phone className="h-4 w-4" />{t('call')}</a>
          <a href={waUrl(c.mobile)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-green-50 text-sm font-semibold text-ok"><MessageCircle className="h-4 w-4" />{t('whatsapp')}</a>
          {mapsUrl(c.lat, c.lng) && <a href={mapsUrl(c.lat, c.lng)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-orange-50 text-sm font-semibold text-pend"><MapPin className="h-4 w-4" />{t('openMap')}</a>}
        </div>
        {can('recovery.assign') && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-slate-500">{t('customers.assignRecovery')}</div>
            <Select value={c.recovery_user_id ?? ''} onChange={(e) => assign.mutate(e.target.value)} disabled={assign.isPending}>
              <option value="">—</option>
              {(staff.data ?? []).filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('customers.activeKhata')} value={tot.active_khata} sub={`${t('status.closed')}: ${tot.closed_khata}`} />
        <StatCard label={t('customers.totalLoan')} value={<Money v={tot.total_loan_amount} />} />
        <StatCard label={t('customers.totalCollected')} value={<Money v={tot.total_collected} />} tone="ok" />
        <StatCard label={t('customers.totalPending')} value={<Money v={tot.total_pending} />} tone="pend" />
        <StatCard label={t('advance')} value={<Money v={tot.advance_balance} />} tone="adv" />
        <StatCard label={t('penalty')} value={<Money v={tot.penalty_outstanding} />} tone="over" />
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'khata' && (
        <div className="space-y-3">
          {can('loans.create') && <Button full variant="secondary" icon={<FilePlus2 className="h-5 w-5" />} onClick={() => nav(`/khata/new?customer=${id}`)}>{t('customers.newKhata')}</Button>}
          {c.loans.length === 0 ? <EmptyState title={t('customers.noKhata')} /> : c.loans.map((l: any) => (
            <Link key={l.id} to={`/khata/${l.id}`}>
              <Card className="mb-3 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-navy-900">{l.khata_no}</div>
                  <StatusBadge status={l.status} />
                </div>
                <div className="mt-1 text-xs text-slate-500">{fdate(l.disbursement_date)} • {l.installments_count} {t('week')} • {t('khata.weekly')} <Money v={l.weekly_amount} /></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{t('khata.principal')}</div><Money v={l.principal_amount} className="font-bold" /></div>
                  <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{t('khata.remainingInstallments')}</div><b>{l.remaining_installments}</b></div>
                  <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{t('khata.totalOutstanding')}</div><Money v={l.total_outstanding} tone={Number(l.total_outstanding) > 0 ? 'pend' : 'ok'} className="font-bold" /></div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {tab === 'ledger' && <LedgerTab url={`/customers/${id}/ledger`} kind="ledger" />}
      {tab === 'advance' && <LedgerTab url={`/customers/${id}/advance-ledger`} kind="advance" />}
      {tab === 'payments' && (
        c.recent_payments.length === 0 ? <EmptyState title={t('customers.noPayments')} /> : (
          <div className="space-y-2">
            {c.recent_payments.map((p: any) => (
              <Link key={p.id} to={`/receipt/${p.id}`}>
                <Card className="mb-2 flex items-center gap-3 p-3">
                  <Receipt className="h-5 w-5 text-navy-600" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{p.receipt_no} <span className="font-normal text-slate-500">• {p.khata_no}</span></div>
                    <div className="text-xs text-slate-500">{fdate(p.payment_date)} • {t(`payTypes.${p.payment_type}`)} • {p.location_name}</div>
                  </div>
                  <div className="text-right"><Money v={p.amount} className="font-bold" />{p.status === 'reversed' && <div><StatusBadge status="reversed" /></div>}</div>
                </Card>
              </Link>
            ))}
          </div>
        )
      )}
      {tab === 'guarantors' && <GuarantorsTab customerId={c.id} list={c.guarantors} canEdit={can('customers.update')} />}
      {tab === 'documents' && <DocumentsTab c={c} />}
    </div>
  )
}

function LedgerTab({ url, kind }: { url: string; kind: 'ledger' | 'advance' }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['ledger', url, page], queryFn: () => getPage(url, { page }), placeholderData: (p) => p })
  if (q.isLoading) return <ListSkeleton rows={5} h="h-16" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const rows = q.data!.data
  if (!rows.length) return <EmptyState />
  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((r: any) => (
          <Card key={r.id} className="p-3 text-sm">
            <div className="flex justify-between"><b>{t(`ledgerTypes.${r.type}`, { defaultValue: r.type })}</b><span className="text-xs text-slate-500">{fdate(r.date)}</span></div>
            <div className="mt-1 text-xs text-slate-500">{r.description}</div>
            <div className="mt-2 grid grid-cols-3 text-xs">
              <div><div className="text-slate-400">{kind === 'ledger' ? t('customers.debit') : t('customers.credit')}</div><Money v={kind === 'ledger' ? r.debit : r.credit} decimals /></div>
              <div><div className="text-slate-400">{kind === 'ledger' ? t('customers.credit') : t('customers.debit')}</div><Money v={kind === 'ledger' ? r.credit : r.debit} decimals /></div>
              <div><div className="text-slate-400">{t('customers.balance')}</div><Money v={r.balance} decimals className="font-bold" /></div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="p-3">{t('date')}</th><th>{t('customers.type')}</th><th>{t('khata.title')}</th>
              <th className="text-right">{kind === 'ledger' ? t('customers.debit') : t('customers.credit')}</th><th className="text-right">{kind === 'ledger' ? t('customers.credit') : t('customers.debit')}</th>
              <th className="text-right">{t('customers.balance')}</th><th className="pl-4">{t('customers.description')}</th><th>{t('createdBy')}</th></tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3">{fdate(r.date)}</td><td>{t(`ledgerTypes.${r.type}`, { defaultValue: r.type })}</td><td>{r.khata_no}</td>
                <td className="text-right"><Money v={kind === 'ledger' ? r.debit : r.credit} decimals /></td>
                <td className="text-right"><Money v={kind === 'ledger' ? r.credit : r.debit} decimals /></td>
                <td className="text-right font-semibold"><Money v={r.balance} decimals /></td>
                <td className="max-w-xs truncate pl-4 text-slate-500">{r.description}</td><td>{r.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Pagination page={q.data!.meta.page} last={q.data!.meta.last_page} onPage={setPage} />
    </>
  )
}

function GuarantorsTab({ customerId, list, canEdit }: { customerId: number; list: GuarantorData[]; canEdit: boolean }) {
  const { t } = useTranslation()
  const [edit, setEdit] = useState<GuarantorData | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      {canEdit && <Button full variant="secondary" icon={<Plus className="h-5 w-5" />} onClick={() => { setEdit(null); setOpen(true) }}>{t('customers.addGuarantor')}</Button>}
      {list.length === 0 && <EmptyState title={t('customers.noGuarantors')} />}
      {list.map((g) => (
        <Card key={g.id} className="p-4">
          <div className="flex gap-3">
            <Avatar src={g.photo_url} name={g.name} size={52} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-bold">{g.name}</div>
              <div className="text-slate-500">{g.mobile}</div>
              <div className="text-slate-600">{[g.address, g.village, g.taluka, g.district].filter(Boolean).join(', ')}</div>
              {g.aadhaar_no && <div className="text-xs text-slate-500">{t('customers.aadhaarNo')}: {g.aadhaar_no}</div>}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {g.mobile && <a href={telUrl(g.mobile)} className="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-navy-50 text-sm font-semibold text-navy-800"><Phone className="h-4 w-4" />{t('call')}</a>}
            {mapsUrl(g.lat, g.lng) && <a href={mapsUrl(g.lat, g.lng)} target="_blank" rel="noreferrer" className="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-orange-50 text-sm font-semibold text-pend"><MapPin className="h-4 w-4" />{t('openMap')}</a>}
            {canEdit && <Button variant="secondary" size="sm" className="h-10" onClick={() => { setEdit(g); setOpen(true) }} icon={<Pencil className="h-4 w-4" />} />}
          </div>
        </Card>
      ))}
      <GuarantorForm open={open} onClose={() => setOpen(false)} customerId={customerId} guarantor={edit} />
    </div>
  )
}

function DocumentsTab({ c }: { c: any }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [img, setImg] = useState<string | null>(null)
  const view = async (type: 'aadhaar' | 'pan') => {
    try { setImg(await fetchBlobUrl(`/customers/${c.id}/documents/${type}`)) } catch (e) { toast.error(errMsg(e, t)) }
  }
  return (
    <Card className="p-4">
      <Row label={t('customers.aadhaarNo')}>{c.aadhaar_no || '—'}</Row>
      {c.has_aadhaar_photo && <Button variant="secondary" size="sm" onClick={() => view('aadhaar')}>{t('customers.viewAadhaarPhoto')}</Button>}
      <Row label={t('customers.panNo')}>{c.pan_no || '—'}</Row>
      {c.has_pan_photo && <Button variant="secondary" size="sm" onClick={() => view('pan')}>{t('customers.viewPanPhoto')}</Button>}
      <Sheet open={!!img} onClose={() => setImg(null)} title={t('customers.documents')} wide>
        {img && <img src={img} alt="" className="mx-auto max-h-[70vh] rounded-xl" />}
      </Sheet>
    </Card>
  )
}

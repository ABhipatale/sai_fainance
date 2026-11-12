import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Banknote, BarChart3, CalendarDays, CalendarRange, CheckCircle2, Clock, Download, FileSpreadsheet, FileText, Landmark, Printer, Receipt, ShieldAlert, UserCog, Users, Wallet, ArrowLeftRight, AlertTriangle, BookOpen,
} from 'lucide-react'
import { download, get } from '@/lib/api'
import { fdate, money, todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageHeader, Segmented, Select, Badge, errMsg } from '@/components/ui'
import CustomerPicker, { type PickedCustomer } from '@/components/admin/CustomerPicker'

type F = 'date' | 'range' | 'customer' | 'collected_by' | 'cash_location_id' | 'payment_type'
const REPORTS: { key: string; icon: typeof BarChart3; f: F[]; defaults?: 'week' | 'month' | 'today' }[] = [
  { key: 'daily-collection', icon: CalendarDays, f: ['date', 'customer', 'collected_by', 'cash_location_id', 'payment_type'] },
  { key: 'weekly-collection', icon: CalendarRange, f: ['range', 'customer', 'collected_by', 'cash_location_id', 'payment_type'], defaults: 'week' },
  { key: 'monthly-collection', icon: Banknote, f: ['range', 'customer', 'collected_by', 'cash_location_id', 'payment_type'], defaults: 'month' },
  { key: 'pending', icon: Clock, f: ['customer'] },
  { key: 'loan-disbursement', icon: Receipt, f: ['range', 'customer'], defaults: 'month' },
  { key: 'loan-outstanding', icon: BookOpen, f: ['customer'] },
  { key: 'advance-balance', icon: Wallet, f: ['customer'] },
  { key: 'penalty', icon: ShieldAlert, f: ['range', 'customer'], defaults: 'month' },
  { key: 'recovery-staff', icon: UserCog, f: ['range'], defaults: 'month' },
  { key: 'cash-location', icon: Landmark, f: ['range', 'cash_location_id'], defaults: 'month' },
  { key: 'cash-transfer', icon: ArrowLeftRight, f: ['range'], defaults: 'month' },
  { key: 'customer-ledger', icon: Users, f: ['range', 'customer'] },
  { key: 'closed-khata', icon: CheckCircle2, f: ['customer'] },
  { key: 'overdue', icon: AlertTriangle, f: ['customer'] },
]

const MONEY = new Set(['amount', 'pending_amount', 'overdue_amount', 'advance_balance', 'principal', 'total_repayment', 'finance_charges', 'weekly_amount', 'processing_charges', 'total_paid', 'penalty_outstanding', 'old_khata_remaining', 'total_outstanding', 'paid_amount', 'waived_amount', 'collected', 'cash_balance', 'opening', 'collection', 'transfer_in', 'transfer_out', 'expenses', 'disbursement', 'closing', 'debit', 'credit', 'balance'])
const DATES = new Set(['date', 'next_due_date', 'closed_at'])

export default function Reports() {
  const { key } = useParams()
  if (!key) return <Hub />
  return <ReportView key={key} rkey={key} />
}

function Hub() {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader title={t('nav.reports')} subtitle={t('reports.subtitle')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.key} to={`/reports/${r.key}`}>
            <Card className="flex items-center gap-3 p-4 transition active:scale-[.99]">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-800"><r.icon className="h-6 w-6" /></div>
              <div className="min-w-0">
                <div className="font-semibold text-navy-900">{t(`reports.names.${r.key}`)}</div>
                <div className="truncate text-xs text-slate-500">{t(`reports.desc.${r.key}`)}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

const monthStart = () => todayISO().slice(0, 8) + '01'
const weekStart = () => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ReportView({ rkey }: { rkey: string }) {
  const { t } = useTranslation()
  const def = REPORTS.find((r) => r.key === rkey)
  const nav = useNavigate()
  const { can, session } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const startFrom = def?.defaults === 'week' ? weekStart() : monthStart()
  const [d, setD] = useState({
    date: todayISO(), from: startFrom, to: todayISO(), customer: null as PickedCustomer | null,
    collected_by: '', cash_location_id: '', payment_type: '',
  })
  const [applied, setApplied] = useState(d)

  const users = useQuery({ queryKey: ['users', 'recovery'], queryFn: () => get<any[]>('/users', { role: 'recovery' }), enabled: !!def?.f.includes('collected_by') })
  const locs = useQuery({ queryKey: ['cash-locations'], queryFn: () => get<{ locations: any[] }>('/cash-locations'), enabled: !!def?.f.includes('cash_location_id') })

  const params = useMemo(() => {
    const p: Record<string, unknown> = {}
    if (!def) return p
    if (def.f.includes('date')) p.date = applied.date
    if (def.f.includes('range')) {
      p.from = applied.from
      p.to = applied.to
    }
    if (def.f.includes('customer') && applied.customer) p.customer_id = applied.customer.id
    if (def.f.includes('collected_by') && applied.collected_by) p.collected_by = applied.collected_by
    if (def.f.includes('cash_location_id') && applied.cash_location_id) p.cash_location_id = applied.cash_location_id
    if (def.f.includes('payment_type') && applied.payment_type) p.payment_type = applied.payment_type
    return p
  }, [applied, def])

  const needsCustomer = rkey === 'customer-ledger' && !applied.customer
  const q = useQuery({ queryKey: ['report', rkey, params], queryFn: () => get<any>(`/reports/${rkey}`, params), enabled: !!def && !needsCustomer })

  if (!def) return <EmptyState title={t('noData')} />

  const preset = (k: 'today' | 'week' | 'month') => {
    const n = { ...d, from: k === 'today' ? todayISO() : k === 'week' ? weekStart() : monthStart(), to: todayISO(), date: todayISO() }
    setD(n)
    setApplied(n)
  }

  const fmt = (col: string, v: any): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (col === 'status') return t(`status.${v}`, { defaultValue: String(v) })
    if (col === 'payment_type') return t(`payTypes.${v}`, { defaultValue: String(v) })
    if (col === 'type') return rkey === 'cash-location' ? t(`cashTypes.${v}`, { defaultValue: String(v) }) : t(`ledgerTypes.${v}`, { defaultValue: String(v) })
    if (col === 'close_type') return t(`reports.closeType.${v}`, { defaultValue: String(v) })
    if (DATES.has(col)) return fdate(String(v))
    if (MONEY.has(col)) return money(v)
    return String(v)
  }

  const exportAs = async (ext: 'xlsx' | 'csv') => {
    setBusy(ext)
    try {
      await download(`/reports/${rkey}`, { ...params, export: ext }, `${rkey}-${todayISO()}.${ext}`)
    } catch (e) {
      toast.error(errMsg(e, t))
    } finally {
      setBusy('')
    }
  }

  const cols: string[] = q.data?.columns ?? []
  const rows: any[] = q.data?.rows ?? []
  const totals = q.data?.totals
  const filterSummary = [
    def.f.includes('date') && `${t('date')}: ${fdate(applied.date)}`,
    def.f.includes('range') && `${fdate(applied.from)} – ${fdate(applied.to)}`,
    applied.customer && def.f.includes('customer') && `${t('customer')}: ${applied.customer.name}`,
  ].filter(Boolean).join('  |  ')

  return (
    <div>
      {/* the sidebar offset must disappear when printing */}
      <style>{`@media print { .md\\:pl-64 { padding-left: 0 !important } main { max-width: none !important; padding: 0 !important } }`}</style>
      <div className="no-print">
        <PageHeader back="/reports" title={t(`reports.names.${rkey}`)} subtitle={t(`reports.desc.${rkey}`)} />

        <Card className="mb-4 space-y-3 p-4">
          {(def.f.includes('range') || def.f.includes('date')) && (
            <Segmented value={'' as string} onChange={(v) => preset(v as any)} options={[{ value: 'today', label: t('today') }, { value: 'week', label: t('thisWeek') }, { value: 'month', label: t('thisMonth') }]} />
          )}
          <div className="grid gap-3 md:grid-cols-3">
            {def.f.includes('date') && <Field label={t('date')}><Input type="date" value={d.date} max={todayISO()} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>}
            {def.f.includes('range') && (
              <>
                <Field label={t('from')}><Input type="date" value={d.from} max={d.to} onChange={(e) => setD({ ...d, from: e.target.value })} /></Field>
                <Field label={t('to')}><Input type="date" value={d.to} min={d.from} onChange={(e) => setD({ ...d, to: e.target.value })} /></Field>
              </>
            )}
            {def.f.includes('customer') && (
              <Field label={t('customer')} required={rkey === 'customer-ledger'} className="md:col-span-1"><CustomerPicker value={d.customer} onChange={(c) => setD({ ...d, customer: c })} invalid={needsCustomer && !d.customer} /></Field>
            )}
            {def.f.includes('collected_by') && (
              <Field label={t('recoveryPerson')}>
                <Select value={d.collected_by} onChange={(e) => setD({ ...d, collected_by: e.target.value })}>
                  <option value="">{t('all')}</option>
                  {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </Field>
            )}
            {def.f.includes('cash_location_id') && (
              <Field label={t('cashLocation')}>
                <Select value={d.cash_location_id} onChange={(e) => setD({ ...d, cash_location_id: e.target.value })}>
                  <option value="">{t('all')}</option>
                  {(locs.data?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            )}
            {def.f.includes('payment_type') && (
              <Field label={t('paymentType')}>
                <Select value={d.payment_type} onChange={(e) => setD({ ...d, payment_type: e.target.value })}>
                  <option value="">{t('all')}</option>
                  {(session?.config.payment_types ?? ['cash', 'upi', 'bank', 'other']).map((p) => <option key={p} value={p}>{t(`payTypes.${p}`)}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setApplied(d)}>{t('reports.run')}</Button>
            {can('reports.export') && (
              <>
                <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'xlsx'} onClick={() => exportAs('xlsx')} disabled={needsCustomer}>{t('exportExcel')}</Button>
                <Button variant="secondary" icon={<FileText className="h-4 w-4" />} loading={busy === 'csv'} onClick={() => exportAs('csv')} disabled={needsCustomer}>{t('exportCsv')}</Button>
              </>
            )}
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => window.print()} disabled={!rows.length}>{t('downloadPdf')}</Button>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!rows.length}>{t('print')}</Button>
            <Button variant="ghost" onClick={() => nav('/reports')}>{t('reports.allReports')}</Button>
          </div>
        </Card>
      </div>

      {/* print header */}
      <div className="print-only mb-4">
        <div className="text-xl font-bold">{session?.finance.name || t('appName')}</div>
        <div className="text-lg font-semibold">{t(`reports.names.${rkey}`)}</div>
        <div className="text-sm text-slate-600">{filterSummary}</div>
        <div className="text-xs text-slate-500">{t('reports.generatedOn')}: {fdate(todayISO())}</div>
      </div>

      {needsCustomer ? (
        <EmptyState title={t('reports.pickCustomer')} />
      ) : q.isLoading ? (
        <ListSkeleton rows={5} h="h-14" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('noResults')} />
      ) : (
        <>
          <div className="mb-2 text-sm text-slate-500 no-print">{t('reports.rowsN', { count: rows.length })}</div>
          {/* table (desktop + print) */}
          <Card className="hidden overflow-x-auto md:block print:block print:border-0 print:shadow-none">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>{cols.map((c) => <th key={c} className={`whitespace-nowrap px-3 py-3 ${MONEY.has(c) ? 'text-right' : ''}`}>{t(`reports.col.${c}`, { defaultValue: c })}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} className={`px-3 py-2.5 ${MONEY.has(c) ? 'text-right tabular-nums' : ''}`}>{fmt(c, r[c])}</td>)}</tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="border-t-2 border-navy-200 bg-navy-50 font-bold">
                  <tr>
                    {cols.map((c, i) => (
                      <td key={c} className={`px-3 py-3 ${MONEY.has(c) ? 'text-right tabular-nums' : ''}`}>
                        {totals[c] !== undefined ? fmt(c, totals[c]) : i === 0 ? t('total') : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </Card>
          {/* cards (mobile) */}
          <div className="space-y-2 md:hidden print:hidden">
            {rows.map((r, i) => (
              <Card key={i} className="p-3.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="truncate font-semibold text-navy-900">{fmt(cols[0], r[cols[0]])}</div>
                  {cols.includes('status') && cols[0] !== 'status' && <Badge tone="gray">{fmt('status', r.status)}</Badge>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {cols.slice(1).filter((c) => c !== 'status' || cols[0] === 'status').map((c) => (
                    <div key={c} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{t(`reports.col.${c}`, { defaultValue: c })}</dt>
                      <dd className={`truncate font-medium ${MONEY.has(c) ? 'tabular-nums' : ''}`}>{fmt(c, r[c])}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
            {totals && (
              <Card className="bg-navy-50 p-3.5">
                <div className="mb-1 font-bold text-navy-900">{t('total')}</div>
                <dl className="grid grid-cols-2 gap-x-3 text-sm">
                  {cols.filter((c) => totals[c] !== undefined).map((c) => (
                    <div key={c}><dt className="text-[11px] uppercase text-slate-500">{t(`reports.col.${c}`, { defaultValue: c })}</dt><dd className="font-bold tabular-nums">{fmt(c, totals[c])}</dd></div>
                  ))}
                </dl>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}

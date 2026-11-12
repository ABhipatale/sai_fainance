import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { getPage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate } from '@/lib/format'
import { Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Money, PageHeader, Pagination, Select, StatusBadge } from '@/components/ui'
import { ReasonDialog } from './LoanDetail'

export default function Penalties() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [dlg, setDlg] = useState<{ kind: 'waive' | 'reverse'; p: any } | null>(null)

  const q = useQuery({
    queryKey: ['penalties', page, status, from, to],
    queryFn: () => getPage('/penalties', { page, status: status || undefined, from: from || undefined, to: to || undefined }),
    placeholderData: (p) => p,
  })
  const rows = q.data?.data ?? []

  return (
    <div>
      <PageHeader title={t('penalties.title')} subtitle={t('penalties.manualHint')} />
      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">{t('status')}: {t('all')}</option>
          {['open', 'partial', 'paid', 'waived', 'reversed'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label={t('from')} />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label={t('to')} />
      </Card>

      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? <EmptyState icon={<ShieldAlert className="h-7 w-7" />} title={t('penalties.none')} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((p: any) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link to={`/customers/${p.customer_id}`} className="block truncate font-bold text-navy-900">{p.customer_name}</Link>
                  <Link to={`/khata/${p.loan_account_id}`} className="text-xs font-semibold text-navy-600">{p.khata_no}{p.installment_number ? ` • #${p.installment_number}` : ''}</Link>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-1 text-xs text-slate-500">{fdate(p.penalty_date)} • {p.added_by}{p.reason ? ` • ${p.reason}` : ''}</div>
              <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-slate-50 p-2 text-center text-xs">
                <div><div className="text-slate-400">{t('amount')}</div><Money v={p.amount} /></div>
                <div><div className="text-slate-400">{t('paid')}</div><Money v={p.paid_amount} tone="ok" /></div>
                <div><div className="text-slate-400">{t('penalties.waived')}</div><Money v={p.waived_amount} tone="navy" /></div>
                <div><div className="text-slate-400">{t('remaining')}</div><Money v={p.outstanding} tone="over" /></div>
              </div>
              {Number(p.outstanding) > 0 && (
                <div className="mt-3 flex gap-2">
                  {can('penalties.waive') && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'waive', p })}>{t('penalties.waive')}</Button>}
                  {can('penalties.reverse') && p.status === 'open' && Number(p.paid_amount) === 0 && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'reverse', p })}>{t('penalties.reverse')}</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Pagination page={q.data?.meta.page ?? 1} last={q.data?.meta.last_page ?? 1} onPage={setPage} />
      {dlg && <ReasonDialog kind={dlg.kind} p={dlg.p} onClose={() => setDlg(null)} onDone={() => { setDlg(null); qc.invalidateQueries({ queryKey: ['penalties'] }); qc.invalidateQueries({ queryKey: ['loan'] }) }} />}
    </div>
  )
}

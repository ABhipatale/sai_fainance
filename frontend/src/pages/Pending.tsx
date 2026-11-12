import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDownUp, Eye, SlidersHorizontal } from 'lucide-react'
import { get, getPage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, num } from '@/lib/format'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Money, PageHeader, Pagination, SearchInput, SearchSelect, Select, StatusBadge, cn } from '@/components/ui'
import CollectSheet from '@/components/CollectSheet'
import { ContactButtons, Metric, loanStatus, statusBorder, useDebounced, type LoanCard } from '@/components/FlowParts'

const CHIPS = ['all', 'pending', 'overdue', 'partial', 'advance', 'today'] as const
const SORTS = ['remaining_installments', 'overdue_amount', 'pending_amount', 'next_due_date', 'name', 'village'] as const

export default function Pending() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { session, can } = useAuth()
  const isRecovery = session?.user.role === 'recovery'
  const def = session?.config.pending_sort ?? { by: 'remaining_installments', dir: 'asc' as const }

  const [filter, setFilter] = useState<(typeof CHIPS)[number]>('pending')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [by, setBy] = useState<string>(def.by)
  const [dir, setDir] = useState<'asc' | 'desc'>(def.dir)
  const [staff, setStaff] = useState<string | number | null>(null)
  const [village, setVillage] = useState('')
  const dvillage = useDebounced(village.trim(), 400)
  const [remaining, setRemaining] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [sheet, setSheet] = useState<LoanCard | null>(null)

  const staffQ = useQuery({ queryKey: ['users', 'recovery'], queryFn: () => get<any[]>('/users', { role: 'recovery' }), enabled: !isRecovery && can('recovery.view') })

  const params = { filter, q: dq || undefined, sort: by, dir, recovery_user_id: staff || undefined, village: dvillage || undefined, remaining_installments: remaining || undefined, page, per_page: 20 }
  const list = useQuery({ queryKey: ['pending', params], queryFn: () => getPage<LoanCard>('/pending-recovery', params), placeholderData: keepPreviousData })
  const rows = list.data?.data ?? []
  const meta = list.data?.meta

  const reset1 = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }
  const activeFilters = [staff, dvillage, remaining].filter(Boolean).length

  return (
    <div>
      <PageHeader title={t('nav.pending')} subtitle={t('pending.subtitle')} />

      {meta && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Card className="border-l-4 border-l-pend p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{t('pending.pendingTotal')}</div>
            <div className="text-xl font-bold text-pend"><Money v={meta.pending_total} /></div>
          </Card>
          <Card className="border-l-4 border-l-over p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{t('pending.overdueTotal')}</div>
            <div className="text-xl font-bold text-over"><Money v={meta.overdue_total} /></div>
          </Card>
        </div>
      )}

      <SearchInput value={q} onChange={reset1(setQ)} />

      <div className="-mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-2">
          {CHIPS.map((k) => (
            <button key={k} onClick={() => reset1(setFilter)(k)} className={cn('h-10 rounded-full px-4 text-sm font-semibold transition', filter === k ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>
              {t(`pending.filters.${k}`)}
            </button>
          ))}
        </div>
      </div>

      {/* sort + filters */}
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2">
          <ArrowDownUp className="h-4 w-4 shrink-0 text-slate-400" />
          <Select value={by} onChange={(e) => reset1(setBy)(e.target.value)} className="!h-10 flex-1 text-sm" aria-label={t('pending.sort')}>
            {SORTS.map((s) => (
              <option key={s} value={s}>{t(`pending.sortBy.${s}`)}</option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" className="!h-10 shrink-0" onClick={() => reset1(setDir)(dir === 'asc' ? 'desc' : 'asc')}>
            {dir === 'asc' ? t('pending.asc') : t('pending.desc')}
          </Button>
        </div>
        <Button variant={activeFilters ? 'primary' : 'secondary'} size="sm" className="!h-10" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowFilters((s) => !s)}>
          {t('filters')}{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
      </div>

      {showFilters && (
        <Card className="mt-3 grid gap-3 p-4 md:grid-cols-3">
          {!isRecovery && can('recovery.view') && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">{t('pending.recoveryStaff')}</div>
              <SearchSelect clearable placeholder={t('all')} options={(staffQ.data ?? []).map((u) => ({ value: u.id, label: u.name }))} value={staff} onChange={reset1(setStaff)} />
            </div>
          )}
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t('village')}</div>
            <Input value={village} onChange={(e) => reset1(setVillage)(e.target.value)} placeholder={t('village')} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t('pending.remainingInst')}</div>
            <Input value={remaining} inputMode="numeric" onChange={(e) => reset1(setRemaining)(e.target.value.replace(/\D/g, ''))} placeholder="—" />
          </div>
          <div className="md:col-span-3">
            <Button variant="ghost" size="sm" onClick={() => { setStaff(null); setVillage(''); setRemaining(''); setPage(1) }}>{t('reset')}</Button>
          </div>
        </Card>
      )}

      <div className="mt-4 space-y-3">
        {list.isLoading && <ListSkeleton rows={4} h="h-52" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {!list.isLoading && !list.isError && rows.length === 0 && <EmptyState title={t('pending.empty')} text={t('pending.emptyText')} />}

        {rows.map((c) => {
          const st = loanStatus(c)
          return (
            <Card key={c.id} className={cn('border-l-4 p-4', statusBorder[st])}>
              <div className="flex items-start gap-3">
                <Avatar src={c.customer?.photo_url} name={c.customer?.name} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-bold text-navy-900">{c.customer?.name}</span>
                    <StatusBadge status={st} />
                    {num(c.advance_balance) > 0 && <Badge tone="adv">{t('advance')}</Badge>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{c.khata_no} · {c.customer?.mobile}{c.customer?.village ? ` · ${c.customer.village}` : ''}</div>
                </div>
                <div className="shrink-0 text-center">
                  <div className="text-2xl font-extrabold leading-none text-navy-800">{c.remaining_installments}</div>
                  <div className="text-[10px] font-medium uppercase text-slate-500">{t('pending.left')}</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Metric label={t('pending.totalLoan')}><Money v={c.total_repayment} /></Metric>
                <Metric label={t('pending.totalPaid')} tone="ok"><Money v={c.total_paid} /></Metric>
                <Metric label={t('pending.remainingLoan')}><Money v={c.remaining_loan} /></Metric>
                <Metric label={t('pending.nextDue')}>{fdate(c.next_due_date)}</Metric>
                <Metric label={t('pending.pendingAmount')} tone={num(c.net_due_now) > 0 ? 'pend' : undefined}><Money v={c.net_due_now} /></Metric>
                <Metric label={t('pending.overdueAmount')} tone={num(c.net_overdue) > 0 ? 'over' : undefined}><Money v={c.net_overdue} /></Metric>
                <Metric label={t('pending.advanceBalance')} tone={num(c.advance_balance) > 0 ? 'adv' : undefined}><Money v={c.advance_balance} /></Metric>
                <Metric label={t('pending.remainingInstallments')}>{c.remaining_installments}</Metric>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {can('payments.collect') && <Button variant="success" className="flex-1" onClick={() => setSheet(c)}>{t('collection.collect')}</Button>}
                <Button variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => nav(can('loans.view') ? `/khata/${c.id}` : `/customers/${c.customer_id}`)} aria-label={t('details')} />
                <ContactButtons customer={c.customer} />
              </div>
            </Card>
          )
        })}
      </div>

      {meta && <Pagination page={page} last={meta.last_page} onPage={setPage} />}
      <CollectSheet open={!!sheet} onClose={() => setSheet(null)} loan={sheet} />
    </div>
  )
}

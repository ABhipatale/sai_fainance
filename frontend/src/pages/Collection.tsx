import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CloudOff, Eye, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { get, getPage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, num } from '@/lib/format'
import { removeQueued, syncQueue, useQueue } from '@/lib/offline'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, Money, PageHeader, Pagination, SearchInput, Skeleton, StatCard, StatusBadge, cn } from '@/components/ui'
import CollectSheet, { type CollectMode } from '@/components/CollectSheet'
import { ContactButtons, Metric, loanStatus, statusBorder, useDebounced, type LoanCard } from '@/components/FlowParts'

const FILTERS = ['all', 'pending', 'overdue', 'partial', 'advance'] as const

export default function Collection() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { can } = useAuth()
  const queue = useQueue()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [page, setPage] = useState(1)
  const [sheet, setSheet] = useState<{ loan: LoanCard; mode: CollectMode; partial?: boolean } | null>(null)
  const searching = dq.length > 0

  const today = useQuery({
    queryKey: ['collection', 'today', filter, page],
    queryFn: () => getPage<LoanCard>('/collection/today', { filter, page, per_page: 20 }),
    enabled: !searching,
    placeholderData: keepPreviousData,
  })
  const search = useQuery({ queryKey: ['collection', 'search', dq], queryFn: () => get<LoanCard[]>('/collection/search', { q: dq }), enabled: searching })

  const active = searching ? search : today
  const list: LoanCard[] = (searching ? search.data : today.data?.data) ?? []
  const s = today.data?.summary

  const open = (loan: LoanCard, mode: CollectMode = 'auto', partial = false) => setSheet({ loan, mode, partial })
  const details = (c: LoanCard) => nav(can('loans.view') ? `/khata/${c.id}` : `/customers/${c.customer_id}`)

  return (
    <div>
      <PageHeader title={t('nav.collection')} subtitle={t('collection.subtitle')} />

      {/* offline payments waiting to be synced */}
      {queue.items.length > 0 && (
        <Card className="mb-4 border-orange-200 bg-orange-50/60 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-pend">
            <CloudOff className="h-5 w-5" />
            {t('collection.queueTitle')} ({queue.items.length})
            {queue.online && queue.pending > 0 && (
              <Button size="sm" variant="secondary" className="ml-auto" icon={<RefreshCw className="h-4 w-4" />} onClick={() => syncQueue()}>{t('syncNow')}</Button>
            )}
          </div>
          <div className="space-y-2">
            {queue.items.map((i) => (
              <div key={i.key} className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{i.label}</div>
                  <div className="text-xs text-slate-500">{new Date(i.createdAt).toLocaleString('en-GB')}</div>
                  {i.status === 'failed' && <div className="text-xs font-medium text-over">{i.error}</div>}
                </div>
                <Money v={i.amount} className="font-bold" />
                <Badge tone={i.status === 'failed' ? 'over' : 'pend'}>{i.status === 'failed' ? t('collection.queueFailed') : t('pendingSync')}</Badge>
                {i.status === 'failed' && (
                  <button onClick={() => removeQueued(i.key)} className="grid h-9 w-9 place-items-center rounded-lg text-over hover:bg-red-50" aria-label={t('collection.remove')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} />

      {/* summary */}
      {!searching && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {today.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
            ) : s ? (
              <>
                <StatCard label={t('collection.expected')} value={<Money v={s.expected_today} />} tone="navy" />
                <StatCard label={t('collection.collectedToday')} value={<Money v={s.collected_today} />} tone="ok" />
                <StatCard label={t('collection.remaining')} value={<Money v={s.remaining_today} />} tone="pend" />
                <StatCard label={t('collection.customersPaid')} value={s.customers_paid} tone="ok" />
                <StatCard label={t('collection.customersPending')} value={s.customers_pending} tone="pend" />
                <StatCard label={t('collection.customersOverdue')} value={s.customers_overdue} tone="over" />
                <StatCard label={t('collection.advanceCustomers')} value={s.advance_customers} tone="adv" />
                <StatCard label={t('collection.partialPayments')} value={s.partial_payments} tone="pend" />
              </>
            ) : null}
          </div>

          <div className="-mx-4 mt-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <div className="flex min-w-max gap-2">
              {FILTERS.map((k) => (
                <button key={k} onClick={() => { setFilter(k); setPage(1) }} className={cn('h-10 rounded-full px-4 text-sm font-semibold transition', filter === k ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>
                  {t(`collection.filters.${k}`)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="mt-4 space-y-3">
        {active.isLoading && <ListSkeleton rows={4} h="h-44" />}
        {active.isError && <ErrorState error={active.error} onRetry={() => active.refetch()} />}
        {!active.isLoading && !active.isError && list.length === 0 && (
          <EmptyState icon={<Wallet className="h-7 w-7" />} title={searching ? t('noResults') : t('collection.empty')} text={searching ? undefined : t('collection.emptyText')} />
        )}
        {list.map((c) => {
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
                  <div className="truncate text-xs text-slate-500">
                    {c.khata_no} · {c.customer?.mobile}{c.customer?.village ? ` · ${c.customer.village}` : ''}
                  </div>
                  {c.next_due_date && <div className="text-xs text-slate-400">{t('collection.nextDue')}: {fdate(c.next_due_date)}</div>}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label={t('collection.weekly')}><Money v={c.weekly_amount} /></Metric>
                <Metric label={t('collection.prevPending')} tone={num(c.net_overdue) > 0 ? 'over' : undefined}><Money v={c.net_overdue} /></Metric>
                <Metric label={t('collection.advanceBal')} tone={num(c.advance_balance) > 0 ? 'adv' : undefined}><Money v={c.advance_balance} /></Metric>
                <Metric label={t('collection.todayDue')} tone={num(c.payable_now) > 0 ? 'pend' : 'ok'}><Money v={c.payable_now} /></Metric>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button className="col-span-1" variant="success" onClick={() => open(c)}>{t('collection.collect')}</Button>
                <Button variant="secondary" onClick={() => open(c, 'auto', true)}>{t('collection.partial')}</Button>
                <Button variant="secondary" className="!text-adv" onClick={() => open(c, 'advance')}>{t('collection.advanceBtn')}</Button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Button variant="ghost" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => details(c)}>{t('details')}</Button>
                <ContactButtons customer={c.customer} />
              </div>
            </Card>
          )
        })}
      </div>

      {!searching && today.data && <Pagination page={page} last={today.data.meta.last_page} onPage={setPage} />}

      <CollectSheet open={!!sheet} onClose={() => setSheet(null)} loan={sheet?.loan ?? null} mode={sheet?.mode} partial={sheet?.partial} />
    </div>
  )
}

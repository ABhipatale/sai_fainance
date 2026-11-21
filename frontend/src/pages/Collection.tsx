import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CloudOff, MessageSquareText, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { get, getPage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { num } from '@/lib/format'
import { removeQueued, syncQueue, useQueue } from '@/lib/offline'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, Money, PageHeader, Pagination, SearchInput, Skeleton, StatusBadge, cn } from '@/components/ui'
import CommentSheet from '@/components/CommentSheet'
import CollectSheet, { type CollectMode } from '@/components/CollectSheet'
import { ContactButtons, loanStatus, statusBorder, useDebounced, type LoanCard } from '@/components/FlowParts'

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
  const [commentFor, setCommentFor] = useState<LoanCard | null>(null)

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
          {today.isLoading ? <Skeleton className="mt-3 h-24" /> : s && (
            <Card className="mt-3 p-3">
              <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
                <div><div className="text-[10px] font-medium uppercase text-slate-500">{t('collection.expected')}</div><div className="text-base font-extrabold tabular-nums text-navy-800"><Money v={s.expected_today} /></div></div>
                <div><div className="text-[10px] font-medium uppercase text-slate-500">{t('collection.collectedToday')}</div><div className="text-base font-extrabold tabular-nums text-ok"><Money v={s.collected_today} /></div></div>
                <div><div className="text-[10px] font-medium uppercase text-slate-500">{t('collection.remaining')}</div><div className="text-base font-extrabold tabular-nums text-pend"><Money v={s.remaining_today} /></div></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2 text-[11px] font-semibold">
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">{t('collection.customersPaid')} {s.customers_paid}</span>
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">{t('collection.customersPending')} {s.customers_pending}</span>
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">{t('collection.customersOverdue')} {s.customers_overdue}</span>
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{t('collection.advanceCustomers')} {s.advance_customers}</span>
              </div>
            </Card>
          )}

          <div className="-mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
            <div className="flex min-w-max gap-2">
              {FILTERS.map((k) => (
                <button key={k} onClick={() => { setFilter(k); setPage(1) }} className={cn('h-9 rounded-full px-3.5 text-sm font-semibold transition', filter === k ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>
                  {t(`collection.filters.${k}`)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="mt-3 space-y-2">
        {active.isLoading && <ListSkeleton rows={6} h="h-24" />}
        {active.isError && <ErrorState error={active.error} onRetry={() => active.refetch()} />}
        {!active.isLoading && !active.isError && list.length === 0 && (
          <EmptyState icon={<Wallet className="h-7 w-7" />} title={searching ? t('noResults') : t('collection.empty')} text={searching ? undefined : t('collection.emptyText')} />
        )}
        {list.map((c) => {
          const st = loanStatus(c)
          const due = num(c.payable_now)
          const prev = num(c.net_overdue)
          const adv = num(c.advance_balance)
          return (
            <Card key={c.id} className={cn('border-l-4 px-3 py-2.5', statusBorder[st])}>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
              {/* line 1: who + what to collect */}
              <div className="flex items-center gap-2.5">
                <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => details(c)}>
                  <Avatar src={c.customer?.photo_url} name={c.customer?.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-bold leading-tight text-navy-900">{c.customer?.name}</span>
                      <StatusBadge status={st} />
                    </span>
                    <span className="block truncate text-[11px] leading-tight text-slate-500">{c.khata_no}{c.customer?.village ? ` · ${c.customer.village}` : ''} · {t('collection.weekly')} <Money v={c.weekly_amount} /></span>
                  </span>
                </button>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] font-medium uppercase leading-none text-slate-500">{t('collection.todayDue')}</div>
                  <div className={cn('text-lg font-extrabold leading-tight tabular-nums', due > 0 ? 'text-pend' : 'text-ok')}><Money v={c.payable_now} /></div>
                </div>
              </div>

              {/* line 2: only the numbers that matter (zeros stay hidden) */}
              {c.last_comment && (
                <button onClick={() => setCommentFor(c)} className="mt-1.5 flex w-full items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-left text-[11px] text-amber-900">
                  <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" /><span className="line-clamp-2">{c.last_comment}</span>
                </button>
              )}
              {(prev > 0 || adv > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  {prev > 0 && <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-red-700">{t('collection.prevPending')} <Money v={c.net_overdue} /></span>}
                  {adv > 0 && <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-violet-700">{t('collection.advanceBal')} <Money v={c.advance_balance} /></span>}
                </div>
              )}
              </div>

              {/* actions – full width on phones, compact and right-aligned on wide screens */}
              <div className="flex items-center gap-1.5 md:shrink-0">
                <Button size="sm" variant="success" className="!h-9 flex-1 md:!w-28 md:flex-none" onClick={() => open(c)}>{t('collection.collect')}</Button>
                <Button size="sm" variant="secondary" className="!h-9 !px-3" onClick={() => open(c, 'auto', true)}>{t('collection.partial')}</Button>
                <Button size="sm" variant="secondary" className="!h-9 !px-3 !text-adv" onClick={() => open(c, 'advance')}>{t('collection.advanceBtn')}</Button>
                <button onClick={() => setCommentFor(c)} aria-label={t('comments.title')} className="relative grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-amber-600">
                  <MessageSquareText className="h-[18px] w-[18px]" />
                  {c.comment_count > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{c.comment_count}</span>}
                </button>
                <ContactButtons customer={c.customer} compact />
              </div>
              </div>
            </Card>
          )
        })}
      </div>

      {!searching && today.data && <Pagination page={page} last={today.data.meta.last_page} onPage={setPage} />}

      <CommentSheet loan={commentFor} onClose={() => setCommentFor(null)} />
      <CollectSheet open={!!sheet} onClose={() => setSheet(null)} loan={sheet?.loan ?? null} mode={sheet?.mode} partial={sheet?.partial} />
    </div>
  )
}

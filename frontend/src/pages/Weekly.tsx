import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Banknote, CalendarDays, ChevronLeft, ChevronRight, HandCoins, Landmark } from 'lucide-react'
import { get, getPage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, num } from '@/lib/format'
import { Button, Card, EmptyState, ErrorState, ListSkeleton, Money, PageHeader, SearchInput, cn } from '@/components/ui'
import { OpeningSheet } from '@/pages/Dashboard'
import CollectSheet from '@/components/CollectSheet'
import { TONE_STYLE, useDebounced, type LoanCard } from '@/components/FlowParts'

type Filter = 'all' | 'pending' | 'paid'
const STATE_TONE: Record<string, string> = {
  paid: 'bg-green-50 text-green-700 ring-green-200', partial: 'bg-yellow-50 text-yellow-800 ring-yellow-300',
  pending: 'bg-red-50 text-red-700 ring-red-200', none: 'bg-slate-100 text-slate-500 ring-slate-200',
}

function Stat({ label, children, tone, sub }: { label: string; children: React.ReactNode; tone?: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn('truncate text-lg font-extrabold tabular-nums text-navy-900', tone)}>{children}</div>
      {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

export default function Weekly() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { can } = useAuth()
  const [start, setStart] = useState<string | undefined>()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [sheet, setSheet] = useState<LoanCard | null>(null)
  const [showGiven, setShowGiven] = useState(false)
  const [openSheet, setOpenSheet] = useState(false)
  const cash = useQuery({ queryKey: ['cash-locations', 'week'], queryFn: () => get<{ locations: any[]; total_cash: string }>('/cash-locations', { status: 'active' }), enabled: can('cash.view') })
  const cashRows = cash.data?.locations ?? []
  const cashTotal = num(cash.data?.total_cash)

  const params = { week_start: start, filter, q: dq || undefined }
  // the report carries summary / week / loans_given next to `data`, so read the whole response body
  const raw = useQuery({
    queryKey: ['weekly', params],
    queryFn: async () => (await getPage<any>('/weekly-report', params)) as unknown as { data: any[]; summary: any; loans_given: any[]; week: any },
    placeholderData: keepPreviousData,
  })
  const d = raw.data
  const W = d?.week
  const S = d?.summary
  const rows: (LoanCard & { week: any })[] = d?.data ?? []
  const canCollect = can('payments.collect')
  const range = W ? `${fdate(W.start)} – ${fdate(W.end)}` : ''
  const weekdays = t('weekdays', { returnObjects: true }) as unknown as string[]

  return (
    <div>
      <PageHeader title={t('nav.weekly')} subtitle={W ? `${weekdays[W.weekday]} → ${weekdays[(W.weekday + 6) % 7]}` : undefined} />

      {/* week navigator */}
      <Card className="mb-3 flex items-center gap-2 p-2">
        <button onClick={() => W && setStart(W.prev)} className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-navy-800 active:scale-95" aria-label={t('weekly.prev')}><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-base font-extrabold text-navy-900">{range || '…'}</div>
          <div className="text-[11px] font-medium text-slate-500">{W?.is_current ? t('weekly.thisWeek') : ''}</div>
        </div>
        <label className="relative grid h-11 w-11 cursor-pointer place-items-center rounded-xl bg-slate-100 text-navy-800" aria-label={t('weekly.pickDate')}>
          <CalendarDays className="h-5 w-5" />
          <input type="date" className="absolute inset-0 cursor-pointer opacity-0" value={W?.start ?? ''} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
        <button onClick={() => W && setStart(W.next)} className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-navy-800 active:scale-95" aria-label={t('weekly.next')}><ChevronRight className="h-5 w-5" /></button>
      </Card>
      {W && !W.is_current && <button onClick={() => setStart(undefined)} className="mb-3 text-sm font-semibold text-navy-800 underline">{t('weekly.goCurrent')}</button>}

      {raw.isError && <ErrorState error={raw.error} onRetry={() => raw.refetch()} />}
      {raw.isLoading && <ListSkeleton rows={4} h="h-16" />}

      {S && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label={t('weekly.expected')}><Money v={S.expected} /></Stat>
            <Stat label={t('weekly.collected')} tone="text-ok"><Money v={S.collected} /></Stat>
            <Stat label={t('weekly.pending')} tone={num(S.pending) > 0 ? 'text-over' : undefined} sub={`${S.khata_pending} ${t('weekly.khata')}`}><Money v={S.pending} /></Stat>
            <Stat label={t('weekly.carry')} tone={num(S.carry_pending) > 0 ? 'text-pend' : undefined} sub={t('weekly.carryHint')}><Money v={S.carry_pending} /></Stat>
            <Stat label={t('weekly.paidKhata')} tone="text-ok">{S.khata_paid}<span className="text-sm font-medium text-slate-400"> / {S.khata_due}</span></Stat>
            <Stat label={t('weekly.advanceIn')} tone="text-adv"><Money v={S.advance_deposited} /></Stat>
            <Stat label={t('weekly.penaltyIn')}><Money v={S.penalty_collected} /></Stat>
          </div>

          {/* loans given – the owner's Monday figure */}
          <Card className="mt-3 border-l-4 border-l-navy-800 p-3">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setShowGiven((s) => !s)}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-800"><HandCoins className="h-6 w-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{t('weekly.given')}</span>
                <span className="block text-xl font-extrabold tabular-nums text-navy-900"><Money v={S.loans_given_cash} /></span>
                <span className="block text-xs text-slate-500">{S.loans_given_count} {t('weekly.khata')} · {t('weekly.toRepay')} <Money v={S.loans_given_repayment} /></span>
              </span>
              <ChevronRight className={cn('h-5 w-5 text-slate-400 transition', showGiven && 'rotate-90')} />
            </button>
            {showGiven && (
              <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                {(d?.loans_given ?? []).length === 0 && <div className="py-3 text-sm text-slate-500">{t('weekly.noGiven')}</div>}
                {(d?.loans_given ?? []).map((g: any) => (
                  <button key={g.id} onClick={() => nav(`/khata/${g.id}`)} className="flex w-full items-center justify-between gap-2 py-2.5 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-navy-900">{g.customer_name}</span>
                      <span className="block text-[11px] text-slate-500">{g.khata_no} · {fdate(g.disbursement_date)} · {g.installments_count} × <Money v={g.weekly_amount} /></span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums"><Money v={g.cash_given} /></span>
                      <span className="block text-[11px] text-slate-500">{t('weekly.firstDue')} {fdate(g.first_installment_date)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {can('cash.view') && cashRows.length > 0 && (
        <Card className="mt-3 p-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-800"><Landmark className="h-6 w-6" /></span>
            <button className="min-w-0 flex-1 text-left" onClick={() => nav('/cash')}>
              <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{t('weekly.cash')}</span>
              <span className="block text-xl font-extrabold tabular-nums text-navy-900"><Money v={cashTotal} /></span>
            </button>
            {can('cash.opening') && <Button size="sm" onClick={() => setOpenSheet(true)}>{t('dashboard.opening.confirm')}</Button>}
          </div>
          <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
            {cashRows.map((l) => (
              <button key={l.id} onClick={() => nav(`/cash/${l.id}`)} className="flex w-full items-center justify-between py-2 text-left text-sm">
                <span className="truncate">{l.name}</span>
                <b className="tabular-nums"><Money v={l.current_balance} /></b>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-4"><SearchInput value={q} onChange={setQ} /></div>
      <div className="mt-3 flex gap-2">
        {(['all', 'pending', 'paid'] as Filter[]).map((k) => (
          <button key={k} onClick={() => setFilter(k)} className={cn('h-10 rounded-full px-4 text-sm font-semibold', filter === k ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>{t(`weekly.filter.${k}`)}</button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {d && rows.length === 0 && <EmptyState title={t('weekly.empty')} />}
        {rows.map((c) => {
          const w = c.week
          const st = TONE_STYLE[c.tone] ?? TONE_STYLE.green
          return (
            <Card key={c.id} className={cn('border-l-4 p-3', st.bar)}>
              <div className="flex items-start gap-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => nav(can('loans.view') ? `/khata/${c.id}` : `/customers/${c.customer_id}`)}>
                  <div className="truncate font-bold leading-tight text-navy-900">{c.customer?.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{c.khata_no}{c.customer?.village ? ` · ${c.customer.village}` : ''} · {t('weekly.week')} {w.installment_no ?? '—'}/{c.installments_count}</div>
                </button>
                <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset', STATE_TONE[w.state])}>{t(`weekly.state.${w.state}`)}</span>
                {canCollect && c.status === 'active' && num(c.net_due_now) > 0 && (
                  <button onClick={() => setSheet(c)} aria-label={t('collection.collect')} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-green-600 text-white active:scale-95"><Banknote className="h-[18px] w-[18px]" /></button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs sm:grid-cols-6">
                <div><div className="text-[10px] uppercase text-slate-500">{t('weekly.due')}</div><b className="tabular-nums"><Money v={w.due} /></b></div>
                <div><div className="text-[10px] uppercase text-slate-500">{t('weekly.received')}</div><b className="tabular-nums text-ok"><Money v={w.received} /></b></div>
                <div><div className="text-[10px] uppercase text-slate-500">{t('weekly.stillPending')}</div><b className={cn('tabular-nums', num(w.remaining) > 0 && 'text-over')}><Money v={w.remaining} /></b></div>
                <div><div className="text-[10px] uppercase text-slate-500">{t('weekly.advance')}</div><b className={cn('tabular-nums', num(c.advance_balance) > 0 && 'text-adv')}><Money v={c.advance_balance} /></b></div>
                <div><div className="text-[10px] uppercase text-slate-500">{t('weekly.penalty')}</div><b className={cn('tabular-nums', num(c.penalty_outstanding) > 0 && 'text-pend')}><Money v={c.penalty_outstanding} /></b></div>
                <div><div className="text-[10px] uppercase text-slate-500">{t('weekly.weeksLeft')}</div><b className="tabular-nums">{c.remaining_installments} <span className="font-normal text-slate-400">· <Money v={c.total_outstanding} /></span></b></div>
              </div>
            </Card>
          )
        })}
      </div>

      <OpeningSheet open={openSheet} onClose={() => setOpenSheet(false)} />
      <CollectSheet open={!!sheet} onClose={() => setSheet(null)} loan={sheet} />
    </div>
  )
}

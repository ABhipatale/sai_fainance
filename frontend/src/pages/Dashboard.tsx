import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CalendarCheck, CheckCircle2, Coins, FileText, HandCoins, Landmark, ShieldAlert, Target, TrendingUp, Wallet, AlertTriangle, Clock } from 'lucide-react'
import { get, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, num } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Money, PageHeader, Sheet, Skeleton, StatCard, Tabs, errMsg } from '@/components/ui'

type Mode = 'monday' | 'collection' | 'after'

function Progress({ value, tone = 'bg-ok' }: { value: number; tone?: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/** Monday opening-balance confirmation (defaults to previous closing; manual adjustments need a note). */
export function OpeningSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['dashboard', 'opening'], queryFn: () => get<any>('/cash/opening'), enabled: open })
  const [adj, setAdj] = useState<Record<number, { a: string; n: string }>>({})
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const rows: any[] = (q.data?.locations ?? []).filter((l: any) => !l.confirmed)
  const items = rows.map((l) => ({ cash_location_id: l.id, adjustment: adj[l.id]?.a || undefined, note: adj[l.id]?.n || undefined }))

  const submit = async () => {
    if (busy) return
    const bad = items.find((i) => num(i.adjustment) !== 0 && !i.note)
    if (bad) {
      setConfirm(false)
      setErr(t('dashboard.opening.noteRequired'))
      return
    }
    setBusy(true)
    try {
      await post('/cash/opening', { week_date: q.data.week_date, items })
      toast.success(t('dashboard.opening.done'))
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setConfirm(false)
      onClose()
    } catch (e) {
      setConfirm(false)
      setErr(errMsg(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={t('dashboard.opening.title')} footer={rows.length > 0 ? <Button size="lg" full onClick={() => { setErr(''); setConfirm(true) }}>{t('dashboard.opening.confirm')}</Button> : undefined}>
        <p className="mb-3 text-sm text-slate-500">{t('dashboard.opening.help')} ({fdate(q.data?.week_date)})</p>
        {q.isLoading && <Skeleton className="h-32" />}
        {q.isError && <ErrorState error={q.error} />}
        {q.data && rows.length === 0 && <EmptyState title={t('dashboard.opening.allDone')} />}
        <div className="space-y-3">
          {rows.map((l) => (
            <div key={l.id} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{l.name}</div>
                <Money v={l.previous_closing} className="font-bold text-navy-800" />
              </div>
              <div className="text-xs text-slate-500">{t('dashboard.opening.previous')}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label={t('dashboard.opening.adjustment')}>
                  <Input inputMode="decimal" placeholder="0" value={adj[l.id]?.a ?? ''} onChange={(e) => setAdj((s) => ({ ...s, [l.id]: { a: e.target.value.replace(/[^0-9.-]/g, ''), n: s[l.id]?.n ?? '' } }))} />
                </Field>
                <Field label={t('reason')}>
                  <Input value={adj[l.id]?.n ?? ''} onChange={(e) => setAdj((s) => ({ ...s, [l.id]: { a: s[l.id]?.a ?? '', n: e.target.value } }))} />
                </Field>
              </div>
            </div>
          ))}
        </div>
        {err && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-over">{err}</div>}
      </Sheet>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={submit} loading={busy} title={t('dashboard.opening.title')} message={t('dashboard.opening.confirmText')} />
    </>
  )
}

function StaffList({ staff, title }: { staff: any[]; title: string }) {
  const { t } = useTranslation()
  if (!staff?.length) return null
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-base font-bold text-navy-900">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {staff.map((s) => {
          const pct = s.performance_pct ?? (num(s.expected_today) > 0 ? Math.min(100, (num(s.collected_today) * 100) / num(s.expected_today)) : 0)
          return (
            <Card key={s.user.id} className="p-4">
              <div className="flex items-center gap-3">
                <Avatar src={s.user.photo_url} name={s.user.name} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-navy-900">{s.user.name}</div>
                  <div className="text-xs text-slate-500">{s.assigned_customers} {t('dashboard.customersShort')} · {s.active_khata} {t('khata.title')}</div>
                </div>
                <Badge tone={pct >= 80 ? 'ok' : pct >= 40 ? 'pend' : 'over'}>{Math.round(pct)}%</Badge>
              </div>
              <div className="mt-3"><Progress value={pct} tone={pct >= 80 ? 'bg-ok' : pct >= 40 ? 'bg-pend' : 'bg-over'} /></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div><div className="text-slate-500">{t('dashboard.target')}</div><div className="text-sm font-bold"><Money v={s.expected_today} /></div></div>
                <div><div className="text-slate-500">{t('dashboard.collectedShort')}</div><div className="text-sm font-bold text-ok"><Money v={s.collected_today} /></div></div>
                <div><div className="text-slate-500">{t('dashboard.remainingShort')}</div><div className="text-sm font-bold text-pend"><Money v={s.remaining_today} /></div></div>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>{t('dashboard.weekCollected')}: <b className="text-slate-800"><Money v={s.week_collected} /></b></span>
                {s.cash_balance != null && <span>{t('dashboard.cashInHand')}: <b className="text-slate-800"><Money v={s.cash_balance} /></b></span>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const { session, can } = useAuth()
  const [tab, setTab] = useState<Mode | null>(null)
  const [openSheet, setOpenSheet] = useState(false)
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<any>('/dashboard'), refetchInterval: 60_000 })

  const d = q.data
  const view: Mode = tab ?? d?.mode ?? 'collection'
  const c = d?.cards
  const isRecovery = session?.user.role === 'recovery'

  const card = (label: string, v: any, tone: any, icon: React.ReactNode, money = true) => (
    <StatCard label={label} value={money ? <Money v={v} /> : v} tone={tone} icon={icon} />
  )

  return (
    <div>
      <PageHeader title={t('dashboard.greeting', { name: session?.user.name })} subtitle={d ? `${t(`weekdays.${new Date(d.today).getDay()}`, { defaultValue: '' }) || ''} ${fdate(d.today)}` : undefined} />

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {/* the 11 summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {q.isLoading
          ? Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : c && (
              <>
                {card(t('dashboard.cards.active_khata'), c.active_khata, 'navy', <FileText className="h-5 w-5" />, false)}
                {card(t('dashboard.cards.active_loan_amount'), c.active_loan_amount, 'navy', <Banknote className="h-5 w-5" />)}
                {card(t('dashboard.cards.total_to_collect'), c.total_to_collect, 'navy', <Target className="h-5 w-5" />)}
                {card(t('dashboard.cards.total_collected'), c.total_collected, 'ok', <CheckCircle2 className="h-5 w-5" />)}
                {card(t('dashboard.cards.total_pending'), c.total_pending, 'pend', <Clock className="h-5 w-5" />)}
                {card(t('dashboard.cards.total_overdue'), c.total_overdue, 'over', <AlertTriangle className="h-5 w-5" />)}
                {card(t('dashboard.cards.advance_balance'), c.advance_balance, 'adv', <Wallet className="h-5 w-5" />)}
                {card(t('dashboard.cards.today_collection'), c.today_collection, 'ok', <Coins className="h-5 w-5" />)}
                {c.monday_opening_balance != null && card(t('dashboard.cards.monday_opening_balance'), c.monday_opening_balance, 'navy', <Landmark className="h-5 w-5" />)}
                {card(t('dashboard.cards.new_disbursement'), c.new_disbursement, 'navy', <HandCoins className="h-5 w-5" />)}
                {card(t('dashboard.cards.today_penalty_collection'), c.today_penalty_collection, 'pend', <ShieldAlert className="h-5 w-5" />)}
              </>
            )}
      </div>

      {/* quick links */}
      {!q.isLoading && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {can('payments.collect') && <Link to="/collection" className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-ok font-semibold text-white shadow"><Banknote className="h-5 w-5" />{t('nav.collection')}</Link>}
          {can('payments.view') && <Link to="/pending" className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-navy-800 ring-1 ring-navy-200"><Clock className="h-5 w-5" />{t('nav.pending')}</Link>}
        </div>
      )}

      {d && (
        <div className="mt-6">
          <Tabs
            value={view}
            onChange={setTab}
            tabs={[
              { value: 'monday', label: `${t('dashboard.tabs.monday')}${d.mode === 'monday' ? ' •' : ''}` },
              { value: 'collection', label: `${t('dashboard.tabs.collection')}${d.mode === 'collection' ? ' •' : ''}` },
              { value: 'after', label: `${t('dashboard.tabs.after')}${d.mode === 'after' ? ' •' : ''}` },
            ]}
          />

          {/* ------------------------------ Monday */}
          {view === 'monday' && (
            <div>
              {!isRecovery && (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard label={t('dashboard.monday.previousClosing')} value={<Money v={d.monday.previous_closing} />} tone="navy" icon={<Landmark className="h-5 w-5" />} />
                    <StatCard label={t('dashboard.monday.availableCash')} value={<Money v={d.monday.available_cash} />} tone="ok" icon={<Coins className="h-5 w-5" />} />
                    <StatCard label={t('dashboard.monday.weeklyExpected')} value={<Money v={d.monday.weekly_expected} />} tone="navy" sub={`${t('dashboard.monday.nextCollection')}: ${fdate(d.monday.next_collection_date)}`} icon={<CalendarCheck className="h-5 w-5" />} />
                    <StatCard label={t('dashboard.monday.totalPending')} value={<Money v={d.monday.total_pending} />} tone="pend" icon={<Clock className="h-5 w-5" />} />
                  </div>

                  {d.monday.loans_given && (
                    <Link to="/" className="mt-3 block">
                      <StatCard label={t('dashboard.monday.loansGiven')} value={<Money v={d.monday.loans_given.cash_given} />} tone="navy" sub={`${d.monday.loans_given.count} ${t('dashboard.monday.loansGivenSub')} · ${fdate(d.monday.loans_given.week_start)} – ${fdate(d.monday.loans_given.week_end)}`} icon={<HandCoins className="h-5 w-5" />} />
                    </Link>
                  )}

                  {d.monday.loans_given && (
                    <Link to="/weekly" className="mt-3 block">
                      <StatCard label={t('dashboard.monday.loansGiven')} value={<Money v={d.monday.loans_given.cash_given} />} tone="navy" sub={`${d.monday.loans_given.count} ${t('dashboard.monday.loansGivenSub')} · ${fdate(d.monday.loans_given.week_start)} – ${fdate(d.monday.loans_given.week_end)}`} icon={<HandCoins className="h-5 w-5" />} />
                    </Link>
                  )}

                  <Card className="mt-4 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-bold text-navy-900">{t('dashboard.monday.cashByLocation')}</h2>
                      {d.monday.confirmed ? (
                        <Badge tone="ok">{t('dashboard.opening.confirmed')}</Badge>
                      ) : (
                        can('cash.opening') && <Button size="sm" onClick={() => setOpenSheet(true)}>{t('dashboard.opening.confirm')}</Button>
                      )}
                    </div>
                    {d.monday.cash_by_location.length === 0 && <EmptyState title={t('noData')} />}
                    <div className="divide-y divide-slate-100">
                      {d.monday.cash_by_location.map((l: any) => (
                        <div key={l.id} className="flex items-center justify-between py-2.5">
                          <div>
                            <div className="font-medium">{l.name}</div>
                            <div className="text-xs text-slate-500">{t(`cashTypes.${l.type}`)}</div>
                          </div>
                          <Money v={l.balance} className="font-bold" />
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              )}
              <StaffList staff={d.staff} title={t('dashboard.monday.staffTargets')} />
            </div>
          )}

          {/* ------------------------------ collection day */}
          {view === 'collection' && (
            <div>
              <Card className="p-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase text-slate-500">{t('dashboard.collection.collectedToday')}</div>
                    <div className="text-3xl font-extrabold text-ok"><Money v={d.collection.collected_today} /></div>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    {t('dashboard.collection.expectedToday')}
                    <div className="font-bold text-slate-800"><Money v={d.collection.expected_today} /></div>
                  </div>
                </div>
                <div className="mt-3">
                  <Progress value={num(d.collection.expected_today) > 0 ? (num(d.collection.collected_today) * 100) / num(d.collection.expected_today) : 0} />
                </div>
              </Card>
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label={t('dashboard.collection.remaining')} value={<Money v={d.collection.remaining_today} />} tone="pend" icon={<Clock className="h-5 w-5" />} />
                <StatCard label={t('dashboard.collection.customersPaid')} value={d.collection.customers_paid} tone="ok" icon={<CheckCircle2 className="h-5 w-5" />} />
                <StatCard label={t('dashboard.collection.customersPending')} value={d.collection.customers_pending} tone="pend" icon={<TrendingUp className="h-5 w-5" />} />
                <StatCard label={t('dashboard.collection.missed')} value={d.collection.missed_installments} tone="over" icon={<AlertTriangle className="h-5 w-5" />} />
              </div>
              <StaffList staff={d.staff} title={t('dashboard.collection.staffPerformance')} />
            </div>
          )}

          {/* ------------------------------ after collection day */}
          {view === 'after' && (
            <div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatCard label={t('dashboard.after.newDisbursements')} value={<Money v={d.after.new_disbursements} />} tone="navy" icon={<HandCoins className="h-5 w-5" />} />
                <StatCard label={t('dashboard.after.pendingInstallments')} value={d.after.pending_installments} tone="pend" icon={<Clock className="h-5 w-5" />} />
                <StatCard label={t('dashboard.after.overdueRecovery')} value={<Money v={d.after.overdue_recovery} />} tone="over" icon={<AlertTriangle className="h-5 w-5" />} />
                <StatCard label={t('dashboard.after.advanceCustomers')} value={d.after.advance_customers} tone="adv" icon={<Wallet className="h-5 w-5" />} />
                <StatCard label={t('dashboard.after.oldKhata')} value={<Money v={d.after.old_khata_outstanding} />} tone="navy" icon={<FileText className="h-5 w-5" />} />
                <StatCard label={t('dashboard.after.totalRemaining')} value={<Money v={d.after.total_remaining_recovery} />} tone="navy" icon={<Target className="h-5 w-5" />} />
              </div>
              <StaffList staff={d.staff} title={t('dashboard.collection.staffPerformance')} />
            </div>
          )}
        </div>
      )}

      <OpeningSheet open={openSheet} onClose={() => setOpenSheet(false)} />
    </div>
  )
}

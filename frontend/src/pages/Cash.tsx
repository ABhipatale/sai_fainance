import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, CalendarCheck, ChevronRight, Landmark, Plus, Receipt } from 'lucide-react'
import { get, getPage, post, put } from '@/lib/api'
import { fdate, money, todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, Money, PageHeader, SearchSelect, Select, Sheet, StatusBadge, Textarea, errMsg,
} from '@/components/ui'

const TYPES = ['office_cash', 'recovery_cash', 'bank_account', 'other']

export default function Cash() {
  const { t } = useTranslation()
  const { can, session } = useAuth()
  const nav = useNavigate()
  const [locSheet, setLocSheet] = useState<any | null | false>(false) // false=closed, null=new, obj=edit
  const [xfer, setXfer] = useState(false)
  const [expSheet, setExpSheet] = useState(false)

  const locs = useQuery({ queryKey: ['cash-locations'], queryFn: () => get<{ locations: any[]; total_cash: string }>('/cash-locations') })
  const transfers = useQuery({ queryKey: ['cash-transfers', 'recent'], queryFn: () => getPage('/cash-transfers', { per_page: 8 }) })

  return (
    <div>
      <PageHeader
        title={t('nav.cash')}
        actions={
          <>
            {can('cash.transfer') && (
              <Button variant="secondary" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setXfer(true)}>
                {t('cash.transfer')}
              </Button>
            )}
            {can('cash.manage') && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setLocSheet(null)}>
                {t('add')}
              </Button>
            )}
          </>
        }
      />

      {locs.isLoading ? (
        <ListSkeleton rows={4} h="h-20" />
      ) : locs.error ? (
        <ErrorState error={locs.error} onRetry={() => locs.refetch()} />
      ) : (
        <>
          <Card className="mb-4 bg-gradient-to-r from-navy-800 to-navy-600 p-5 text-white">
            <div className="text-sm text-white/70">{t('cash.totalCash')}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{money(locs.data!.total_cash)}</div>
          </Card>

          {can('cash.opening') && <OpeningCard />}

          <div className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('cash.locations')}</div>
          {locs.data!.locations.length === 0 ? (
            <EmptyState title={t('cash.noLocations')} icon={<Landmark className="h-7 w-7" />} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {locs.data!.locations.map((l) => (
                <Card key={l.id} className="p-4" onClick={() => nav(`/cash/${l.id}`)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-navy-900">{l.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <Badge tone="navy">{t(`cashTypes.${l.type}`)}</Badge>
                        <StatusBadge status={l.status} />
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {t('cash.responsible')}: <span className="font-medium text-slate-700">{l.responsible_name || '—'}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {t('cash.openingBalance')}: {money(l.opening_balance)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{t('cash.currentBalance')}</div>
                      <Money v={l.current_balance} className="text-xl font-bold text-navy-900" />
                      <div className="mt-2 flex items-center justify-end gap-1">
                        {can('cash.manage') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setLocSheet(l)
                            }}
                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-navy-800"
                          >
                            {t('edit')}
                          </button>
                        )}
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {can('expenses.manage') && <ExpensesCard onAdd={() => setExpSheet(true)} />}

      <div className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('cash.recentTransfers')}</div>
      {transfers.isLoading ? (
        <ListSkeleton rows={3} h="h-16" />
      ) : (transfers.data?.data ?? []).length === 0 ? (
        <EmptyState title={t('cash.noTransfers')} />
      ) : (
        <div className="space-y-2">
          {transfers.data!.data.map((x: any) => (
            <Card key={x.id} className="flex items-center justify-between gap-3 p-3.5">
              <div className="min-w-0 text-sm">
                <div className="truncate font-semibold text-slate-800">
                  {x.from} → {x.to}
                </div>
                <div className="text-xs text-slate-500">
                  {fdate(x.transfer_date)} · {x.created_by}
                  {x.notes ? ` · ${x.notes}` : ''}
                </div>
              </div>
              <Money v={x.amount} className="font-bold text-navy-900" />
            </Card>
          ))}
        </div>
      )}

      <LocationSheet value={locSheet} onClose={() => setLocSheet(false)} />
      <TransferSheet open={xfer} onClose={() => setXfer(false)} locations={locs.data?.locations ?? []} ownLocationId={session?.user.role === 'recovery' ? session.user.cash_location_id ?? null : null} />
      <ExpenseSheet open={expSheet} onClose={() => setExpSheet(false)} locations={locs.data?.locations ?? []} />
    </div>
  )
}

/* ------------------------------------------------------------- Monday opening balance */
function OpeningCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cash-opening'], queryFn: () => get<any>('/cash/opening') })
  const [adj, setAdj] = useState<Record<number, { a: string; n: string }>>({})
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')

  const m = useMutation({
    mutationFn: (items: any[]) => post('/cash/opening', { week_date: q.data.week_date, items }),
    onSuccess: () => {
      toast.success(t('cash.openingConfirmed'))
      setConfirm(false)
      setAdj({})
      qc.invalidateQueries({ queryKey: ['cash-opening'] })
      qc.invalidateQueries({ queryKey: ['cash-locations'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(errMsg(e, t))
    },
  })

  if (q.isLoading) return <ListSkeleton rows={1} h="h-40" />
  if (q.error || !q.data) return null
  const pendingLocs: any[] = q.data.locations.filter((l: any) => !l.confirmed)
  const allDone = pendingLocs.length === 0

  const submit = () => {
    setErr('')
    for (const l of pendingLocs) {
      const v = adj[l.id]
      if (v && Number(v.a) !== 0 && v.a !== '' && !v.n.trim()) {
        setErr(t('cash.errNote'))
        return
      }
    }
    setConfirm(true)
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy-800">
          <CalendarCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-bold text-navy-900">{t('cash.mondayOpening')}</div>
          <div className="text-xs text-slate-500">{t('cash.weekOf', { date: fdate(q.data.week_date) })}</div>
        </div>
        {allDone && <Badge tone="ok">{t('cash.confirmed')}</Badge>}
      </div>
      <div className="divide-y divide-slate-100">
        {q.data.locations.map((l: any) => (
          <div key={l.id} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{l.name}</div>
                <div className="text-xs text-slate-500">
                  {t('cash.previousClosing')}: <span className="font-semibold">{money(l.previous_closing)}</span>
                </div>
              </div>
              {l.confirmed ? (
                <div className="text-right">
                  <Money v={l.opening_amount} className="font-bold text-ok" />
                  {Number(l.adjustment) !== 0 && <div className="text-xs text-pend">{t('cash.adjustment')}: {money(l.adjustment)}</div>}
                </div>
              ) : (
                <div className="w-32">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder={t('cash.adjustment')}
                    value={adj[l.id]?.a ?? ''}
                    onChange={(e) => setAdj((s) => ({ ...s, [l.id]: { a: e.target.value, n: s[l.id]?.n ?? '' } }))}
                    className="h-10 text-right"
                  />
                </div>
              )}
            </div>
            {l.confirmed && l.adjustment_note && <div className="mt-1 text-xs italic text-slate-500">“{l.adjustment_note}”</div>}
            {!l.confirmed && adj[l.id]?.a && Number(adj[l.id].a) !== 0 && (
              <Input className="mt-2 h-10" placeholder={t('cash.adjustmentNote')} value={adj[l.id]?.n ?? ''} onChange={(e) => setAdj((s) => ({ ...s, [l.id]: { a: s[l.id]?.a ?? '', n: e.target.value } }))} />
            )}
          </div>
        ))}
      </div>
      {!allDone && (
        <>
          <p className="mt-1 text-xs text-slate-500">{t('cash.openingHint')}</p>
          {err && <div className="mt-2 text-sm font-medium text-over">{err}</div>}
          <Button className="mt-3" size="lg" full onClick={submit}>
            {t('cash.confirmOpening')}
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={m.isPending}
        message={t('cash.confirmOpeningQ')}
        onConfirm={() =>
          m.mutate(
            pendingLocs.map((l) => ({
              cash_location_id: l.id,
              adjustment: adj[l.id]?.a ? Number(adj[l.id].a) : 0,
              note: adj[l.id]?.n || undefined,
            })),
          )
        }
      />
    </Card>
  )
}

/* ------------------------------------------------------------- Expenses */
function ExpensesCard({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation()
  const q = useQuery({ queryKey: ['expenses'], queryFn: () => getPage('/expenses', { per_page: 8 }) })
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('cash.expenses')}</div>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
          {t('cash.addExpense')}
        </Button>
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={2} h="h-16" />
      ) : (q.data?.data ?? []).length === 0 ? (
        <EmptyState title={t('cash.noExpenses')} icon={<Receipt className="h-7 w-7" />} />
      ) : (
        <div className="space-y-2">
          {q.data!.data.map((e: any) => (
            <Card key={e.id} className="flex items-center justify-between gap-3 p-3.5">
              <div className="min-w-0 text-sm">
                <div className="truncate font-semibold text-slate-800">{e.category || t('cash.expense')}</div>
                <div className="truncate text-xs text-slate-500">
                  {fdate(e.date)} · {e.location}
                  {e.description ? ` · ${e.description}` : ''}
                </div>
              </div>
              <Money v={e.amount} tone="over" className="font-bold" />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- add / edit location */
function LocationSheet({ value, onClose }: { value: any | null | false; onClose: () => void }) {
  const open = value !== false
  const edit = value && value.id ? value : null
  return open ? <LocationForm key={edit?.id ?? 'new'} edit={edit} onClose={onClose} /> : null
}

function LocationForm({ edit, onClose }: { edit: any | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { can } = useAuth()
  const [f, setF] = useState({
    name: edit?.name ?? '',
    type: edit?.type ?? 'office_cash',
    responsible_user_id: edit?.responsible_user_id ?? null,
    opening_balance: '',
    status: edit?.status ?? 'active',
    notes: edit?.notes ?? '',
  })
  const [err, setErr] = useState<Record<string, string>>({})

  const rec = useQuery({ queryKey: ['users', 'recovery'], queryFn: () => get<any[]>('/users', { role: 'recovery' }) })
  const mgr = useQuery({ queryKey: ['users', 'manager'], queryFn: () => get<any[]>('/users', { role: 'manager' }), enabled: can('managers.manage') })
  const people = useMemo(() => [...(mgr.data ?? []), ...(rec.data ?? [])].map((u) => ({ value: u.id, label: u.name, sub: t(`roles.${u.role}`) })), [rec.data, mgr.data, t])

  const m = useMutation({
    mutationFn: () => {
      const body: any = { name: f.name.trim(), type: f.type, responsible_user_id: f.responsible_user_id, status: f.status, notes: f.notes || null }
      if (!edit) body.opening_balance = f.opening_balance === '' ? 0 : Number(f.opening_balance)
      return edit ? put(`/cash-locations/${edit.id}`, body) : post('/cash-locations', body)
    },
    onSuccess: () => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['cash-locations'] })
      onClose()
    },
    onError: (e) => toast.error(errMsg(e, t)),
  })

  const submit = () => {
    const er: Record<string, string> = {}
    if (!f.name.trim()) er.name = t('validation.required')
    if (!edit && f.opening_balance !== '' && Number(f.opening_balance) < 0) er.opening_balance = t('validation.min')
    setErr(er)
    if (!Object.keys(er).length) m.mutate()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={edit ? t('cash.editLocation') : t('cash.addLocation')}
      footer={
        <div className="flex gap-3 pb-1">
          <Button variant="secondary" full onClick={onClose}>{t('cancel')}</Button>
          <Button full loading={m.isPending} onClick={submit}>{t('save')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t('cash.locationName')} required error={err.name}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!err.name} />
        </Field>
        <Field label={t('cash.locationType')} required>
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPES.map((x) => (
              <option key={x} value={x}>{t(`cashTypes.${x}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('cash.responsible')}>
          <SearchSelect options={people} value={f.responsible_user_id} onChange={(v) => setF({ ...f, responsible_user_id: v as number | null })} clearable />
        </Field>
        {!edit && (
          <Field label={t('cash.openingBalance')} error={err.opening_balance} hint={t('cash.openingOnlyOnCreate')}>
            <Input type="number" inputMode="decimal" step="0.01" min="0" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} />
          </Field>
        )}
        <Field label={t('status')}>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">{t('status.active')}</option>
            <option value="inactive">{t('status.inactive')}</option>
          </Select>
        </Field>
        <Field label={t('notes')}>
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------- transfer */
function TransferSheet({ open, onClose, locations, ownLocationId }: { open: boolean; onClose: () => void; locations: any[]; ownLocationId: number | null }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState<{ from: number | string | null; to: number | string | null; amount: string; date: string; notes: string }>({ from: ownLocationId, to: null, amount: '', date: todayISO(), notes: '' })
  const [err, setErr] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)

  // recovery staff can only see their own location in /cash-locations, so destinations come from the collection list
  const dest = useQuery({ queryKey: ['cash-locations', 'transfer'], queryFn: () => get<any[]>('/cash-locations', { for: 'transfer' }), enabled: open && ownLocationId !== null })
  const all = ownLocationId !== null ? [...locations, ...(dest.data ?? [])].filter((l, i, a) => a.findIndex((x) => x.id === l.id) === i) : locations
  const active = all.filter((l) => (l.status ?? 'active') === 'active')
  const opts = active.map((l) => ({ value: l.id, label: l.name, sub: l.current_balance !== undefined ? money(l.current_balance) : undefined }))
  const name = (id: any) => all.find((l) => String(l.id) === String(id))?.name ?? ''

  const m = useMutation({
    mutationFn: () => post('/cash-transfers', { from_location_id: f.from, to_location_id: f.to, amount: Number(f.amount), transfer_date: f.date, notes: f.notes || undefined }),
    onSuccess: () => {
      toast.success(t('cash.transferDone'))
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['cash-locations'] })
      qc.invalidateQueries({ queryKey: ['cash-transfers'] })
      qc.invalidateQueries({ queryKey: ['cash-ledger'] })
      setF({ from: ownLocationId, to: null, amount: '', date: todayISO(), notes: '' })
      onClose()
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(errMsg(e, t))
    },
  })

  const submit = () => {
    const er: Record<string, string> = {}
    if (!f.from) er.from = t('validation.required')
    if (!f.to) er.to = t('validation.required')
    if (f.from && f.to && String(f.from) === String(f.to)) er.to = t('cash.errSame')
    if (!(Number(f.amount) > 0)) er.amount = t('validation.positive')
    setErr(er)
    if (!Object.keys(er).length) setConfirm(true)
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={t('cash.transferTitle')}
        footer={<Button size="lg" full className="mb-1" onClick={submit}>{t('cash.transfer')}</Button>}
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-navy-50 p-3 text-xs text-navy-800">{t('cash.transferInfo')}</p>
          <Field label={t('cash.fromLocation')} required error={err.from}>
            <SearchSelect options={opts} value={f.from} onChange={(v) => setF({ ...f, from: v })} disabled={ownLocationId !== null} invalid={!!err.from} />
          </Field>
          <Field label={t('cash.toLocation')} required error={err.to}>
            <SearchSelect options={opts.filter((o) => String(o.value) !== String(f.from))} value={f.to} onChange={(v) => setF({ ...f, to: v })} invalid={!!err.to} />
          </Field>
          <Field label={t('amount')} required error={err.amount}>
            <Input type="number" inputMode="decimal" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} invalid={!!err.amount} className="text-lg font-semibold" />
          </Field>
          <Field label={t('date')}>
            <Input type="date" max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label={t('notes')}>
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
      </Sheet>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={m.isPending} onConfirm={() => m.mutate()} message={t('cash.transferConfirm', { amount: money(f.amount), from: name(f.from), to: name(f.to) })} />
    </>
  )
}

/* ------------------------------------------------------------- expense */
function ExpenseSheet({ open, onClose, locations }: { open: boolean; onClose: () => void; locations: any[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState<{ loc: number | string | null; amount: string; date: string; category: string; description: string }>({ loc: null, amount: '', date: todayISO(), category: '', description: '' })
  const [err, setErr] = useState<Record<string, string>>({})
  const m = useMutation({
    mutationFn: () => post('/expenses', { cash_location_id: f.loc, amount: Number(f.amount), expense_date: f.date, category: f.category || undefined, description: f.description || undefined }),
    onSuccess: () => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['cash-locations'] })
      setF({ loc: null, amount: '', date: todayISO(), category: '', description: '' })
      onClose()
    },
    onError: (e) => toast.error(errMsg(e, t)),
  })
  const submit = () => {
    const er: Record<string, string> = {}
    if (!f.loc) er.loc = t('validation.required')
    if (!(Number(f.amount) > 0)) er.amount = t('validation.positive')
    setErr(er)
    if (!Object.keys(er).length) m.mutate()
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('cash.addExpense')} footer={<Button size="lg" full className="mb-1" loading={m.isPending} onClick={submit}>{t('save')}</Button>}>
      <div className="space-y-4">
        <Field label={t('cashLocation')} required error={err.loc}>
          <SearchSelect options={locations.filter((l) => l.status === 'active').map((l) => ({ value: l.id, label: l.name, sub: money(l.current_balance) }))} value={f.loc} onChange={(v) => setF({ ...f, loc: v })} invalid={!!err.loc} />
        </Field>
        <Field label={t('amount')} required error={err.amount}>
          <Input type="number" inputMode="decimal" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="text-lg font-semibold" />
        </Field>
        <Field label={t('date')}>
          <Input type="date" max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label={t('cash.category')}>
          <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </Field>
        <Field label={t('cash.description')}>
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Sheet>
  )
}

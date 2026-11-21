import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, Banknote, Check, Grid3x3, List, UserCheck } from 'lucide-react'
import { get, getPage, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { num } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Button, Card, EmptyState, ErrorState, ListSkeleton, Money, PageHeader, SearchInput, Segmented, Select, StickyBar, cn, errMsg } from '@/components/ui'
import CollectSheet from '@/components/CollectSheet'
import { TONE_STYLE, useDebounced, type LoanCard, type Tone4 } from '@/components/FlowParts'

interface Week { n: number; due: string; status: string; expected: string; paid: string }
type Row = LoanCard & { weeks?: Week[] }

const TONES: Tone4[] = ['red', 'orange', 'yellow', 'green']

/** One cell of the week-by-week grid (the Excel sheet): ✓ paid · ½ partly paid · red = missed · grey = still to come. */
function Cell({ w }: { w: Week }) {
  const s = w.status
  const base = 'mx-auto grid h-6 w-6 place-items-center rounded text-[11px] font-bold'
  if (s === 'paid' || s === 'advanced_covered' || s === 'settled') return <span className={cn(base, 'bg-green-500 text-white')}><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
  if (s === 'partially_paid') return <span className={cn(base, 'bg-yellow-400 text-yellow-950')}>½</span>
  if (s === 'overdue') return <span className={cn(base, 'bg-red-600 text-white')}>✕</span>
  if (s === 'pending') return <span className={cn(base, 'bg-orange-500 text-white')}>!</span>
  return <span className={cn(base, 'bg-slate-100 text-slate-300 ring-1 ring-inset ring-slate-200')}>·</span>
}

export default function KhataSheet() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [tone, setTone] = useState<Tone4 | ''>('')
  const [status, setStatus] = useState<'active' | 'closed'>('active')
  const [grid, setGrid] = useState(false)
  const [sort, setSort] = useState<'remaining' | 'pending' | 'name'>('remaining')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [sheet, setSheet] = useState<LoanCard | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const canAssign = can('recovery.assign') && can('recovery.view')
  const [staffFilter, setStaffFilter] = useState('')          // '' = all, '0' = not assigned, id = that person
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set())      // selected khata ids
  const [target, setTarget] = useState('')
  const staff = useQuery({ queryKey: ['users', 'recovery'], queryFn: () => get<any[]>('/users', { role: 'recovery' }), enabled: canAssign })

  const params = { status, recovery_user_id: staffFilter || undefined, q: dq || undefined, tone: tone || undefined, sort, dir, grid: grid ? 1 : undefined }
  const list = useQuery({ queryKey: ['sheet', params], queryFn: () => getPage<Row>('/khata-sheet', params), placeholderData: keepPreviousData })
  const rows = list.data?.data ?? []
  const meta = list.data?.meta
  const tones: Record<string, number> = meta?.tones ?? {}
  const cols = Math.max(meta?.max_weeks ?? 0, 1)
  const canCollect = can('payments.collect') && status === 'active' && !selecting
  const allSelected = rows.length > 0 && rows.every((c) => sel.has(c.id))
  const toggle = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const stopSelecting = () => { setSelecting(false); setSel(new Set()); setTarget('') }

  const assign = useMutation({
    mutationFn: (rec: string) => {
      const ids = [...new Set(rows.filter((c) => sel.has(c.id)).map((c) => c.customer_id))]
      return post<any>('/recovery/assign', { recovery_user_id: rec || null, customer_ids: ids })
    },
    onSuccess: (r, rec) => {
      toast.success(rec ? t('sheet.done', { count: r?.assigned ?? 0 }) : t('sheet.doneUn', { count: r?.unassigned ?? 0 }))
      ;['sheet', 'weekly', 'pending', 'collection', 'customers', 'users'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      stopSelecting()
    },
    onError: (e) => toast.error(errMsg(e, t)),
  })

  return (
    <div>
      <PageHeader title={t('nav.sheet')} subtitle={meta ? `${meta.total} ${t('sheet.khataCount')}` : undefined} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={status} onChange={(v) => { setStatus(v); setTone('') }} options={[{ value: 'active', label: t('sheet.active') }, { value: 'closed', label: t('sheet.completed') }]} />
        {canAssign && status === 'active' && (
          <button onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className={cn('ml-auto inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition', selecting ? 'bg-navy-800 text-white' : 'bg-white text-navy-800 ring-1 ring-slate-200')}>
            <UserCheck className="h-4 w-4" />{t('sheet.assign')}
          </button>
        )}
        <button
          onClick={() => setGrid((g) => !g)}
          className={cn('inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition', !(canAssign && status === 'active') && 'ml-auto', grid ? 'bg-navy-800 text-white' : 'bg-white text-navy-800 ring-1 ring-slate-200')}
        >
          {grid ? <List className="h-4 w-4" /> : <Grid3x3 className="h-4 w-4" />}
          {grid ? t('sheet.listView') : t('sheet.gridView')}
        </button>
      </div>

      <SearchInput value={q} onChange={setQ} />

      {/* colour legend = filter */}
      {status === 'active' && (
        <div className="-mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="flex min-w-max gap-2">
            <button onClick={() => setTone('')} className={cn('h-9 rounded-full px-3.5 text-sm font-semibold', tone === '' ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>{t('all')}</button>
            {TONES.map((k) => (
              <button key={k} onClick={() => setTone(tone === k ? '' : k)} className={cn('inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset', TONE_STYLE[k].chip, tone === k && 'ring-2 ring-navy-800')}>
                <span className={cn('h-2.5 w-2.5 rounded-full', TONE_STYLE[k].dot)} />
                {t(`sheet.tone.${k}`)} <b>{tones[k] ?? 0}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-sm">
        <ArrowDownUp className="h-4 w-4 text-slate-400" />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
          <option value="remaining">{t('sheet.sortRemaining')}</option>
          <option value="pending">{t('sheet.sortPending')}</option>
          <option value="name">{t('sheet.sortName')}</option>
        </select>
        <button onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} className="h-9 rounded-lg bg-white px-3 font-semibold text-navy-800 ring-1 ring-slate-200">{dir === 'asc' ? '↑' : '↓'}</button>
        {canAssign && (
          <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="h-9 max-w-[9rem] rounded-lg border border-slate-200 bg-white px-2 text-sm" aria-label={t('sheet.assignedTo')}>
            <option value="">{t('sheet.allStaff')}</option>
            <option value="0">{t('sheet.noStaff')}</option>
            {(staff.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {meta && status === 'active' && <span className="ml-auto text-xs text-slate-500">{t('sheet.pendingTotal')}: <b className="text-pend"><Money v={meta.pending_total} /></b></span>}
      </div>

      <Card className="mt-3 overflow-hidden">
        {list.isLoading && <div className="p-3"><ListSkeleton rows={8} h="h-10" /></div>}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {!list.isLoading && !list.isError && rows.length === 0 && <EmptyState title={t('sheet.empty')} />}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {selecting && <th className="w-10 py-2 pl-3"><input type="checkbox" className="h-5 w-5" checked={allSelected} onChange={() => setSel(allSelected ? new Set() : new Set(rows.map((c) => c.id)))} aria-label={t('sheet.selectAll')} /></th>}
                  <th className="sticky left-0 z-10 bg-slate-50 py-2 pl-3 pr-2">{t('sheet.customer')}</th>
                  {grid ? (
                    <>
                      {Array.from({ length: cols }, (_, i) => <th key={i} className="px-1 py-2 text-center">{i + 1}</th>)}
                      <th className="px-2 py-2 text-right">{t('sheet.pending')}</th>
                    </>
                  ) : (
                    <>
                      <th className="px-2 py-2 text-center">{t('sheet.paidWeeks')}</th>
                      <th className="px-2 py-2 text-center">{t('sheet.left')}</th>
                      <th className="hidden px-2 py-2 text-right sm:table-cell">{t('sheet.weekly')}</th>
                      <th className="px-2 py-2 text-right">{t('sheet.pending')}</th>
                      <th className="hidden px-2 py-2 text-right md:table-cell">{t('sheet.advance')}</th>
                      <th className="hidden px-2 py-2 text-right md:table-cell">{t('sheet.outstanding')}</th>
                    </>
                  )}
                  {canCollect && <th className="w-12 px-2 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => {
                  const st = TONE_STYLE[c.tone] ?? TONE_STYLE.green
                  const go = () => nav(can('loans.view') ? `/khata/${c.id}` : `/customers/${c.customer_id}`)
                  return (
                    <tr key={c.id} className={cn('active:bg-slate-50', sel.has(c.id) && 'bg-navy-50/60')}>
                      {selecting && <td className="w-10 py-2 pl-3"><input type="checkbox" className="h-5 w-5" checked={sel.has(c.id)} onChange={() => toggle(c.id)} /></td>}
                      <td className={cn('sticky left-0 z-10 cursor-pointer whitespace-nowrap border-l-4 bg-white py-2 pl-2 pr-2', sel.has(c.id) && '!bg-navy-50', st.bar)} onClick={selecting ? () => toggle(c.id) : go}>
                        <div className="max-w-[9.5rem] truncate font-semibold leading-tight text-navy-900 sm:max-w-[16rem]">{c.customer?.name}</div>
                        <div className="max-w-[9.5rem] truncate text-[11px] leading-tight text-slate-500 sm:max-w-[16rem]">{c.khata_no}{c.customer?.village ? ` · ${c.customer.village}` : ''}{canAssign ? ` · ${c.customer?.recovery_name ?? '—'}` : ''}</div>
                      </td>
                      {grid ? (
                        <>
                          {Array.from({ length: cols }, (_, i) => <td key={i} className="px-1 py-1.5">{c.weeks?.[i] ? <Cell w={c.weeks[i]} /> : null}</td>)}
                          <td className={cn('whitespace-nowrap px-2 py-2 text-right font-bold tabular-nums', num(c.net_due_now) > 0 ? st.text : 'text-slate-300')}>{num(c.net_due_now) > 0 ? <Money v={c.net_due_now} /> : '—'}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-2 text-center font-bold tabular-nums text-ok">{c.paid_installments}<span className="font-normal text-slate-400">/{c.installments_count}</span></td>
                          <td className="px-2 py-2 text-center font-bold tabular-nums text-navy-800">{c.remaining_installments}</td>
                          <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums sm:table-cell"><Money v={c.weekly_amount} /></td>
                          <td className="whitespace-nowrap px-2 py-2 text-right">
                            {num(c.net_due_now) > 0 ? (
                              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset', st.chip)}>
                                <Money v={c.net_due_now} /> <span className="font-medium">· {c.pending_weeks}{t('sheet.wk')}</span>
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums text-adv md:table-cell">{num(c.advance_balance) > 0 ? <Money v={c.advance_balance} /> : '—'}</td>
                          <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums md:table-cell"><Money v={c.total_outstanding} /></td>
                        </>
                      )}
                      {canCollect && (
                        <td className="px-2 py-1.5 text-right">
                          <button onClick={() => setSheet(c)} aria-label={t('collection.collect')} className="grid h-9 w-9 place-items-center rounded-lg bg-green-600 text-white active:scale-95"><Banknote className="h-[18px] w-[18px]" /></button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selecting && (
        <StickyBar>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-navy-900">{sel.size} {t('sheet.selected')}</span>
            <Select value={target} onChange={(e) => setTarget(e.target.value)} className="!h-10 min-w-0 flex-1 text-sm" aria-label={t('sheet.chooseStaff')}>
              <option value="">{t('sheet.chooseStaff')}</option>
              {(staff.data ?? []).filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Button size="sm" className="!h-10" disabled={sel.size === 0 || !target} loading={assign.isPending} onClick={() => assign.mutate(target)}>{t('sheet.assignBtn')}</Button>
            <Button size="sm" variant="secondary" className="!h-10" disabled={sel.size === 0 || assign.isPending} onClick={() => assign.mutate('')}>{t('sheet.unassign')}</Button>
            <Button size="sm" variant="ghost" className="!h-10" onClick={stopSelecting}>{t('sheet.cancel')}</Button>
          </div>
        </StickyBar>
      )}

      {grid && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <span><Cell w={{ n: 0, due: '', status: 'paid', expected: '', paid: '' }} /></span>
          <span className="-ml-3">{t('sheet.legend.paid')}</span>
          <span className="flex items-center gap-1"><span className="grid h-5 w-5 place-items-center rounded bg-yellow-400 text-[10px] font-bold">½</span>{t('sheet.legend.partial')}</span>
          <span className="flex items-center gap-1"><span className="grid h-5 w-5 place-items-center rounded bg-red-600 text-[10px] font-bold text-white">✕</span>{t('sheet.legend.missed')}</span>
          <span className="flex items-center gap-1"><span className="grid h-5 w-5 place-items-center rounded bg-slate-100 text-slate-400 ring-1 ring-slate-200">·</span>{t('sheet.legend.upcoming')}</span>
        </div>
      )}

      <CollectSheet open={!!sheet} onClose={() => setSheet(null)} loan={sheet} />
    </div>
  )
}

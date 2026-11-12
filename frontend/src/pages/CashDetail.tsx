import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import { getPage, post } from '@/lib/api'
import { fdate, money, todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, Money, PageHeader, Pagination, Row, Segmented, Sheet, Textarea, cn, errMsg } from '@/components/ui'

const monthStart = () => todayISO().slice(0, 8) + '01'
const weekStart = () => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CashDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayISO())
  const [page, setPage] = useState(1)
  const [adjOpen, setAdjOpen] = useState(false)
  const [adj, setAdj] = useState({ amount: '', note: '' })
  const [adjErr, setAdjErr] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)

  const q = useQuery({ queryKey: ['cash-ledger', id, from, to, page], queryFn: () => getPage(`/cash-locations/${id}/ledger`, { from, to, page, per_page: 30 }) })

  const preset = (k: 'today' | 'week' | 'month') => {
    setPage(1)
    setTo(todayISO())
    setFrom(k === 'today' ? todayISO() : k === 'week' ? weekStart() : monthStart())
  }

  const m = useMutation({
    mutationFn: () => post(`/cash-locations/${id}/adjust`, { amount: Number(adj.amount), note: adj.note.trim() }),
    onSuccess: () => {
      toast.success(t('cash.adjustDone'))
      setConfirm(false)
      setAdjOpen(false)
      setAdj({ amount: '', note: '' })
      qc.invalidateQueries({ queryKey: ['cash-ledger'] })
      qc.invalidateQueries({ queryKey: ['cash-locations'] })
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(errMsg(e, t))
    },
  })

  const submitAdj = () => {
    const er: Record<string, string> = {}
    if (!adj.amount || Number(adj.amount) === 0) er.amount = t('validation.number')
    if (adj.note.trim().length < 3) er.note = t('cash.errNote')
    setAdjErr(er)
    if (!Object.keys(er).length) setConfirm(true)
  }

  const rec = q.data?.reconciliation
  const loc = q.data?.location

  return (
    <div>
      <PageHeader
        back="/cash"
        title={loc?.name ?? t('nav.cash')}
        subtitle={loc ? t(`cashTypes.${loc.type}`) + (loc.responsible_name ? ` · ${loc.responsible_name}` : '') : undefined}
        actions={
          can('cash.adjust') && (
            <Button variant="secondary" size="sm" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAdjOpen(true)}>
              {t('cash.adjust')}
            </Button>
          )
        }
      />

      {loc && (
        <Card className="mb-4 bg-gradient-to-r from-navy-800 to-navy-600 p-5 text-white">
          <div className="text-sm text-white/70">{t('cash.currentBalance')}</div>
          <div className="text-3xl font-bold tabular-nums">{money(loc.current_balance)}</div>
        </Card>
      )}

      <Card className="mb-4 space-y-3 p-4">
        <Segmented
          value={'' as string}
          onChange={(v) => preset(v as any)}
          options={[
            { value: 'today', label: t('today') },
            { value: 'week', label: t('thisWeek') },
            { value: 'month', label: t('thisMonth') },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('from')}>
            <Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
          </Field>
          <Field label={t('to')}>
            <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
          </Field>
        </div>
      </Card>

      {rec && (
        <Card className="mb-4 p-4">
          <div className="mb-1 text-sm font-bold text-navy-900">{t('cash.reconciliation')}</div>
          <div className="divide-y divide-slate-100">
            <Row label={t('cash.rec.opening')}><Money v={rec.opening_balance} /></Row>
            <Row label={t('cash.rec.collection')}><Money v={rec.collection} tone="ok" /></Row>
            <Row label={t('cash.rec.transferIn')}><Money v={rec.transfer_in} tone="ok" /></Row>
            <Row label={t('cash.rec.transferOut')}><Money v={rec.transfer_out} tone="over" /></Row>
            <Row label={t('cash.rec.expenses')}><Money v={rec.expenses} tone="over" /></Row>
            <Row label={t('cash.rec.disbursement')}><Money v={rec.disbursement} tone="over" /></Row>
            <Row label={t('cash.rec.adjustments')}><Money v={rec.adjustments} /></Row>
            <Row label={<b className="text-navy-900">{t('cash.rec.closing')}</b>}><Money v={rec.closing_balance} className="text-lg font-bold text-navy-900" /></Row>
          </div>
        </Card>
      )}

      {q.isLoading ? (
        <ListSkeleton rows={5} h="h-16" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.data.length === 0 ? (
        <EmptyState title={t('cash.noEntries')} />
      ) : (
        <>
          {/* desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t('date')}</th>
                  <th className="px-4 py-3">{t('cash.entryType')}</th>
                  <th className="px-4 py-3">{t('cash.description')}</th>
                  <th className="px-4 py-3 text-right">{t('cash.inflow')}</th>
                  <th className="px-4 py-3 text-right">{t('cash.outflow')}</th>
                  <th className="px-4 py-3 text-right">{t('cash.balance')}</th>
                  <th className="px-4 py-3">{t('createdBy')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.data.map((e: any) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{fdate(e.date)}</td>
                    <td className="px-4 py-3"><Badge tone="navy">{t(`ledgerTypes.${e.type}`, { defaultValue: String(e.type) })}</Badge></td>
                    <td className="px-4 py-3 text-slate-600">{e.description}</td>
                    <td className="px-4 py-3 text-right text-ok tabular-nums">{Number(e.inflow) ? money(e.inflow) : ''}</td>
                    <td className="px-4 py-3 text-right text-over tabular-nums">{Number(e.outflow) ? money(e.outflow) : ''}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(e.balance)}</td>
                    <td className="px-4 py-3 text-slate-500">{e.created_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* mobile cards */}
          <div className="space-y-2 md:hidden">
            {q.data!.data.map((e: any) => {
              const inflow = Number(e.inflow) > 0
              return (
                <Card key={e.id} className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="navy">{t(`ledgerTypes.${e.type}`, { defaultValue: String(e.type) })}</Badge>
                      <span className="text-xs text-slate-500">{fdate(e.date)}</span>
                    </div>
                    <span className={cn('font-bold tabular-nums', inflow ? 'text-ok' : 'text-over')}>
                      {inflow ? '+' : '−'}
                      {money(inflow ? e.inflow : e.outflow)}
                    </span>
                  </div>
                  {e.description && <div className="mt-1.5 text-sm text-slate-600">{e.description}</div>}
                  <div className="mt-1.5 flex justify-between text-xs text-slate-500">
                    <span>{e.created_by}</span>
                    <span>
                      {t('cash.balance')}: <b className="text-slate-700">{money(e.balance)}</b>
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
          <Pagination page={q.data!.meta.page} last={q.data!.meta.last_page} onPage={setPage} />
        </>
      )}

      <Sheet open={adjOpen} onClose={() => setAdjOpen(false)} title={t('cash.adjustTitle')} footer={<Button size="lg" full className="mb-1" onClick={submitAdj}>{t('cash.adjust')}</Button>}>
        <div className="space-y-4">
          <p className="rounded-xl bg-orange-50 p-3 text-xs text-orange-800">{t('cash.adjustInfo')}</p>
          <Field label={t('amount')} required error={adjErr.amount} hint={t('cash.adjustSign')}>
            <Input type="number" inputMode="decimal" step="0.01" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} className="text-lg font-semibold" />
          </Field>
          <Field label={t('reason')} required error={adjErr.note}>
            <Textarea value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
          </Field>
        </div>
      </Sheet>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={m.isPending} danger onConfirm={() => m.mutate()} message={t('cash.adjustConfirm', { amount: money(adj.amount) })} />
    </div>
  )
}

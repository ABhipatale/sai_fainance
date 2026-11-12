import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Plus, Undo2, Wallet } from 'lucide-react'
import { get, getPage, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, num } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, Money, PageHeader, Pagination, SearchInput, SearchSelect, Sheet, StatCard, errMsg } from '@/components/ui'
import CollectSheet from '@/components/CollectSheet'
import { ContactButtons, Metric, useDebounced, type LoanCard } from '@/components/FlowParts'

/** Advance ledger of one khata: Deposit / Applied / Refund / Balance. */
function LedgerSheet({ loan, onClose }: { loan: LoanCard | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: ['advance', 'ledger', loan?.customer_id, loan?.id, page],
    queryFn: () => getPage<any>(`/customers/${loan!.customer_id}/advance-ledger`, { loan_account_id: loan!.id, page, per_page: 15 }),
    enabled: !!loan,
    placeholderData: keepPreviousData,
  })
  return (
    <Sheet open={!!loan} onClose={onClose} wide title={`${t('advance.ledgerTitle')} · ${loan?.khata_no ?? ''}`}>
      {q.isLoading && <ListSkeleton rows={4} h="h-14" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.data.length === 0 && <EmptyState title={t('advance.ledgerEmpty')} />}
      {q.data && q.data.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2">{t('date')}</th>
                <th>{t('advance.type')}</th>
                <th className="text-right">{t('advance.deposit')}</th>
                <th className="text-right">{t('advance.usedOrRefund')}</th>
                <th className="text-right">{t('advance.balanceCol')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((e: any) => (
                <tr key={e.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap">{fdate(e.date)}</td>
                  <td>
                    <div className="font-medium">{String(t(`ledgerTypes.${e.type}`, { defaultValue: e.type }))}</div>
                    {e.description && <div className="max-w-[200px] truncate text-xs text-slate-400">{e.description}</div>}
                  </td>
                  <td className="text-right tabular-nums text-ok">{num(e.credit) > 0 ? <Money v={e.credit} /> : '—'}</td>
                  <td className="text-right tabular-nums text-adv">{num(e.debit) > 0 ? <Money v={e.debit} /> : '—'}</td>
                  <td className="text-right font-semibold tabular-nums"><Money v={e.balance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && <Pagination page={page} last={q.data.meta.last_page} onPage={setPage} />}
    </Sheet>
  )
}

function RefundDialog({ loan, onClose }: { loan: LoanCard | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [locId, setLocId] = useState<string | number | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const locs = useQuery({ queryKey: ['cash-locations', 'collection'], queryFn: () => get<any[]>('/cash-locations', { for: 'collection' }), enabled: !!loan })

  const go = async () => {
    if (busy) return
    if (!(num(amount) > 0) || num(amount) > num(loan!.advance_balance) || !locId) {
      setErr(!locId ? t('validation.required') : t('validation.positive'))
      return
    }
    setBusy(true)
    setErr('')
    try {
      await post(`/loan-accounts/${loan!.id}/advance-refund`, { amount, cash_location_id: locId, note: note || undefined })
      toast.success(t('advance.refundDone'))
      ;['advance', 'dashboard', 'collection', 'pending', 'loan'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      setAmount('')
      setNote('')
      onClose()
    } catch (e) {
      setErr(errMsg(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog open={!!loan} onClose={onClose} onConfirm={go} loading={busy} danger title={t('advance.refundTitle')} confirmLabel={t('advance.refund')}
      message={loan ? `${loan.customer?.name} · ${loan.khata_no} — ${t('advance.balance')}: ₹${num(loan.advance_balance).toLocaleString('en-IN')}` : undefined}>
      <div className="mt-4 space-y-3">
        <Field label={t('advance.refundAmount')} required>
          <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          {loan && <button type="button" className="mt-1 text-xs font-semibold text-navy-600" onClick={() => setAmount(String(num(loan.advance_balance)))}>{t('collection.sheet.fillFull')} {loan.advance_balance}</button>}
        </Field>
        <Field label={t('advance.refundLocation')} required>
          <SearchSelect options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} value={locId} onChange={setLocId} />
        </Field>
        <Field label={t('notes')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('optional')} />
        </Field>
        {err && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-over">{err}</div>}
      </div>
    </ConfirmDialog>
  )
}

export default function Advance() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [collect, setCollect] = useState<LoanCard | null>(null)
  const [ledger, setLedger] = useState<LoanCard | null>(null)
  const [refund, setRefund] = useState<LoanCard | null>(null)
  const [picker, setPicker] = useState(false)
  const [pq, setPq] = useState('')
  const dpq = useDebounced(pq.trim(), 300)

  const list = useQuery({ queryKey: ['advance', 'list'], queryFn: () => get<LoanCard[]>('/advance-balances') })
  const found = useQuery({ queryKey: ['collection', 'search', dpq], queryFn: () => get<LoanCard[]>('/collection/search', { q: dpq }), enabled: picker && dpq.length > 0 })

  const s = q.trim().toLowerCase()
  const rows = (list.data ?? []).filter((c) => !s || `${c.customer?.name} ${c.customer?.mobile} ${c.khata_no}`.toLowerCase().includes(s))
  const total = (list.data ?? []).reduce((a, c) => a + num(c.advance_balance), 0)

  return (
    <div>
      <PageHeader
        title={t('nav.advance')}
        subtitle={t('advance.subtitle')}
        actions={can('payments.collect') ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPicker(true)}>{t('advance.newAdvance')}</Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label={t('advance.totalAdvance')} value={<Money v={total} />} tone="adv" icon={<Wallet className="h-5 w-5" />} />
        <StatCard label={t('advance.customers')} value={list.data?.length ?? '—'} tone="adv" />
      </div>

      <SearchInput value={q} onChange={setQ} />

      <div className="mt-4 space-y-3">
        {list.isLoading && <ListSkeleton rows={3} h="h-40" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && rows.length === 0 && <EmptyState icon={<Wallet className="h-7 w-7" />} title={t('advance.empty')} text={t('advance.emptyText')} />}
        {rows.map((c) => (
          <Card key={c.id} className="border-l-4 border-l-adv p-4">
            <div className="flex items-start gap-3">
              <Avatar src={c.customer?.photo_url} name={c.customer?.name} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold text-navy-900">{c.customer?.name}</div>
                <div className="truncate text-xs text-slate-500">{c.khata_no} · {c.customer?.mobile}</div>
                <Badge tone="adv" className="mt-1">{t('advance.balance')}</Badge>
              </div>
              <div className="text-right text-xl font-extrabold text-adv"><Money v={c.advance_balance} /></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label={t('collection.weekly')}><Money v={c.weekly_amount} /></Metric>
              <Metric label={t('pending.nextDue')}>{fdate(c.next_due_date)}</Metric>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {can('payments.collect') && <Button size="sm" className="!bg-adv" icon={<Plus className="h-4 w-4" />} onClick={() => setCollect(c)}>{t('advance.addAdvance')}</Button>}
              <Button size="sm" variant="secondary" icon={<BookOpen className="h-4 w-4" />} onClick={() => setLedger(c)}>{t('advance.ledger')}</Button>
              {can('advance.refund') && <Button size="sm" variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setRefund(c)}>{t('advance.refund')}</Button>}
              <ContactButtons customer={c.customer} className="ml-auto" />
            </div>
          </Card>
        ))}
      </div>

      {/* pick a khata → advance deposit */}
      <Sheet open={picker} onClose={() => { setPicker(false); setPq('') }} title={t('advance.newAdvance')}>
        <SearchInput value={pq} onChange={setPq} placeholder={t('advance.searchKhata')} autoFocus />
        <div className="mt-3 space-y-2">
          {found.isLoading && <ListSkeleton rows={2} h="h-16" />}
          {found.data?.length === 0 && <EmptyState title={t('noResults')} />}
          {found.data?.map((c) => (
            <button key={c.id} onClick={() => { setPicker(false); setCollect(c) }} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-navy-50">
              <Avatar src={c.customer?.photo_url} name={c.customer?.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{c.customer?.name}</div>
                <div className="truncate text-xs text-slate-500">{c.khata_no} · {c.customer?.mobile}</div>
              </div>
              <Money v={c.weekly_amount} className="text-sm font-semibold" />
            </button>
          ))}
        </div>
      </Sheet>

      <CollectSheet open={!!collect} onClose={() => setCollect(null)} loan={collect} mode="advance" />
      <LedgerSheet loan={ledger} onClose={() => setLedger(null)} />
      <RefundDialog loan={refund} onClose={() => setRefund(null)} />
    </div>
  )
}

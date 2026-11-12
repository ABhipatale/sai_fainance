import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MapPin, MessageCircle, Phone, Plus, SlidersHorizontal, Users } from 'lucide-react'
import { get, getPage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { mapsUrl, telUrl, waUrl } from '@/lib/format'
import { useDebounce } from '@/components/useDebounce'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Money, PageHeader, Pagination, SearchInput, Select } from '@/components/ui'

export default function Customers() {
  const { t } = useTranslation()
  const { can, session } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [showF, setShowF] = useState(false)
  const [village, setVillage] = useState('')
  const [area, setArea] = useState('')
  const [rec, setRec] = useState('')
  const [unassigned, setUnassigned] = useState(false)
  const dq = useDebounce(q)

  const staff = useQuery({ queryKey: ['staff-list'], queryFn: () => get<any[]>('/users', { role: 'recovery' }), enabled: can('recovery.view') })
  const list = useQuery({
    queryKey: ['customers', dq, page, village, area, rec, unassigned],
    queryFn: () => getPage('/customers', { q: dq || undefined, page, village: village || undefined, area: area || undefined, recovery_user_id: rec || undefined, unassigned: unassigned ? 1 : undefined }),
    placeholderData: (p) => p,
  })

  const areas = session?.config.recovery_areas ?? []
  const items = list.data?.data ?? []

  return (
    <div>
      <PageHeader
        title={t('nav.customers')}
        subtitle={list.data ? `${list.data.meta.total} ${t('customers.countLabel')}` : undefined}
        actions={can('customers.create') && <Button icon={<Plus className="h-5 w-5" />} onClick={() => nav('/customers/new')}><span className="hidden sm:inline">{t('customers.add')}</span></Button>}
      />
      <div className="mb-3 flex gap-2">
        <div className="flex-1"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} /></div>
        <Button variant="secondary" onClick={() => setShowF((s) => !s)} icon={<SlidersHorizontal className="h-5 w-5" />} aria-label={t('filters')} className="h-12" />
      </div>
      {showF && (
        <Card className="mb-3 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder={t('village')} value={village} onChange={(e) => { setVillage(e.target.value); setPage(1) }} />
          <Select value={area} onChange={(e) => { setArea(e.target.value); setPage(1) }}>
            <option value="">{t('customers.area')}: {t('all')}</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          {can('recovery.view') && (
            <Select value={rec} onChange={(e) => { setRec(e.target.value); setPage(1) }}>
              <option value="">{t('recoveryPerson')}: {t('all')}</option>
              {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <label className="flex h-12 items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-5 w-5" checked={unassigned} onChange={(e) => { setUnassigned(e.target.checked); setPage(1) }} />
            {t('customers.unassigned')}
          </label>
        </Card>
      )}

      {list.isLoading ? <ListSkeleton /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<Users className="h-7 w-7" />} title={t('customers.empty')} action={can('customers.create') && <Button onClick={() => nav('/customers/new')} icon={<Plus className="h-5 w-5" />}>{t('customers.add')}</Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((c: any) => (
            <Card key={c.id} className="p-4">
              <Link to={`/customers/${c.id}`} className="flex items-center gap-3">
                <Avatar src={c.photo_url} name={c.name} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-bold text-navy-900">{c.name}</div>
                  <div className="text-sm text-slate-500">{c.mobile}{c.village ? ` • ${c.village}` : ''}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={c.active_khata ? 'navy' : 'gray'}>{c.active_khata} {t('customers.activeKhata')}</Badge>
                    {c.khata_nos?.slice(0, 2).map((k: string) => <Badge key={k}>{k}</Badge>)}
                  </div>
                </div>
              </Link>
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                <div><div className="text-[11px] text-slate-500">{t('customers.outstanding')}</div><Money v={c.outstanding} className="text-sm font-bold" /></div>
                <div><div className="text-[11px] text-slate-500">{t('customers.dueNow')}</div><Money v={c.due_now} tone={Number(c.due_now) > 0 ? 'pend' : undefined} className="text-sm font-bold" /></div>
                <div><div className="text-[11px] text-slate-500">{t('advance')}</div><Money v={c.advance_balance} tone={Number(c.advance_balance) > 0 ? 'adv' : undefined} className="text-sm font-bold" /></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <a href={telUrl(c.mobile)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-navy-50 text-sm font-semibold text-navy-800"><Phone className="h-4 w-4" />{t('call')}</a>
                <a href={waUrl(c.mobile)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-green-50 text-sm font-semibold text-ok"><MessageCircle className="h-4 w-4" />{t('whatsapp')}</a>
                {mapsUrl(c.lat, c.lng) ? (
                  <a href={mapsUrl(c.lat, c.lng)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-orange-50 text-sm font-semibold text-pend"><MapPin className="h-4 w-4" />{t('customers.map')}</a>
                ) : <span className="flex h-11 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-300"><MapPin className="h-4 w-4" /></span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Pagination page={list.data?.meta.page ?? 1} last={list.data?.meta.last_page ?? 1} onPage={setPage} />
    </div>
  )
}

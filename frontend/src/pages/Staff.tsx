import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, Phone, Plus, UserCheck, UserX } from 'lucide-react'
import { get, getPage, post, postForm } from '@/lib/api'
import { compressImage, money, telUrl, strongPassword } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import {
  Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, Money, PageHeader, SearchInput, SearchSelect, Segmented, Select, Sheet, StatusBadge, cn, errMsg, Row,
} from '@/components/ui'

type Role = 'recovery' | 'manager' | 'admin'

export default function Staff() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const roles: Role[] = ['recovery', ...(can('managers.manage') ? (['manager'] as Role[]) : []), ...(can('users.manage') ? (['admin'] as Role[]) : [])]
  const [role, setRole] = useState<Role>('recovery')
  const [form, setForm] = useState<any | null | false>(false)
  const [perf, setPerf] = useState<any | null>(null)
  const [assign, setAssign] = useState<any | null>(null)
  const [toggle, setToggle] = useState<any | null>(null)

  const q = useQuery({ queryKey: ['users', role], queryFn: () => get<any[]>('/users', { role }) })
  const canManage = role === 'recovery' ? can('recovery.manage') : role === 'manager' ? can('managers.manage') : can('users.manage')

  return (
    <div>
      <PageHeader
        title={t('nav.staff')}
        actions={canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm(null)}>{t('add')}</Button>}
      />
      {roles.length > 1 && (
        <Segmented className="mb-4" value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: t(`staff.tab.${r}`) }))} />
      )}

      {q.isLoading ? (
        <ListSkeleton rows={4} h="h-24" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title={t('staff.empty')} icon={<UserCheck className="h-7 w-7" />} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data!.map((u) => (
            <Card key={u.id} className="p-4" onClick={() => (u.role === 'recovery' ? setPerf(u) : setForm(u))}>
              <div className="flex gap-3">
                <Avatar src={u.photo_url} name={u.name} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-semibold text-navy-900">{u.name}</div>
                    <StatusBadge status={u.status} />
                  </div>
                  <div className="text-xs text-slate-500">@{u.username}{u.mobile ? ` · ${u.mobile}` : ''}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {u.assigned_area && <Badge tone="navy">{u.assigned_area}</Badge>}
                    {u.role === 'recovery' && <Badge tone="gray">{t('staff.customersN', { count: u.assigned_customers })}</Badge>}
                    {u.cash_location && <Badge tone="adv">{u.cash_location}</Badge>}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {u.mobile && (
                  <a href={telUrl(u.mobile)} onClick={(e) => e.stopPropagation()} className="grid h-10 w-10 place-items-center rounded-xl bg-green-50 text-ok" aria-label={t('call')}>
                    <Phone className="h-4 w-4" />
                  </a>
                )}
                {canManage && (
                  <Button size="sm" variant="secondary" className="flex-1" onClick={(e) => { e.stopPropagation(); setForm(u) }}>{t('edit')}</Button>
                )}
                {canManage && u.id !== undefined && (
                  <Button size="sm" variant={u.status === 'active' ? 'ghost' : 'secondary'} className={cn(u.status === 'active' && 'text-over')} icon={u.status === 'active' ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setToggle(u) }}>
                    {u.status === 'active' ? t('staff.deactivate') : t('staff.activate')}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {form !== false && <StaffForm key={form?.id ?? 'new'} edit={form} role={form?.role ?? role} onClose={() => setForm(false)} />}
      {perf && <PerformanceSheet user={perf} onClose={() => setPerf(null)} onAssign={() => { setAssign(perf); setPerf(null) }} onEdit={() => { setForm(perf); setPerf(null) }} canManage={canManage} />}
      {assign && <AssignSheet user={assign} onClose={() => setAssign(null)} />}
      <ToggleDialog user={toggle} onClose={() => setToggle(null)} />
    </div>
  )
}

/* -------------------------------------------------------------- activate / deactivate */
function ToggleDialog({ user, onClose }: { user: any | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: () =>
      postForm(`/users/${user.id}`, { name: user.name, username: user.username, role: user.role, status: user.status === 'active' ? 'inactive' : 'active' }, 'PUT'),
    onSuccess: () => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (e) => {
      toast.error(errMsg(e, t))
      onClose()
    },
  })
  if (!user) return null
  const deact = user.status === 'active'
  return (
    <ConfirmDialog open onClose={onClose} danger={deact} loading={m.isPending} onConfirm={() => m.mutate()} message={t(deact ? 'staff.deactivateQ' : 'staff.activateQ', { name: user.name })} confirmLabel={deact ? t('staff.deactivate') : t('staff.activate')} />
  )
}

/* -------------------------------------------------------------- create / edit */
function StaffForm({ edit, role, onClose }: { edit: any | null; role: Role; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { session, can } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(edit?.photo_url ?? null)
  const [f, setF] = useState({
    name: edit?.name ?? '', mobile: edit?.mobile ?? '', username: edit?.username ?? '', password: '',
    assigned_area: edit?.assigned_area ?? '', cash_location_id: edit?.cash_location_id ?? null, manager_id: edit?.manager_id ?? null,
    status: edit?.status ?? 'active',
  })
  const [err, setErr] = useState<Record<string, string>>({})

  const locs = useQuery({ queryKey: ['cash-locations'], queryFn: () => get<{ locations: any[] }>('/cash-locations'), enabled: can('cash.view') })
  const mgrs = useQuery({ queryKey: ['users', 'manager'], queryFn: () => get<any[]>('/users', { role: 'manager' }), enabled: role === 'recovery' && can('managers.manage') })
  const areas = session?.config.recovery_areas ?? []

  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name.trim(), mobile: f.mobile, username: f.username.trim(), role, status: f.status,
        assigned_area: f.assigned_area, cash_location_id: f.cash_location_id, manager_id: f.manager_id, photo,
      }
      if (f.password) body.password = f.password
      return edit ? postForm(`/users/${edit.id}`, body, 'PUT') : postForm('/users', body)
    },
    onSuccess: () => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (e: any) => {
      const fe = e?.errors ?? {}
      const mapped: Record<string, string> = {}
      Object.keys(fe).forEach((k) => (mapped[k] = fe[k][0]))
      setErr(mapped)
      toast.error(errMsg(e, t))
    },
  })

  const submit = () => {
    const er: Record<string, string> = {}
    if (!f.name.trim()) er.name = t('validation.required')
    if (f.mobile && !/^\d{10}$/.test(f.mobile)) er.mobile = t('validation.mobile')
    if (f.username.trim().length < 3 || !/^[\w-]+$/.test(f.username.trim())) er.username = t('staff.errUsername')
    if (!edit && !strongPassword(f.password)) er.password = t('validation.password')
    if (edit && f.password && !strongPassword(f.password)) er.password = t('validation.password')
    setErr(er)
    if (!Object.keys(er).length) m.mutate()
  }

  const pick = async (file?: File) => {
    if (!file) return
    const c = await compressImage(file)
    setPhoto(c)
    setPreview(URL.createObjectURL(c))
  }

  return (
    <Sheet open onClose={onClose} title={edit ? t('staff.edit') : t('staff.add')} footer={
      <div className="flex gap-3 pb-1"><Button variant="secondary" full onClick={onClose}>{t('cancel')}</Button><Button full loading={m.isPending} onClick={submit}>{t('save')}</Button></div>
    }>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar src={preview} name={f.name} size={72} />
            <button type="button" onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-navy-800 text-white shadow"><Camera className="h-4 w-4" /></button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <div className="text-xs text-slate-500">{t('staff.photoHint')}</div>
        </div>
        <Field label={t('name')} required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!err.name} /></Field>
        <Field label={t('mobile')} error={err.mobile}><Input inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '') })} invalid={!!err.mobile} /></Field>
        <Field label={t('staff.username')} required error={err.username}><Input autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} invalid={!!err.username} /></Field>
        <Field label={edit ? t('staff.resetPassword') : t('staff.password')} required={!edit} error={err.password} hint={edit ? t('staff.resetHint') : undefined}>
          <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} invalid={!!err.password} />
        </Field>
        {role !== 'admin' && (
          <Field label={t('staff.area')}>
            {areas.length > 0 ? (
              <SearchSelect options={areas.map((a) => ({ value: a, label: a }))} value={f.assigned_area || null} onChange={(v) => setF({ ...f, assigned_area: (v as string) ?? '' })} clearable />
            ) : (
              <Input value={f.assigned_area} onChange={(e) => setF({ ...f, assigned_area: e.target.value })} />
            )}
          </Field>
        )}
        {role === 'recovery' && can('cash.view') && (
          <Field label={t('cashLocation')}>
            <SearchSelect options={(locs.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name, sub: t(`cashTypes.${l.type}`) }))} value={f.cash_location_id} onChange={(v) => setF({ ...f, cash_location_id: v as number | null })} clearable />
          </Field>
        )}
        {role === 'recovery' && can('managers.manage') && (
          <Field label={t('staff.manager')}>
            <SearchSelect options={(mgrs.data ?? []).map((u) => ({ value: u.id, label: u.name }))} value={f.manager_id} onChange={(v) => setF({ ...f, manager_id: v as number | null })} clearable />
          </Field>
        )}
        <Field label={t('status')}>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">{t('status.active')}</option>
            <option value="inactive">{t('status.inactive')}</option>
          </Select>
        </Field>
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------- performance */
function PerformanceSheet({ user, onClose, onAssign, onEdit, canManage }: { user: any; onClose: () => void; onAssign: () => void; onEdit: () => void; canManage: boolean }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['performance', user.id], queryFn: () => get<any>(`/users/${user.id}/performance`) })
  const p = q.data
  return (
    <Sheet open onClose={onClose} title={user.name} footer={
      <div className="flex gap-3 pb-1">
        {canManage && <Button variant="secondary" full onClick={onEdit}>{t('edit')}</Button>}
        {can('recovery.assign') && <Button full onClick={onAssign}>{t('staff.assignCustomers')}</Button>}
      </div>
    }>
      {q.isLoading ? <ListSkeleton rows={3} h="h-14" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : p && (
        <div>
          <div className="mb-3 flex items-center gap-3"><Avatar src={user.photo_url} name={user.name} size={56} /><div className="text-sm text-slate-500">{user.assigned_area || '—'}<br />{user.mobile}</div></div>
          {p.performance_pct !== null && (
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-xs font-semibold text-slate-500"><span>{t('staff.performance')}</span><span>{p.performance_pct}%</span></div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-ok" style={{ width: `${Math.min(100, p.performance_pct)}%` }} /></div>
            </div>
          )}
          <div className="divide-y divide-slate-100">
            <Row label={t('staff.assignedCustomers')}>{p.assigned_customers}</Row>
            <Row label={t('staff.activeKhata')}>{p.active_khata}</Row>
            <Row label={t('staff.expectedToday')}><Money v={p.expected_today} /></Row>
            <Row label={t('staff.collectedToday')}><Money v={p.collected_today} tone="ok" /></Row>
            <Row label={t('staff.remainingToday')}><Money v={p.remaining_today} tone="pend" /></Row>
            <Row label={t('staff.totalPending')}><Money v={p.total_pending} tone="over" /></Row>
            <Row label={t('staff.weekCollected')}><Money v={p.week_collected} tone="ok" /></Row>
            {p.cash_balance !== null && p.cash_balance !== undefined && <Row label={t('staff.cashBalance')}>{money(p.cash_balance)}</Row>}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/* -------------------------------------------------------------- assign customers */
function AssignSheet({ user, onClose }: { user: any; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [onlyFree, setOnlyFree] = useState(true)
  const [sel, setSel] = useState<number[]>([])
  const [confirm, setConfirm] = useState(false)

  const list = useQuery({
    queryKey: ['assign-customers', q, onlyFree],
    queryFn: () => getPage('/customers', { q: q || undefined, unassigned: onlyFree ? 1 : undefined, per_page: 50 }),
  })
  const m = useMutation({
    mutationFn: () => post('/recovery/assign', { recovery_user_id: user.id, customer_ids: sel }),
    onSuccess: (r: any) => {
      toast.success(t('staff.assignedN', { count: r?.assigned ?? sel.length }))
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['assign-customers'] })
      qc.invalidateQueries({ queryKey: ['performance'] })
      onClose()
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(errMsg(e, t))
    },
  })
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <>
      <Sheet open onClose={onClose} wide title={`${t('staff.assignCustomers')} · ${user.name}`} footer={
        <Button size="lg" full className="mb-1" disabled={!sel.length} onClick={() => setConfirm(true)}>{t('staff.assignN', { count: sel.length })}</Button>
      }>
        <div className="space-y-3">
          <SearchInput value={q} onChange={setQ} />
          <Segmented value={onlyFree ? 'free' : 'all'} onChange={(v) => setOnlyFree(v === 'free')} options={[{ value: 'free', label: t('staff.unassignedOnly') }, { value: 'all', label: t('staff.reassignAll') }]} />
          {list.isLoading ? <ListSkeleton rows={4} h="h-14" /> : (list.data?.data ?? []).length === 0 ? <EmptyState title={t('noResults')} /> : (
            <div className="space-y-2">
              {list.data!.data.map((c: any) => {
                const on = sel.includes(c.id)
                return (
                  <button key={c.id} onClick={() => toggle(c.id)} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', on ? 'border-navy-500 bg-navy-50' : 'border-slate-200 bg-white')}>
                    <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border', on ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-300')}>{on && <Check className="h-4 w-4" />}</span>
                    <Avatar src={c.photo_url} name={c.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500">{[c.village, c.mobile].filter(Boolean).join(' · ')}</span>
                    </span>
                    {c.recovery_user_id && c.recovery_user_id !== user.id && <Badge tone="pend">{t('staff.assigned')}</Badge>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </Sheet>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={m.isPending} onConfirm={() => m.mutate()} message={t('staff.assignConfirm', { count: sel.length, name: user.name })} />
    </>
  )
}

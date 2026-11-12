import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronDown, Plus, Trash2, Users } from 'lucide-react'
import { get, getPage, post, postForm, put } from '@/lib/api'
import { compressImage, fdatetime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { LANGS } from '@/i18n'
import {
  Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, PageHeader, Pagination, Select, Tabs, cn, errMsg,
} from '@/components/ui'

type Tab = 'profile' | 'general' | 'loan' | 'collection' | 'penalty' | 'security' | 'audit'

export default function SettingsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const admin = can('settings.view')
  const tabs: { value: Tab; label: string }[] = [
    { value: 'profile', label: t('settings.tabs.profile') },
    ...(admin
      ? ([
          { value: 'general', label: t('settings.tabs.general') },
          { value: 'loan', label: t('settings.tabs.loan') },
          { value: 'collection', label: t('settings.tabs.collection') },
          { value: 'penalty', label: t('settings.tabs.penalty') },
          { value: 'security', label: t('settings.tabs.security') },
        ] as { value: Tab; label: string }[])
      : []),
    ...(can('audit.view') ? [{ value: 'audit' as Tab, label: t('settings.tabs.audit') }] : []),
  ]
  const [tab, setTab] = useState<Tab>('profile')

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<any>('/settings'), enabled: admin })

  return (
    <div>
      <PageHeader title={t('nav.settings')} />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === 'profile' && <Profile />}
      {admin && ['general', 'loan', 'collection', 'penalty'].includes(tab) &&
        (settings.isLoading ? <ListSkeleton rows={3} h="h-24" /> : settings.error ? <ErrorState error={settings.error} onRetry={() => settings.refetch()} /> : settings.data && (
          <>
            {tab === 'general' && <General data={settings.data} />}
            {tab === 'loan' && <LoanSettings data={settings.data} />}
            {tab === 'collection' && <CollectionSettings data={settings.data} />}
            {tab === 'penalty' && <PenaltySettings data={settings.data} />}
          </>
        ))}
      {tab === 'security' && <Security />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}

/* -------------------------------------------------------------- helpers */
function useSave() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => put('/settings', body),
    onSuccess: () => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['settings'] })
      refresh()
    },
    onError: (e) => toast.error(errMsg(e, t)),
  })
}

function Section({ title, hint, children, footer }: { title: ReactNode; hint?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <div className="mb-3">
        <div className="text-base font-bold text-navy-900">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-5">{footer}</div>}
    </Card>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition', on ? 'bg-ok' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

const numOrNull = (v: string) => (v === '' ? null : Number(v))

/* -------------------------------------------------------------- profile */
function Profile() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const toast = useToast()
  const [f, setF] = useState({ current_password: '', password: '', password_confirmation: '' })
  const [err, setErr] = useState<Record<string, string>>({})

  const lang = useMutation({ mutationFn: (language: string) => post('/me/language', { language }), onError: () => {} })
  const pw = useMutation({
    mutationFn: () => post('/me/password', f),
    onSuccess: () => {
      toast.success(t('settings.passwordChanged'))
      setF({ current_password: '', password: '', password_confirmation: '' })
    },
    onError: (e: any) => {
      const fe = e?.errors ?? {}
      setErr(Object.fromEntries(Object.keys(fe).map((k) => [k, fe[k][0]])))
      toast.error(errMsg(e, t))
    },
  })
  const submit = () => {
    const er: Record<string, string> = {}
    if (!f.current_password) er.current_password = t('validation.required')
    if (f.password.length < 8) er.password = t('validation.password')
    if (f.password !== f.password_confirmation) er.password_confirmation = t('validation.passwordMatch')
    setErr(er)
    if (!Object.keys(er).length) pw.mutate()
  }
  const u = session!.user

  return (
    <>
      <Section title={t('settings.profile')}>
        <div className="flex items-center gap-4">
          <Avatar src={u.photo_url} name={u.name} size={64} />
          <div>
            <div className="text-lg font-bold text-navy-900">{u.name}</div>
            <div className="text-sm text-slate-500">@{u.username}</div>
            <Badge tone="navy" className="mt-1">{t(`roles.${u.role}`)}</Badge>
          </div>
        </div>
        <Field label={t('language')}>
          <div className="flex gap-2">
            {LANGS.map((l) => (
              <button key={l.code} onClick={() => { i18n.changeLanguage(l.code); lang.mutate(l.code) }} className={cn('h-12 flex-1 rounded-xl border text-sm font-semibold', i18n.language === l.code ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-300 bg-white text-slate-700')}>
                {l.label}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title={t('settings.changePassword')} footer={<Button full size="lg" loading={pw.isPending} onClick={submit}>{t('settings.changePassword')}</Button>}>
        <Field label={t('settings.currentPassword')} error={err.current_password}><Input type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
        <Field label={t('settings.newPassword')} error={err.password}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label={t('settings.confirmPassword')} error={err.password_confirmation}><Input type="password" autoComplete="new-password" value={f.password_confirmation} onChange={(e) => setF({ ...f, password_confirmation: e.target.value })} /></Field>
      </Section>

      <Section title={t('settings.installTitle')}>
        <p className="text-sm text-slate-600">{t('settings.installHint')}</p>
      </Section>
    </>
  )
}

/* -------------------------------------------------------------- general */
function General({ data }: { data: any }) {
  const { t, i18n } = useTranslation()
  const save = useSave()
  const toast = useToast()
  const qc = useQueryClient()
  const { refresh, can } = useAuth()
  const ro = !can('settings.manage')
  const g = data.general ?? {}
  const [f, setF] = useState({ name: g.name ?? '', address: g.address ?? '', phone: g.phone ?? '', language: g.language ?? 'mr', currency: g.currency ?? 'INR', date_format: g.date_format ?? 'DD/MM/YYYY' })
  const fileRef = useRef<HTMLInputElement>(null)
  const [logo, setLogo] = useState<string | null>(g.logo_url ?? null)
  useEffect(() => setLogo(g.logo_url ?? null), [g.logo_url])

  const up = useMutation({
    mutationFn: async (file: File) => postForm<{ logo_url: string }>('/settings/logo', { logo: await compressImage(file, 512) }),
    onSuccess: (r) => {
      setLogo(r.logo_url)
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['settings'] })
      refresh()
    },
    onError: (e) => toast.error(errMsg(e, t)),
  })

  return (
    <Section title={t('settings.general')} footer={!ro && <Button full size="lg" loading={save.isPending} onClick={() => f.name.trim() && save.mutate({ general: f })}>{t('save')}</Button>}>
      <div className="flex items-center gap-4">
        {logo ? <img src={logo} className="h-16 w-16 rounded-xl border border-slate-200 bg-white object-contain p-1" /> : <img src="/favicon.svg" className="h-16 w-16 rounded-xl" />}
        {!ro && (
          <>
            <Button variant="secondary" icon={<Camera className="h-4 w-4" />} loading={up.isPending} onClick={() => fileRef.current?.click()}>{t('settings.uploadLogo')}</Button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} />
          </>
        )}
      </div>
      <Field label={t('settings.financeName')} required error={!f.name.trim() ? t('validation.required') : undefined}><Input disabled={ro} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('address')}><Input disabled={ro} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label={t('settings.contact')}><Input disabled={ro} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t('settings.defaultLanguage')}>
        <Select disabled={ro} value={f.language} onChange={(e) => { setF({ ...f, language: e.target.value }); }}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings.currency')}><Input disabled={ro} maxLength={5} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
        <Field label={t('settings.dateFormat')} hint={t('settings.dateFormatHint')}><Input disabled value={f.date_format} /></Field>
      </div>
      <p className="text-xs text-slate-500">{t('settings.currentLanguage')}: {LANGS.find((l) => l.code === i18n.language)?.label}</p>
    </Section>
  )
}

/* -------------------------------------------------------------- loan defaults */
function LoanSettings({ data }: { data: any }) {
  const { t } = useTranslation()
  const save = useSave()
  const { can } = useAuth()
  const ro = !can('settings.manage')
  const d = data.loan_defaults ?? {}
  const [f, setF] = useState({ installments_count: String(d.installments_count ?? ''), installment_weekday: String(d.installment_weekday ?? 2), weekly_amount: String(d.weekly_amount ?? ''), repayment_ratio: String(d.repayment_ratio ?? '') })
  return (
    <Section title={t('settings.loanSettings')} hint={t('settings.loanHint')} footer={!ro && (
      <Button full size="lg" loading={save.isPending} onClick={() => save.mutate({ loan_defaults: { installments_count: numOrNull(f.installments_count), installment_weekday: Number(f.installment_weekday), weekly_amount: numOrNull(f.weekly_amount), repayment_ratio: numOrNull(f.repayment_ratio) } })}>{t('save')}</Button>
    )}>
      <Field label={t('settings.defaultInstallments')}><Input disabled={ro} type="number" inputMode="numeric" min="1" value={f.installments_count} onChange={(e) => setF({ ...f, installments_count: e.target.value })} /></Field>
      <Field label={t('settings.defaultDay')}>
        <Select disabled={ro} value={f.installment_weekday} onChange={(e) => setF({ ...f, installment_weekday: e.target.value })}>
          {(t('weekdays', { returnObjects: true }) as unknown as string[]).map((w, i) => <option key={i} value={i}>{w}</option>)}
        </Select>
      </Field>
      <Field label={t('settings.defaultWeekly')}><Input disabled={ro} type="number" inputMode="decimal" min="0" value={f.weekly_amount} onChange={(e) => setF({ ...f, weekly_amount: e.target.value })} /></Field>
      <Field label={t('settings.repaymentRatio')} hint={t('settings.ratioHint')}><Input disabled={ro} type="number" inputMode="decimal" step="0.01" min="1" value={f.repayment_ratio} onChange={(e) => setF({ ...f, repayment_ratio: e.target.value })} /></Field>
    </Section>
  )
}

/* -------------------------------------------------------------- collection */
const PAY = ['cash', 'upi', 'bank', 'other']

function CollectionSettings({ data }: { data: any }) {
  const { t } = useTranslation()
  const save = useSave()
  const { can } = useAuth()
  const ro = !can('settings.manage')
  const [types, setTypes] = useState<string[]>(data.payment_types ?? PAY)
  const [areas, setAreas] = useState<string[]>(data.recovery_areas ?? [])
  const [area, setArea] = useState('')
  const [footer, setFooter] = useState<string>(data.receipt_format?.footer ?? '')
  const [showLogo, setShowLogo] = useState<boolean>(data.receipt_format?.show_logo ?? true)
  const [weekday, setWeekday] = useState(String(data.collection_weekday ?? 2))
  const [sortBy, setSortBy] = useState<string>(data.pending_sort?.by ?? 'remaining_installments')
  const [sortDir, setSortDir] = useState<string>(data.pending_sort?.dir ?? 'asc')

  const toggleType = (p: string) => setTypes((s) => (s.includes(p) ? (s.length > 1 ? s.filter((x) => x !== p) : s) : [...s, p]))
  const addArea = () => {
    const a = area.trim()
    if (a && !areas.includes(a)) setAreas([...areas, a])
    setArea('')
  }

  return (
    <Section title={t('settings.collectionSettings')} footer={!ro && (
      <Button full size="lg" loading={save.isPending} onClick={() => save.mutate({ payment_types: types, recovery_areas: areas, receipt_format: { footer, show_logo: showLogo }, collection_weekday: Number(weekday), pending_sort: { by: sortBy, dir: sortDir } })}>{t('save')}</Button>
    )}>
      <Field label={t('settings.paymentTypes')}>
        <div className="grid grid-cols-2 gap-2">
          {PAY.map((p) => (
            <button key={p} disabled={ro} type="button" onClick={() => toggleType(p)} className={cn('h-12 rounded-xl border text-sm font-semibold', types.includes(p) ? 'border-navy-800 bg-navy-50 text-navy-800' : 'border-slate-300 text-slate-500')}>{t(`payTypes.${p}`)}</button>
          ))}
        </div>
      </Field>
      <Field label={t('settings.recoveryAreas')}>
        <div className="mb-2 flex flex-wrap gap-2">
          {areas.length === 0 && <span className="text-sm text-slate-400">{t('settings.noAreas')}</span>}
          {areas.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 rounded-full bg-navy-50 py-1 pl-3 pr-1 text-sm font-medium text-navy-800">
              {a}
              {!ro && <button onClick={() => setAreas(areas.filter((x) => x !== a))} className="grid h-6 w-6 place-items-center rounded-full hover:bg-navy-100" aria-label="remove"><Trash2 className="h-3.5 w-3.5" /></button>}
            </span>
          ))}
        </div>
        {!ro && (
          <div className="flex gap-2">
            <Input value={area} onChange={(e) => setArea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addArea())} placeholder={t('settings.areaPlaceholder')} />
            <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addArea}>{t('add')}</Button>
          </div>
        )}
      </Field>
      <Field label={t('settings.collectionDay')}>
        <Select disabled={ro} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
          {(t('weekdays', { returnObjects: true }) as unknown as string[]).map((w, i) => <option key={i} value={i}>{w}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings.pendingSort')}>
          <Select disabled={ro} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {['remaining_installments', 'overdue_amount', 'pending_amount', 'next_due_date', 'name', 'village'].map((s) => <option key={s} value={s}>{t(`settings.sort.${s}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.sortDir')}>
          <Select disabled={ro} value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
            <option value="asc">{t('settings.asc')}</option>
            <option value="desc">{t('settings.desc')}</option>
          </Select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-500">{t('settings.sortHint')}</p>
      <Switch on={showLogo} onChange={ro ? () => {} : setShowLogo} label={t('settings.receiptLogo')} />
      <Field label={t('settings.receiptFooter')}><Input disabled={ro} value={footer} onChange={(e) => setFooter(e.target.value)} /></Field>
    </Section>
  )
}

/* -------------------------------------------------------------- penalty */
function PenaltySettings({ data }: { data: any }) {
  const { t } = useTranslation()
  const save = useSave()
  const { can } = useAuth()
  const ro = !can('settings.manage')
  const [on, setOn] = useState<boolean>(data.penalty?.manager_can_add ?? true)
  return (
    <Section title={t('settings.penaltySettings')} hint={t('settings.penaltyHint')} footer={!ro && <Button full size="lg" loading={save.isPending} onClick={() => save.mutate({ penalty: { ...(data.penalty ?? {}), manager_can_add: on } })}>{t('save')}</Button>}>
      <Switch on={on} onChange={ro ? () => {} : setOn} label={t('settings.managerAddPenalty')} />
      <p className="text-xs text-slate-500">{t('settings.penaltyApprovalHint')}</p>
    </Section>
  )
}

/* -------------------------------------------------------------- security: role permissions */
const RECOVERY_LOCKED = ['settings.manage', 'users.manage', 'managers.manage', 'audit.view', 'cash.opening', 'loans.close']

function Security() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { can } = useAuth()
  const ro = !can('settings.manage')
  const q = useQuery({ queryKey: ['permissions'], queryFn: () => get<any>('/settings/permissions'), enabled: can('settings.manage') })
  const [roles, setRoles] = useState<{ manager: string[]; recovery: string[] } | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (q.data) setRoles({ manager: [...q.data.roles.manager], recovery: [...q.data.roles.recovery] })
  }, [q.data])

  const m = useMutation({
    mutationFn: async () => {
      await put('/settings/permissions', { role: 'manager', permissions: roles!.manager })
      await put('/settings/permissions', { role: 'recovery', permissions: roles!.recovery })
    },
    onSuccess: () => {
      toast.success(t('success'))
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['permissions'] })
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(errMsg(e, t))
    },
  })

  const toggle = (role: 'manager' | 'recovery', key: string) =>
    setRoles((r) => (r ? { ...r, [role]: r[role].includes(key) ? r[role].filter((k) => k !== key) : [...r[role], key] } : r))

  const groups: Record<string, string[]> = {}
  q.data?.permissions.forEach((p: any) => (groups[p.group] ??= []).push(p.key))

  return (
    <>
      <Section title={t('settings.usersTitle')} hint={t('settings.usersHint')}>
        <Link to="/staff"><Button variant="secondary" full icon={<Users className="h-4 w-4" />}>{t('nav.staff')}</Button></Link>
      </Section>

      {!ro && (
        <Section title={t('settings.rolePermissions')} hint={t('settings.permHint')} footer={<Button full size="lg" disabled={!roles} onClick={() => setConfirm(true)}>{t('save')}</Button>}>
          {q.isLoading || !roles ? <ListSkeleton rows={3} h="h-12" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-xs uppercase text-slate-500">
                    <th className="px-2 py-2 text-left">{t('settings.permission')}</th>
                    <th className="w-16 px-2 text-center">{t('roles.admin')}</th>
                    <th className="w-16 px-2 text-center">{t('roles.manager')}</th>
                    <th className="w-16 px-2 text-center">{t('roles.recovery')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groups).map(([g, keys]) => (
                    <GroupRows key={g} group={g} keys={keys} roles={roles} toggle={toggle} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={m.isPending} danger onConfirm={() => m.mutate()} message={t('settings.permConfirm')} />
    </>
  )
}

function GroupRows({ group, keys, roles, toggle }: { group: string; keys: string[]; roles: { manager: string[]; recovery: string[] }; toggle: (r: 'manager' | 'recovery', k: string) => void }) {
  const { t } = useTranslation()
  return (
    <>
      <tr><td colSpan={4} className="bg-slate-50 px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-navy-800">{t(`settings.group.${group}`, { defaultValue: group })}</td></tr>
      {keys.map((k) => (
        <tr key={k} className="border-b border-slate-100">
          <td className="px-2 py-2.5">{t(`settings.perm.${k}`, { defaultValue: k })}</td>
          <td className="text-center"><input type="checkbox" checked disabled className="h-5 w-5 accent-navy-800" /></td>
          <td className="text-center"><input type="checkbox" checked={roles.manager.includes(k)} onChange={() => toggle('manager', k)} className="h-5 w-5 accent-navy-800" /></td>
          <td className="text-center"><input type="checkbox" checked={roles.recovery.includes(k)} disabled={RECOVERY_LOCKED.includes(k)} onChange={() => toggle('recovery', k)} className="h-5 w-5 accent-navy-800" /></td>
        </tr>
      ))}
    </>
  )
}

/* -------------------------------------------------------------- audit logs */
function Audit() {
  const { t } = useTranslation()
  const [f, setF] = useState({ action: '', from: '', to: '' })
  const [applied, setApplied] = useState(f)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['audit', applied, page], queryFn: () => getPage('/audit-logs', { action: applied.action || undefined, from: applied.from || undefined, to: applied.to || undefined, page, per_page: 30 }) })

  return (
    <div>
      <Card className="mb-4 space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('settings.auditAction')}><Input placeholder="payment., loan., penalty. …" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></Field>
          <Field label={t('from')}><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label={t('to')}><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { setApplied(f); setPage(1) }}>{t('apply')}</Button>
          <Button variant="ghost" onClick={() => { const z = { action: '', from: '', to: '' }; setF(z); setApplied(z); setPage(1) }}>{t('reset')}</Button>
        </div>
      </Card>
      {q.isLoading ? <ListSkeleton rows={5} h="h-16" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (q.data?.data ?? []).length === 0 ? <EmptyState title={t('noResults')} /> : (
        <>
          <div className="space-y-2">
            {q.data!.data.map((a: any) => (
              <Card key={a.id} className="p-3.5">
                <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="navy">{a.action}</Badge>{a.entity_type && <span className="text-xs text-slate-500">{a.entity_type} #{a.entity_id}</span>}</div>
                    <div className="mt-1 text-xs text-slate-500">{fdatetime(a.created_at)} · {a.user ?? '—'}{a.role ? ` (${t(`roles.${a.role}`)})` : ''} · {a.ip}</div>
                  </div>
                  <ChevronDown className={cn('h-5 w-5 shrink-0 text-slate-400 transition', open === a.id && 'rotate-180')} />
                </button>
                {open === a.id && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {[['settings.auditOld', a.old], ['settings.auditNew', a.new]].map(([label, val]) => (
                      <div key={label as string}>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{t(label as string)}</div>
                        <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{val ? JSON.stringify(val, null, 2) : '—'}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Pagination page={q.data!.meta.page} last={q.data!.meta.last_page} onPage={setPage} />
        </>
      )}
    </div>
  )
}

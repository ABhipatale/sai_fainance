import {
  forwardRef, useEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Inbox, Loader2, Search, X } from 'lucide-react'
import { initials, money } from '@/lib/format'
import { ApiError } from '@/lib/api'

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ buttons */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warn'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  full?: boolean
}
const BTN_V = {
  primary: 'bg-navy-800 text-white hover:bg-navy-900 active:bg-navy-900 shadow-sm',
  secondary: 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-50',
  ghost: 'bg-transparent text-navy-800 hover:bg-navy-50',
  danger: 'bg-over text-white hover:bg-red-700',
  success: 'bg-ok text-white hover:bg-green-700',
  warn: 'bg-pend text-white hover:bg-orange-600',
}
const BTN_S = { sm: 'h-9 px-3 text-sm rounded-lg', md: 'h-11 px-4 text-[15px] rounded-xl', lg: 'h-14 px-5 text-base rounded-2xl font-semibold' }

export function Button({ variant = 'primary', size = 'md', loading, icon, full, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center gap-2 font-medium transition disabled:opacity-50 disabled:pointer-events-none select-none', BTN_V[variant], BTN_S[size], full && 'w-full', className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ surfaces */
export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('rounded-2xl bg-white shadow-card border border-slate-100', onClick && 'cursor-pointer active:scale-[.995] transition', className)}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: boolean | string }) {
  const nav = useNavigate()
  return (
    <div className="mb-4 flex items-center gap-3">
      {back && (
        <button onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white border border-slate-200 text-navy-800" aria-label="back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold text-navy-900 md:text-2xl">{title}</h1>
        {subtitle && <div className="truncate text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ forms */
export function Field({ label, error, hint, required, children, className }: { label?: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-over"> *</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-over">{error}</span>}
    </label>
  )
}

const inputCls = 'w-full h-12 rounded-xl border border-slate-300 bg-white px-3.5 text-slate-900 placeholder:text-slate-400 outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-100 disabled:bg-slate-100'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...p }, ref) => (
  <input ref={ref} {...p} className={cn(inputCls, invalid && 'border-over focus:border-over focus:ring-red-100', className)} />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} rows={3} {...p} className={cn(inputCls, 'h-auto py-3', className)} />
))
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} {...p} className={cn(inputCls, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%272.5%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)}>
    {children}
  </select>
))
Select.displayName = 'Select'

export function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('searchPlaceholder')}
        className={cn(inputCls, 'pl-11 pr-10')}
        inputMode="search"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100" aria-label="clear">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Searchable dropdown – type to filter, tap to pick. */
export interface Option { value: string | number; label: string; sub?: string }
export function SearchSelect({ options, value, onChange, placeholder, disabled, invalid, clearable }: {
  options: Option[]; value: string | number | null | undefined; onChange: (v: string | number | null) => void
  placeholder?: string; disabled?: boolean; invalid?: boolean; clearable?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const sel = options.find((o) => String(o.value) === String(value ?? ''))
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter((o) => (o.label + ' ' + (o.sub ?? '')).toLowerCase().includes(s)) : options
  }, [q, options])

  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={cn(inputCls, 'flex items-center justify-between text-left', invalid && 'border-over')}>
        <span className={cn('truncate', !sel && 'text-slate-400')}>{sel ? sel.label : placeholder ?? t('select')}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="h-10 w-full rounded-lg bg-slate-100 px-3 outline-none" />
          </div>
          <div className="max-h-60 overflow-auto">
            {clearable && value && (
              <button type="button" onClick={() => { onChange(null); setOpen(false) }} className="block w-full px-3 py-2.5 text-left text-sm text-slate-500 hover:bg-slate-50">
                — {t('none')} —
              </button>
            )}
            {list.length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">{t('noResults')}</div>}
            {list.map((o) => (
              <button type="button" key={o.value} onClick={() => { onChange(o.value); setOpen(false); setQ('') }} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-navy-50">
                <span>
                  <span className="block text-[15px]">{o.label}</span>
                  {o.sub && <span className="block text-xs text-slate-500">{o.sub}</span>}
                </span>
                {String(o.value) === String(value) && <Check className="h-4 w-4 text-navy-600" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 rounded-xl bg-slate-200/70 p-1', className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} className={cn('h-10 flex-1 rounded-lg px-3 text-sm font-medium transition', o.value === value ? 'bg-white text-navy-800 shadow' : 'text-slate-600')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ badges & numbers */
export type Tone = 'ok' | 'pend' | 'over' | 'adv' | 'navy' | 'gray'
const TONE: Record<Tone, string> = {
  ok: 'bg-green-50 text-green-700 ring-green-200',
  pend: 'bg-orange-50 text-orange-700 ring-orange-200',
  over: 'bg-red-50 text-red-700 ring-red-200',
  adv: 'bg-violet-50 text-violet-700 ring-violet-200',
  navy: 'bg-navy-50 text-navy-800 ring-navy-200',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
}
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONE[tone], className)}>{children}</span>
}

const STATUS_TONE: Record<string, Tone> = {
  upcoming: 'gray', pending: 'pend', partially_paid: 'pend', partial: 'pend', open: 'pend', paid: 'ok', completed: 'ok', active: 'ok',
  overdue: 'over', reversed: 'over', advanced_covered: 'adv', settled: 'navy', closed: 'gray', inactive: 'gray', waived: 'navy',
}
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  return <Badge tone={STATUS_TONE[status] ?? 'gray'}>{t(`status.${status}`, status)}</Badge>
}

export function Money({ v, tone, className, decimals }: { v: string | number | null | undefined; tone?: Tone; className?: string; decimals?: boolean }) {
  const c = { ok: 'text-ok', pend: 'text-pend', over: 'text-over', adv: 'text-adv', navy: 'text-navy-800', gray: 'text-slate-600' }
  return <span className={cn('tabular-nums', tone && c[tone], className)}>{money(v, { decimals })}</span>
}

export function StatCard({ label, value, tone = 'navy', icon, sub, onClick }: { label: ReactNode; value: ReactNode; tone?: Tone; icon?: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const bg = { ok: 'bg-green-50 text-ok', pend: 'bg-orange-50 text-pend', over: 'bg-red-50 text-over', adv: 'bg-violet-50 text-adv', navy: 'bg-navy-50 text-navy-800', gray: 'bg-slate-100 text-slate-600' }
  return (
    <Card className="p-4" onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 truncate text-xl font-bold tabular-nums text-navy-900 md:text-2xl">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
        </div>
        {icon && <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', bg[tone])}>{icon}</div>}
      </div>
    </Card>
  )
}

export function Avatar({ src, name, size = 44 }: { src?: string | null; name?: string | null; size?: number }) {
  const [bad, setBad] = useState(false)
  return src && !bad ? (
    <img src={src} alt="" onError={() => setBad(true)} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover bg-slate-200" />
  ) : (
    <div style={{ width: size, height: size, fontSize: size * 0.38 }} className="grid shrink-0 place-items-center rounded-full bg-navy-100 font-semibold text-navy-800">
      {initials(name)}
    </div>
  )
}

/* ------------------------------------------------------------------ states */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}
export function ListSkeleton({ rows = 5, h = 'h-24' }: { rows?: number; h?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('w-full rounded-2xl', h)} />
      ))}
    </div>
  )
}
export function EmptyState({ title, text, action, icon }: { title?: ReactNode; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">{icon ?? <Inbox className="h-7 w-7" />}</div>
      <div className="font-semibold text-slate-700">{title ?? t('noData')}</div>
      {text && <div className="mt-1 max-w-sm text-sm text-slate-500">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-over" />
      <div className="text-sm font-medium text-red-800">{errMsg(error, t)}</div>
      {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>{t('retry')}</Button>}
    </div>
  )
}

export function errMsg(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) return e.network ? t('offline') : e.message
  return e instanceof Error ? e.message : t('error')
}

/* ------------------------------------------------------------------ overlays */
export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', k)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className={cn('sheet-in relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl md:rounded-3xl', wide ? 'md:max-w-2xl' : 'md:max-w-md')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-lg font-bold text-navy-900">{title}</div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100" aria-label="close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="pb-safe border-t border-slate-100 px-5 pt-3">{footer}</div>}
      </div>
    </div>
  )
}

/** Required before delete / cancel / reverse / close-account style actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger, loading, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title?: ReactNode; message?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? t('confirmTitle')}
      footer={
        <div className="flex gap-3 pb-1">
          <Button variant="secondary" full onClick={onClose}>{t('cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} full loading={loading} onClick={onConfirm}>{confirmLabel ?? t('confirm')}</Button>
        </div>
      }
    >
      {message && <p className="text-[15px] text-slate-700">{message}</p>}
      {children}
    </Sheet>
  )
}

export function Pagination({ page, last, onPage }: { page: number; last: number; onPage: (p: number) => void }) {
  const { t } = useTranslation()
  if (last <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('prev')}</Button>
      <span className="text-sm text-slate-500">{t('page')} {page} {t('of')} {last}</span>
      <Button variant="secondary" size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>{t('next')}</Button>
    </div>
  )
}

/** Sticky action bar above the mobile bottom-nav (for payment / save actions). */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-[4.5rem] z-30 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border">{children}</div>
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="flex min-w-max gap-1 border-b border-slate-200">
        {tabs.map((tb) => (
          <button key={tb.value} onClick={() => onChange(tb.value)} className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition', tb.value === value ? 'border-navy-800 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {tb.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Key/value row used in detail panels. */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2 text-sm', className)}>
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children}</span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart3, Banknote, CloudOff, Download, FilePlus2, Home, Landmark, LogOut, MoreHorizontal, RefreshCw, Settings, ShieldAlert, Users, UserCog, Wallet, Clock,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { syncQueue, useQueue } from '@/lib/offline'
import { LANGS } from '@/i18n'
import { Avatar, Sheet, cn } from './ui'

interface NavItem { to: string; key: string; icon: typeof Home; perm?: string; end?: boolean }

const NAV: NavItem[] = [
  { to: '/', key: 'dashboard', icon: Home, perm: 'dashboard.view', end: true },
  { to: '/customers', key: 'customers', icon: Users, perm: 'customers.view' },
  { to: '/khata/new', key: 'newKhata', icon: FilePlus2, perm: 'loans.create' },
  { to: '/collection', key: 'collection', icon: Banknote, perm: 'payments.collect' },
  { to: '/pending', key: 'pending', icon: Clock, perm: 'payments.view' },
  { to: '/advance', key: 'advance', icon: Wallet, perm: 'payments.view' },
  { to: '/cash', key: 'cash', icon: Landmark, perm: 'cash.view' },
  { to: '/staff', key: 'staff', icon: UserCog, perm: 'recovery.view' },
  { to: '/reports', key: 'reports', icon: BarChart3, perm: 'reports.view' },
  { to: '/penalties', key: 'penalties', icon: ShieldAlert, perm: 'penalties.view' },
  { to: '/settings', key: 'settings', icon: Settings },
]

const BOTTOM = [
  { to: '/', key: 'home', icon: Home, perm: 'dashboard.view', end: true },
  { to: '/customers', key: 'customers', icon: Users, perm: 'customers.view' },
  { to: '/collection', key: 'collection', icon: Banknote, perm: 'payments.collect' },
  { to: '/pending', key: 'pendingShort', icon: Clock, perm: 'payments.view' },
]

let deferredPrompt: any = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  window.dispatchEvent(new Event('sf:installable'))
})

function useInstall() {
  const [can, setCan] = useState(!!deferredPrompt)
  useEffect(() => {
    const h = () => setCan(true)
    window.addEventListener('sf:installable', h)
    return () => window.removeEventListener('sf:installable', h)
  }, [])
  return {
    can,
    install: async () => {
      if (!deferredPrompt) return
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      deferredPrompt = null
      setCan(false)
    },
  }
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  return (
    <div className={cn('inline-flex rounded-lg bg-white/10 p-0.5', className)}>
      {LANGS.map((l) => (
        <button key={l.code} onClick={() => i18n.changeLanguage(l.code)} className={cn('rounded-md px-2.5 py-1 text-xs font-semibold transition', i18n.language === l.code ? 'bg-white text-navy-800' : 'text-white/80 hover:text-white')}>
          {l.label}
        </button>
      ))}
    </div>
  )
}

function LangSwitcherLight() {
  const { i18n } = useTranslation()
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1">
      {LANGS.map((l) => (
        <button key={l.code} onClick={() => i18n.changeLanguage(l.code)} className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold', i18n.language === l.code ? 'bg-white text-navy-800 shadow' : 'text-slate-500')}>
          {l.label}
        </button>
      ))}
    </div>
  )
}

function SyncBanner() {
  const { t } = useTranslation()
  const { pending, failed, online } = useQueue()
  if (online && !pending && !failed) return null
  return (
    <div className={cn('no-print flex items-center gap-2 px-4 py-2 text-sm font-medium text-white', online ? 'bg-pend' : 'bg-slate-700')}>
      {online ? <RefreshCw className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
      <span className="flex-1">
        {!online && t('pwa.offlineBanner')}
        {online && (pending > 0 || failed > 0) && t('pwa.pendingEntries', { count: pending + failed })}
      </span>
      {online && <button onClick={() => syncQueue()} className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold">{t('syncNow')}</button>}
    </div>
  )
}

export default function Layout() {
  const { t } = useTranslation()
  const { session, can, logout } = useAuth()
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const install = useInstall()
  const { pending } = useQueue()

  useEffect(() => setMore(false), [loc.pathname])

  const items = NAV.filter((n) => !n.perm || can(n.perm))
  const bottom = BOTTOM.filter((n) => can(n.perm))
  const label = (k: string) => t(`nav.${k}`, { defaultValue: k })

  return (
    <div className="flex min-h-full">
      {/* ---------- desktop sidebar ---------- */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-gradient-to-b from-navy-800 to-navy-900 text-white md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          {session?.finance.logo_url ? <img src={session.finance.logo_url} className="h-10 w-10 rounded-xl bg-white object-contain p-1" /> : <img src="/favicon.svg" className="h-10 w-10 rounded-xl" />}
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">{session?.finance.name || t('appName')}</div>
            <div className="text-xs text-white/60">{t(`roles.${session?.user.role}`)}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-auto px-3 py-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium transition', isActive ? 'bg-white text-navy-800 shadow' : 'text-white/80 hover:bg-white/10')}>
              <n.icon className="h-5 w-5" />
              {label(n.key)}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-white/10 p-4">
          <LanguageSwitcher />
          {install.can && (
            <button onClick={install.install} className="flex w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"><Download className="h-4 w-4" />{t('installApp')}</button>
          )}
          <div className="flex items-center gap-3">
            <Avatar src={session?.user.photo_url} name={session?.user.name} size={36} />
            <div className="min-w-0 flex-1 text-sm"><div className="truncate font-semibold">{session?.user.name}</div></div>
            <button onClick={logout} className="rounded-lg p-2 hover:bg-white/10" aria-label={t('logout')}><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </aside>

      {/* ---------- main ---------- */}
      <div className="flex min-w-0 flex-1 flex-col md:pl-64">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 bg-navy-800 px-4 py-3 text-white md:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
          <img src="/favicon.svg" className="h-8 w-8 rounded-lg" />
          <div className="flex-1 truncate font-bold">{session?.finance.name || t('appName')}</div>
          {pending > 0 && <span className="rounded-full bg-pend px-2 py-0.5 text-xs font-bold">{pending}</span>}
          <LanguageSwitcher />
        </header>
        <SyncBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-28 md:px-8 md:py-6 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* ---------- mobile bottom nav ---------- */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="grid grid-cols-5">
          {bottom.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold', isActive ? 'text-navy-800' : 'text-slate-400')}>
              {({ isActive }) => (
                <>
                  <span className={cn('grid h-8 w-14 place-items-center rounded-full transition', isActive && 'bg-navy-100')}><n.icon className="h-5 w-5" /></span>
                  {t(`nav.${n.key}`)}
                </>
              )}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold text-slate-400">
            <span className="grid h-8 w-14 place-items-center"><MoreHorizontal className="h-5 w-5" /></span>
            {t('nav.more')}
          </button>
        </div>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title={t('nav.more')}>
        <div className="grid grid-cols-3 gap-3">
          {items.filter((n) => !BOTTOM.some((b) => b.to === n.to)).map((n) => (
            <NavLink key={n.to} to={n.to} className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 p-3 text-center text-xs font-semibold text-navy-800 active:bg-navy-50">
              <n.icon className="h-6 w-6" />
              {label(n.key)}
            </NavLink>
          ))}
        </div>
        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-500">{t('language')}</div>
            <LangSwitcherLight />
          </div>
          {install.can && <button onClick={install.install} className="flex w-full items-center gap-2 rounded-xl bg-navy-50 px-4 py-3 font-medium text-navy-800"><Download className="h-5 w-5" />{t('installApp')}</button>}
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <Avatar src={session?.user.photo_url} name={session?.user.name} />
            <div className="flex-1"><div className="font-semibold">{session?.user.name}</div><div className="text-xs text-slate-500">{t(`roles.${session?.user.role}`)}</div></div>
            <button onClick={logout} className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-over"><LogOut className="h-4 w-4" />{t('logout')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

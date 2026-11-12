import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, ApiError, TOKEN_KEY } from './api'
import { clearQueue } from './offline'

export interface User {
  id: number
  name: string
  username: string
  mobile?: string
  role: 'admin' | 'manager' | 'recovery'
  photo_url?: string | null
  cash_location_id?: number | null
  language: 'mr' | 'en' | 'hi'
  assigned_area?: string | null
}

export interface AppConfig {
  collection_weekday: number
  payment_types: string[]
  recovery_areas: string[]
  pending_sort: { by: string; dir: 'asc' | 'desc' }
  loan_defaults: { installments_count?: number; installment_weekday?: number; weekly_amount?: number | null; repayment_ratio?: number | null }
}

interface Session {
  user: User
  permissions: string[]
  finance: { name?: string; address?: string; phone?: string; logo_url?: string | null }
  config: AppConfig
}

interface AuthCtx {
  session: Session | null
  loading: boolean
  can: (perm: string) => boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as never)
export const useAuth = () => useContext(Ctx)

const CACHE_KEY = 'sf_session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) ? JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(!!localStorage.getItem(TOKEN_KEY))
  const qc = useQueryClient()
  const { i18n } = useTranslation()

  const apply = useCallback((s: Session | null) => {
    setSession(s)
    if (s) localStorage.setItem(CACHE_KEY, JSON.stringify(s))
    else localStorage.removeItem(CACHE_KEY)
  }, [])

  const refresh = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false)
      return
    }
    try {
      const r = await api.get('/me')
      apply(r.data.data)
    } catch (e) {
      // offline → keep the cached session so the app still opens
      if (!(e instanceof ApiError && e.network)) apply(null)
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    refresh()
    const h = () => {
      apply(null)
      qc.clear()
    }
    window.addEventListener('sf:unauthorized', h)
    return () => window.removeEventListener('sf:unauthorized', h)
  }, [refresh, apply, qc])

  useEffect(() => {
    // user language preference wins over the browser default (Marathi is the app default)
    const stored = localStorage.getItem('sf_lang')
    if (!stored && session?.user.language && session.user.language !== i18n.language) i18n.changeLanguage(session.user.language)
  }, [session?.user.language, i18n])

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await api.post('/login', { username, password })
      localStorage.setItem(TOKEN_KEY, r.data.data.token)
      apply(r.data.data)
      qc.clear()
    },
    [apply, qc],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/logout')
    } catch {
      /* token may already be invalid */
    }
    localStorage.removeItem(TOKEN_KEY)
    apply(null)
    qc.clear()
    await clearQueue().catch(() => {})
    // never keep one user's cached API data for the next person using the phone
    if ('caches' in window) await Promise.all(['api-get', 'media'].map((c) => caches.delete(c)))
  }, [apply, qc])

  const can = useCallback((p: string) => !!session?.permissions.includes(p), [session])

  const value = useMemo(() => ({ session, loading, can, login, logout, refresh }), [session, loading, can, login, logout, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

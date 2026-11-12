import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button, Field, Input, errMsg } from '@/components/ui'
import { LanguageSwitcher } from '@/components/Layout'

export default function Login() {
  const { t } = useTranslation()
  const { session, login } = useAuth()
  const nav = useNavigate()
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')

  const schema = z.object({ username: z.string().min(1, t('validation.required')), password: z.string().min(1, t('validation.required')) })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })

  if (session) return <Navigate to="/" replace />

  const submit = f.handleSubmit(async (v) => {
    setErr('')
    try {
      await login(v.username.trim(), v.password)
      nav('/', { replace: true })
    } catch (e) {
      setErr(errMsg(e, t))
    }
  })

  return (
    <div className="relative grid min-h-full place-items-center bg-gradient-to-br from-navy-800 via-navy-900 to-slate-900 px-4 py-10">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <img src="/icons/icon-192.png" alt="" className="mx-auto mb-3 h-20 w-20 rounded-3xl shadow-2xl" />
          <h1 className="text-3xl font-bold">{t('appName')}</h1>
          <p className="mt-1 text-sm text-white/70">{t('login.subtitle')}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
          <Field label={t('login.username')} error={f.formState.errors.username?.message}>
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <Input {...f.register('username')} className="pl-11" autoComplete="username" autoCapitalize="none" autoFocus />
            </div>
          </Field>
          <Field label={t('login.password')} error={f.formState.errors.password?.message}>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <Input {...f.register('password')} type={show ? 'text' : 'password'} className="pl-11 pr-11" autoComplete="current-password" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center text-slate-400" aria-label="toggle password">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>
          {err && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-over">{err}</div>}
          <Button type="submit" size="lg" full loading={f.formState.isSubmitting}>{t('login.submit')}</Button>
        </form>
      </div>
    </div>
  )
}

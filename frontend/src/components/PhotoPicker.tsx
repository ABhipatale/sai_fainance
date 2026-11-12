import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { compressImage } from '@/lib/format'
import { cn } from './ui'

/** Camera / gallery picker with client-side compression. onChange receives the compressed File (or null). */
export default function PhotoPicker({ value, onChange, existingUrl, label, round, className }: {
  value: File | null
  onChange: (f: File | null) => void
  existingUrl?: string | null
  label?: string
  round?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!value) return setPreview(null)
    const u = URL.createObjectURL(value)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [value])

  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true)
    try {
      onChange(await compressImage(f))
    } catch {
      onChange(f)
    } finally {
      setBusy(false)
    }
  }

  const src = preview || existingUrl || null
  return (
    <div className={cn('inline-block', className)}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn('relative grid h-28 w-28 place-items-center overflow-hidden border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400 transition hover:border-navy-500', round ? 'rounded-full' : 'rounded-2xl')}
      >
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : (
          <span className="flex flex-col items-center gap-1 text-xs font-medium"><Camera className="h-7 w-7" />{label ?? t('photo')}</span>
        )}
        {busy && <span className="absolute inset-0 grid place-items-center bg-white/70 text-xs">…</span>}
      </button>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="mt-1 flex items-center gap-1 text-xs text-over"><X className="h-3 w-3" />{t('cancel')}</button>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

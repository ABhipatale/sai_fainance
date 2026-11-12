import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, X } from 'lucide-react'
import { getPage } from '@/lib/api'
import { cn } from '../ui'

export interface PickedCustomer { id: number; name: string; mobile?: string }

/** Server-side searchable customer dropdown (GET /customers?q=). */
export default function CustomerPicker({ value, onChange, invalid }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; invalid?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = setTimeout(() => setDq(q), 250)
    return () => clearTimeout(h)
  }, [q])
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const list = useQuery({ queryKey: ['customer-picker', dq], queryFn: () => getPage('/customers', { q: dq || undefined, per_page: 15 }), enabled: open })

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn('flex h-12 w-full items-center justify-between rounded-xl border bg-white px-3.5 text-left', invalid ? 'border-over' : 'border-slate-300')}>
        <span className={cn('truncate', !value && 'text-slate-400')}>{value ? `${value.name}${value.mobile ? ' · ' + value.mobile : ''}` : t('select')}</span>
        {value ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(null) }} className="grid h-7 w-7 place-items-center rounded-full hover:bg-slate-100"><X className="h-4 w-4 text-slate-400" /></span>
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} className="h-10 w-full rounded-lg bg-slate-100 px-3 outline-none" />
          </div>
          <div className="max-h-60 overflow-auto">
            {list.isLoading && <div className="px-3 py-4 text-center text-sm text-slate-400">{t('loading')}</div>}
            {!list.isLoading && (list.data?.data ?? []).length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">{t('noResults')}</div>}
            {(list.data?.data ?? []).map((c: any) => (
              <button type="button" key={c.id} onClick={() => { onChange({ id: c.id, name: c.name, mobile: c.mobile }); setOpen(false) }} className="block w-full px-3 py-2.5 text-left hover:bg-navy-50">
                <span className="block text-[15px]">{c.name}</span>
                <span className="block text-xs text-slate-500">{[c.mobile, c.village, (c.khata_nos ?? []).join(', ')].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

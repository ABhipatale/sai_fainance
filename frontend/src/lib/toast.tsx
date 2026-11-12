import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

type T = { id: number; kind: 'success' | 'error'; msg: string }
const Ctx = createContext<{ success: (m: string) => void; error: (m: string) => void }>({ success: () => {}, error: () => {} })
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const push = useCallback((kind: T['kind'], msg: string) => {
    const id = Date.now() + Math.random()
    setItems((l) => [...l, { id, kind, msg }])
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])
  const value = { success: (m: string) => push('success', m), error: (m: string) => push('error', m) }
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((i) => (
          <div key={i.id} className={`sheet-in pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-xl ${i.kind === 'success' ? 'bg-ok' : 'bg-over'}`}>
            {i.kind === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
            {i.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

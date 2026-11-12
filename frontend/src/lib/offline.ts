import { openDB, type DBSchema } from 'idb'
import { useEffect, useState } from 'react'
import { api, ApiError } from './api'

/**
 * Offline payment queue.
 * - Every payment gets a client-generated idempotency key (UUID). The server stores that key with a UNIQUE
 *   index, so replaying the same entry (retry, double tap, flaky network) can never create a duplicate.
 * - Entries stay visible as "pending sync" until the server confirms them.
 */
export interface QueuedPayment {
  key: string
  payload: Record<string, any>
  createdAt: number
  status: 'pending' | 'failed'
  error?: string
  label: string // customer · khata, for the pending list
  amount: string
}

interface Schema extends DBSchema {
  payments: { key: string; value: QueuedPayment }
}

const dbp = openDB<Schema>('sai-finance', 1, {
  upgrade(db) {
    db.createObjectStore('payments', { keyPath: 'key' })
  },
})

const emit = () => window.dispatchEvent(new Event('sf:queue'))

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export async function enqueuePayment(payload: Record<string, any>, label: string) {
  const entry: QueuedPayment = {
    key: payload.idempotency_key,
    payload: { ...payload, is_offline: true },
    createdAt: Date.now(),
    status: 'pending',
    label,
    amount: String(payload.amount),
  }
  await (await dbp).put('payments', entry)
  emit()
  return entry
}

export async function listQueue(): Promise<QueuedPayment[]> {
  return ((await (await dbp).getAll('payments')) as QueuedPayment[]).sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeQueued(key: string) {
  await (await dbp).delete('payments', key)
  emit()
}

export async function clearQueue() {
  await (await dbp).clear('payments')
  emit()
}

let syncing = false

/** Upload pending entries in order. Returns how many were confirmed. */
export async function syncQueue(): Promise<number> {
  if (syncing || !navigator.onLine) return 0
  syncing = true
  let done = 0
  try {
    const items = (await listQueue()).filter((i) => i.status === 'pending').slice(0, 25)
    if (!items.length) return 0
    const r = await api.post('/payments/sync', { items: items.map((i) => i.payload) })
    const results: { index: number; ok: boolean; errors?: Record<string, string[]> }[] = r.data.data
    const db = await dbp
    for (const res of results) {
      const item = items[res.index]
      if (!item) continue
      if (res.ok) {
        await db.delete('payments', item.key)
        done++
      } else {
        const msg = Object.values(res.errors ?? {}).flat()[0] || 'Rejected'
        await db.put('payments', { ...item, status: 'failed', error: msg })
      }
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.network)) console.warn('sync failed', e)
  } finally {
    syncing = false
    emit()
  }
  return done
}

export function useQueue() {
  const [items, setItems] = useState<QueuedPayment[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const load = () => listQueue().then(setItems)
    const on = () => {
      setOnline(true)
      syncQueue()
    }
    const off = () => setOnline(false)
    load()
    window.addEventListener('sf:queue', load)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const t = window.setInterval(() => syncQueue(), 30000)
    syncQueue()
    return () => {
      window.removeEventListener('sf:queue', load)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.clearInterval(t)
    }
  }, [])
  return { items, pending: items.filter((i) => i.status === 'pending').length, failed: items.filter((i) => i.status === 'failed').length, online }
}

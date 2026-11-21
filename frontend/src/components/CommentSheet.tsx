import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { fdatetime } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Button, EmptyState, Sheet, Skeleton, Textarea, errMsg } from '@/components/ui'

interface Comment { id: number; body: string; user_name: string | null; created_at: string }

/** Field notes on a khata – quick chips for the usual cases, free text for the rest. */
export default function CommentSheet({ loan, onClose }: { loan: { id: number; customer?: { name: string } } | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const id = loan?.id

  const list = useQuery({ queryKey: ['comments', id], queryFn: () => get<Comment[]>(`/loan-accounts/${id}/comments`), enabled: !!id })
  const add = useMutation({
    mutationFn: (body: string) => post(`/loan-accounts/${id}/comments`, { body }),
    onSuccess: () => {
      setText('')
      toast.success(t('comments.saved'))
      ;['comments', 'collection', 'weekly', 'sheet', 'pending'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    },
    onError: (e) => toast.error(errMsg(e, t)),
  })
  const quick = t('comments.quick', { returnObjects: true }) as unknown as string[]

  return (
    <Sheet
      open={!!loan}
      onClose={onClose}
      title={`${t('comments.title')} · ${loan?.customer?.name ?? ''}`}
      footer={
        <div className="space-y-2 pb-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2} placeholder={t('comments.placeholder')} />
          <Button full loading={add.isPending} disabled={!text.trim()} onClick={() => add.mutate(text.trim())}>{t('comments.add')}</Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {quick.map((q) => (
          <button key={q} onClick={() => setText((p) => (p ? `${p}, ${q}` : q))} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-navy-800 active:bg-navy-50">{q}</button>
        ))}
      </div>
      {list.isLoading && <Skeleton className="h-16 w-full" />}
      {list.data && list.data.length === 0 && <EmptyState title={t('comments.empty')} />}
      <div className="space-y-2">
        {(list.data ?? []).map((c) => (
          <div key={c.id} className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-sm text-slate-900">{c.body}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{c.user_name} · {fdatetime(c.created_at)}</div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

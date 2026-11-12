import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, MessageCircle, Printer, Share2, Undo2 } from 'lucide-react'
import { get, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fdate, money, waUrl } from '@/lib/format'
import { useToast } from '@/lib/toast'
import { Button, ConfirmDialog, ErrorState, Field, PageHeader, Skeleton, Textarea, errMsg } from '@/components/ui'
import ReceiptView, { type ReceiptData } from '@/components/ReceiptView'

export default function Receipt() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const node = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [rev, setRev] = useState(false)
  const [reason, setReason] = useState('')
  const [revErr, setRevErr] = useState('')

  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => get<ReceiptData>(`/payments/${id}/receipt`) })
  const r = q.data

  const text = r
    ? `${r.finance?.name ?? t('appName')}\n${t('receipt.title')} ${r.receipt_no}\n${r.customer_name} · ${r.khata_no}\n${t('amount')}: ${money(r.amount, { decimals: true })}\n${fdate(r.payment_date)}\n${t('receipt.remainingBalance')}: ${money(r.remaining_balance, { decimals: true })}`
    : ''

  /** Render the on-screen receipt to a PDF (browser text shaping keeps Marathi/Hindi correct). */
  const makePdf = async (): Promise<Blob> => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
    const canvas = await html2canvas(node.current!, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
    const wmm = 110
    const hmm = (wmm * canvas.height) / canvas.width
    const pdf = new jsPDF({ unit: 'mm', format: [wmm + 10, hmm + 10] })
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, wmm, hmm)
    return pdf.output('blob')
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast.error(errMsg(e, t))
    } finally {
      setBusy(false)
    }
  }

  const download = () =>
    run(async () => {
      const blob = await makePdf()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${r!.receipt_no}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    })

  const share = () =>
    run(async () => {
      const blob = await makePdf()
      const file = new File([blob], `${r!.receipt_no}.pdf`, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: r!.receipt_no, text })
      else if (navigator.share) await navigator.share({ title: r!.receipt_no, text })
      else {
        await navigator.clipboard?.writeText(text)
        toast.success(t('receipt.copied'))
      }
    })

  const reverse = async () => {
    if (reason.trim().length < 3) {
      setRevErr(t('validation.required'))
      return
    }
    setBusy(true)
    try {
      await post(`/payments/${id}/reverse`, { reason: reason.trim() })
      toast.success(t('receipt.reverseDone'))
      setRev(false)
      setReason('')
      ;['receipt', 'collection', 'pending', 'advance', 'dashboard', 'loan', 'customer', 'payments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    } catch (e) {
      setRevErr(errMsg(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader title={t('receipt.title')} subtitle={r?.receipt_no} back />
      </div>

      {q.isLoading && <Skeleton className="mx-auto h-[520px] max-w-[420px] rounded-2xl" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {r && (
        <>
          <ReceiptView ref={node} r={r} />

          <div className="no-print mx-auto mt-5 grid max-w-[420px] grid-cols-2 gap-3">
            <Button variant="primary" loading={busy} icon={<Download className="h-4 w-4" />} onClick={download}>{t('downloadPdf')}</Button>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>{t('print')}</Button>
            <Button variant="secondary" loading={busy} icon={<Share2 className="h-4 w-4" />} onClick={share}>{t('share')}</Button>
            <a href={waUrl(r.customer_mobile, text)} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ok px-4 text-[15px] font-medium text-white">
              <MessageCircle className="h-4 w-4" />
              {t('whatsapp')}
            </a>
            {can('payments.reverse') && r.status !== 'reversed' && (
              <Button className="col-span-2" variant="danger" icon={<Undo2 className="h-4 w-4" />} onClick={() => { setRevErr(''); setRev(true) }}>{t('receipt.reverse')}</Button>
            )}
          </div>

          <ConfirmDialog open={rev} onClose={() => setRev(false)} onConfirm={reverse} loading={busy} danger title={t('receipt.reverseTitle')} message={t('receipt.reverseText')} confirmLabel={t('receipt.reverse')}>
            <div className="mt-3">
              <Field label={t('receipt.reverseReason')} required error={revErr}>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}

import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { postForm, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import PhotoPicker from './PhotoPicker'
import { Button, Field, Input, Sheet, Skeleton, Textarea, errMsg } from './ui'

const MapPicker = lazy(() => import('./MapPicker'))

export interface GuarantorData {
  id: number; name: string; mobile?: string | null; photo_url?: string | null; address?: string | null; village?: string | null
  taluka?: string | null; district?: string | null; lat?: number | null; lng?: number | null; aadhaar_no?: string | null
}

/** Create (customerId) or edit (guarantor) a guarantor. Guarantors belong to the customer so they can be reused on later khatas. */
export default function GuarantorForm({ open, onClose, customerId, guarantor, onSaved }: {
  open: boolean; onClose: () => void; customerId: number; guarantor?: GuarantorData | null; onSaved?: (g: GuarantorData) => void
}) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [photo, setPhoto] = useState<File | null>(null)

  const schema = z.object({
    name: z.string().trim().min(1, t('validation.required')),
    mobile: z.string().refine((v) => !v || /^\d{10}$/.test(v), t('validation.mobile')),
    address: z.string(), village: z.string(), taluka: z.string(), district: z.string(),
    lat: z.number().optional(), lng: z.number().optional(),
    aadhaar_no: z.string().refine((v) => !v || /^\d{12}$/.test(v), t('validation.aadhaar')),
  })
  type V = z.infer<typeof schema>
  const f = useForm<V>({ resolver: zodResolver(schema) as any, defaultValues: { name: '', mobile: '', address: '', village: '', taluka: '', district: '', aadhaar_no: '' } })

  useEffect(() => {
    if (!open) return
    setPhoto(null)
    f.reset({
      name: guarantor?.name ?? '', mobile: guarantor?.mobile ?? '', address: guarantor?.address ?? '', village: guarantor?.village ?? '',
      taluka: guarantor?.taluka ?? '', district: guarantor?.district ?? '', lat: guarantor?.lat ?? undefined, lng: guarantor?.lng ?? undefined,
      aadhaar_no: can('customers.documents') ? guarantor?.aadhaar_no ?? '' : '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guarantor?.id])

  const save = useMutation({
    mutationFn: (v: V) => {
      const body: Record<string, unknown> = { ...v, photo }
      if (!can('customers.documents')) delete body.aadhaar_no
      return guarantor ? postForm<GuarantorData>(`/guarantors/${guarantor.id}`, body, 'PUT') : postForm<GuarantorData>(`/customers/${customerId}/guarantors`, body)
    },
    onSuccess: (g) => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['guarantors', customerId] })
      qc.invalidateQueries({ queryKey: ['customer', String(customerId)] })
      onSaved?.(g)
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) Object.entries(e.errors).forEach(([k, m]) => f.setError(k as any, { message: m[0] }))
      toast.error(errMsg(e, t))
    },
  })

  const { register, formState: { errors }, watch, setValue } = f
  return (
    <Sheet open={open} onClose={onClose} wide title={guarantor ? t('customers.editGuarantor') : t('customers.addGuarantor')}
      footer={<div className="flex gap-3 pb-1"><Button variant="secondary" full onClick={onClose}>{t('cancel')}</Button><Button full loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>{t('save')}</Button></div>}>
      <div className="space-y-3">
        <div className="flex items-start gap-4">
          <PhotoPicker value={photo} onChange={setPhoto} existingUrl={guarantor?.photo_url} round />
          <div className="min-w-0 flex-1 space-y-3">
            <Field label={t('name')} required error={errors.name?.message}><Input {...register('name')} /></Field>
            <Field label={t('mobile')} error={errors.mobile?.message}><Input {...register('mobile')} inputMode="numeric" maxLength={10} /></Field>
          </div>
        </div>
        <Field label={t('address')}><Textarea {...register('address')} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('village')}><Input {...register('village')} /></Field>
          <Field label={t('taluka')}><Input {...register('taluka')} /></Field>
          <Field label={t('district')}><Input {...register('district')} /></Field>
        </div>
        {can('customers.documents') && <Field label={t('customers.aadhaarNo')} error={errors.aadhaar_no?.message}><Input {...register('aadhaar_no')} inputMode="numeric" maxLength={12} /></Field>}
        <Field label={t('customers.gpsLocation')}>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <MapPicker lat={watch('lat')} lng={watch('lng')} onChange={(a, b) => { setValue('lat', a); setValue('lng', b) }} />
          </Suspense>
        </Field>
      </div>
    </Sheet>
  )
}

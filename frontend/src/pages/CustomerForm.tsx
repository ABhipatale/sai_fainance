import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm, type Path } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { get, postForm, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import PhotoPicker from '@/components/PhotoPicker'
import { Button, Card, ErrorState, Field, Input, ListSkeleton, PageHeader, Select, Skeleton, StickyBar, Textarea, errMsg } from '@/components/ui'

const MapPicker = lazy(() => import('@/components/MapPicker'))

export default function CustomerForm() {
  const { id } = useParams()
  const edit = !!id
  const { t } = useTranslation()
  const { can, session } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [photo, setPhoto] = useState<File | null>(null)
  const [aPhoto, setAPhoto] = useState<File | null>(null)
  const [pPhoto, setPPhoto] = useState<File | null>(null)
  const [photoErr, setPhotoErr] = useState(false)
  const docs = can('customers.documents')

  const req = z.string().trim().min(1, t('validation.required'))
  const schema = z.object({
    name: req,
    mobile: z.string().regex(/^\d{10}$/, t('validation.mobile')),
    alt_mobile: z.string().refine((v) => !v || /^\d{10}$/.test(v), t('validation.mobile')),
    occupation: req,
    address: req,
    village: req,
    taluka: req,
    district: req,
    state: req,
    pincode: z.string().regex(/^\d{6}$/, t('validation.pincode')),
    lat: z.number({ error: t('validation.gps') }),
    lng: z.number({ error: t('validation.gps') }),
    aadhaar_no: z.string().refine((v) => !v || /^\d{12}$/.test(v), t('validation.aadhaar')),
    pan_no: z.string().refine((v) => !v || /^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(v), t('validation.pan')),
    area: z.string(),
    notes: z.string(),
    recovery_user_id: z.string(),
  })
  type V = z.infer<typeof schema>

  const f = useForm<V>({
    resolver: zodResolver(schema) as any,
    defaultValues: { name: '', mobile: '', alt_mobile: '', occupation: '', address: '', village: '', taluka: '', district: '', state: 'Maharashtra', pincode: '', aadhaar_no: '', pan_no: '', area: '', notes: '', recovery_user_id: '' },
  })
  const { register, formState: { errors }, watch, setValue } = f

  const cust = useQuery({ queryKey: ['customer', id], queryFn: () => get<any>(`/customers/${id}`), enabled: edit })
  const staff = useQuery({ queryKey: ['staff-list'], queryFn: () => get<any[]>('/users', { role: 'recovery' }), enabled: can('recovery.assign') })

  useEffect(() => {
    const c = cust.data
    if (!c) return
    f.reset({
      name: c.name ?? '', mobile: c.mobile ?? '', alt_mobile: c.alt_mobile ?? '', occupation: c.occupation ?? '', address: c.address ?? '',
      village: c.village ?? '', taluka: c.taluka ?? '', district: c.district ?? '', state: c.state ?? '', pincode: c.pincode ?? '',
      lat: c.lat ?? undefined, lng: c.lng ?? undefined, aadhaar_no: c.documents_visible ? c.aadhaar_no ?? '' : '', pan_no: c.documents_visible ? c.pan_no ?? '' : '',
      area: c.area ?? '', notes: c.notes ?? '', recovery_user_id: c.recovery_user_id ? String(c.recovery_user_id) : '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cust.data])

  const save = useMutation({
    mutationFn: (v: V) => {
      const body: Record<string, unknown> = { ...v, photo, recovery_user_id: v.recovery_user_id || undefined }
      if (docs) Object.assign(body, { aadhaar_photo: aPhoto, pan_photo: pPhoto })
      else { delete body.aadhaar_no; delete body.pan_no }
      return edit ? postForm(`/customers/${id}`, body, 'PUT') : postForm('/customers', body)
    },
    onSuccess: (c: any) => {
      toast.success(t('success'))
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['customer'] })
      nav(`/customers/${edit ? id : c.id}`, { replace: true })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        Object.entries(e.errors).forEach(([k, m]) => f.setError(k as Path<V>, { message: m[0] }))
      }
      toast.error(errMsg(e, t))
    },
  })

  const submit = f.handleSubmit((v) => {
    if (!edit && !photo) {
      setPhotoErr(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    save.mutate(v)
  })

  if (edit && cust.isLoading) return <ListSkeleton rows={4} />
  if (edit && cust.isError) return <ErrorState error={cust.error} onRetry={() => cust.refetch()} />

  const e = (k: keyof V) => errors[k]?.message as string | undefined
  const lat = watch('lat'), lng = watch('lng')

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader back title={edit ? t('customers.edit') : t('customers.add')} />
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-start gap-4">
            <div>
              <PhotoPicker value={photo} onChange={(p) => { setPhoto(p); setPhotoErr(false) }} existingUrl={cust.data?.photo_url} round label={t('photo')} />
              {photoErr && <div className="mt-1 text-xs font-medium text-over">{t('validation.required')}</div>}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <Field label={t('customers.fullName')} required error={e('name')}><Input {...register('name')} invalid={!!errors.name} autoComplete="off" /></Field>
              <Field label={t('mobile')} required error={e('mobile')}><Input {...register('mobile')} inputMode="numeric" maxLength={10} invalid={!!errors.mobile} /></Field>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('occupation')} required error={e('occupation')}><Input {...register('occupation')} /></Field>
            <Field label={t('customers.altMobile')} error={e('alt_mobile')}><Input {...register('alt_mobile')} inputMode="numeric" maxLength={10} /></Field>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-bold text-navy-900">{t('customers.addressSection')}</h2>
          <Field label={t('customers.fullAddress')} required error={e('address')}><Textarea {...register('address')} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('village')} required error={e('village')}><Input {...register('village')} /></Field>
            <Field label={t('taluka')} required error={e('taluka')}><Input {...register('taluka')} /></Field>
            <Field label={t('district')} required error={e('district')}><Input {...register('district')} /></Field>
            <Field label={t('state')} required error={e('state')}><Input {...register('state')} /></Field>
            <Field label={t('pincode')} required error={e('pincode')}><Input {...register('pincode')} inputMode="numeric" maxLength={6} /></Field>
          </div>
          <Field label={t('customers.gpsLocation')} required error={e('lat') || e('lng')}>
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <MapPicker lat={lat} lng={lng} invalid={!!(errors.lat || errors.lng)} onChange={(a, b) => { setValue('lat', a, { shouldValidate: true }); setValue('lng', b, { shouldValidate: true }) }} />
            </Suspense>
          </Field>
        </Card>

        {docs && (
          <Card className="space-y-3 p-4">
            <h2 className="font-bold text-navy-900">{t('customers.documents')} <span className="text-xs font-normal text-slate-500">({t('optional')})</span></h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Field label={t('customers.aadhaarNo')} error={e('aadhaar_no')}><Input {...register('aadhaar_no')} inputMode="numeric" maxLength={12} /></Field>
                <PhotoPicker value={aPhoto} onChange={setAPhoto} label={t('customers.aadhaarPhoto')} />
              </div>
              <div className="space-y-2">
                <Field label={t('customers.panNo')} error={e('pan_no')}><Input {...register('pan_no')} maxLength={10} className="uppercase" /></Field>
                <PhotoPicker value={pPhoto} onChange={setPPhoto} label={t('customers.panPhoto')} />
              </div>
            </div>
          </Card>
        )}

        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('customers.area')}>
              <>
                <Input {...register('area')} list="areas" />
                <datalist id="areas">{(session?.config.recovery_areas ?? []).map((a) => <option key={a} value={a} />)}</datalist>
              </>
            </Field>
            {can('recovery.assign') && (
              <Field label={t('recoveryPerson')}>
                <Select {...register('recovery_user_id')}>
                  <option value="">—</option>
                  {(staff.data ?? []).filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <Field label={t('notes')}><Textarea {...register('notes')} /></Field>
        </Card>
      </div>
      <StickyBar>
        <Button type="submit" size="lg" full loading={save.isPending}>{t('save')}</Button>
      </StickyBar>
    </form>
  )
}

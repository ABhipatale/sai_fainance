/** Money is always displayed in Indian format (₹1,00,000.00) – values arrive from the API as decimal strings. */
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export function money(v: string | number | null | undefined, opts: { decimals?: boolean } = {}): string {
  const n = Number(v ?? 0)
  if (Number.isNaN(n)) return '₹0'
  const whole = Number.isInteger(n) && opts.decimals !== true
  return '₹' + (whole ? inr0.format(n) : inr.format(n))
}

export const num = (v: string | number | null | undefined) => Number(v ?? 0)

/** YYYY-MM-DD (or ISO) → DD/MM/YYYY */
export function fdate(v?: string | null): string {
  if (!v) return '—'
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v)
}

export function fdatetime(v?: string | null): string {
  if (!v) return '—'
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fdate(v)
}

export const todayISO = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const mapsUrl = (lat?: number | string | null, lng?: number | string | null) =>
  lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : undefined

export const telUrl = (m?: string | null) => (m ? `tel:+91${m}` : undefined)
export const waUrl = (m?: string | null, text?: string) =>
  m ? `https://wa.me/91${m}${text ? `?text=${encodeURIComponent(text)}` : ''}` : undefined

export function initials(name?: string | null) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

/** Compress a photo client-side (max 1024px, JPEG 0.8) so uploads stay small on mobile data. */
export async function compressImage(file: File, max = 1024, quality = 0.8): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', quality))
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

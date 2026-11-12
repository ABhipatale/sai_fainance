import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { useTranslation } from 'react-i18next'
import { ExternalLink, LocateFixed, Search } from 'lucide-react'
import { mapsUrl } from '@/lib/format'
import { Button } from './ui'

// bundlers break Leaflet's default icon paths – set them explicitly
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

const DEFAULT: [number, number] = [18.5204, 73.8567] // Maharashtra (Pune) fallback centre

/**
 * Location selection: GPS capture, tap/drag on a Leaflet map, address search (Nominatim).
 * Works offline: GPS + manual coordinates still function, only tiles/search need internet.
 */
export default function MapPicker({ lat, lng, onChange, invalid }: {
  lat?: number | string | null
  lng?: number | string | null
  onChange: (lat: number, lng: number) => void
  invalid?: boolean
}) {
  const { t } = useTranslation()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const la = lat !== null && lat !== undefined && lat !== '' ? Number(lat) : null
  const ln = lng !== null && lng !== undefined && lng !== '' ? Number(lng) : null
  const has = la !== null && ln !== null && !Number.isNaN(la) && !Number.isNaN(ln)

  const place = (a: number, b: number, pan = true) => {
    if (!map.current) return
    if (!marker.current) {
      marker.current = L.marker([a, b], { draggable: true }).addTo(map.current)
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng()
        cb.current(+p.lat.toFixed(7), +p.lng.toFixed(7))
      })
    } else marker.current.setLatLng([a, b])
    if (pan) map.current.setView([a, b], Math.max(map.current.getZoom(), 16))
  }

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true }).setView(has ? [la!, ln!] : DEFAULT, has ? 16 : 11)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      cb.current(+e.latlng.lat.toFixed(7), +e.latlng.lng.toFixed(7))
    })
    map.current = m
    if (has) place(la!, ln!, false)
    setTimeout(() => m.invalidateSize(), 200)
    return () => {
      m.remove()
      map.current = null
      marker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (has) place(la!, ln!, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [la, ln])

  const gps = () => {
    setMsg('')
    if (!navigator.geolocation) return setMsg(t('customers.gpsUnsupported'))
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false)
        const a = +p.coords.latitude.toFixed(7), b = +p.coords.longitude.toFixed(7)
        onChange(a, b)
        place(a, b)
      },
      () => {
        setBusy(false)
        setMsg(t('customers.gpsDenied'))
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const search = async () => {
    if (!q.trim()) return
    setBusy(true)
    setMsg('')
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`)
      const j = await r.json()
      if (!j[0]) setMsg(t('noResults'))
      else {
        const a = +Number(j[0].lat).toFixed(7), b = +Number(j[0].lon).toFixed(7)
        onChange(a, b)
        place(a, b)
      }
    } catch {
      setMsg(t('offline'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`space-y-2 rounded-2xl border p-3 ${invalid ? 'border-over' : 'border-slate-200'} bg-white`}>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())}
          placeholder={t('customers.searchAddress')}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-[15px] outline-none focus:border-navy-500"
        />
        <Button type="button" variant="secondary" onClick={search} loading={busy} icon={<Search className="h-4 w-4" />} aria-label={t('search')} />
      </div>
      <Button type="button" full variant="secondary" onClick={gps} loading={busy} icon={<LocateFixed className="h-4 w-4" />}>{t('customers.captureGps')}</Button>
      <div ref={el} className="z-0 h-56 w-full overflow-hidden rounded-xl bg-slate-100" />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="tabular-nums">{has ? `${la!.toFixed(6)}, ${ln!.toFixed(6)}` : t('customers.noLocation')}</span>
        {has && (
          <a href={mapsUrl(la, ln)} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-navy-600">
            <ExternalLink className="h-3.5 w-3.5" />{t('openMap')}
          </a>
        )}
      </div>
      {msg && <div className="text-xs font-medium text-over">{msg}</div>}
    </div>
  )
}

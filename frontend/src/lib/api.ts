import axios, { AxiosError } from 'axios'

export const TOKEN_KEY = 'sf_token'

export const api = axios.create({
  baseURL: '/api',
  headers: { Accept: 'application/json' },
  timeout: 30000,
})

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

export class ApiError extends Error {
  status: number
  errors: Record<string, string[]>
  network: boolean
  constructor(message: string, status = 0, errors: Record<string, string[]> = {}, network = false) {
    super(message)
    this.status = status
    this.errors = errors
    this.network = network
  }
}

api.interceptors.response.use(
  (r) => r,
  (e: AxiosError<{ message?: string; errors?: Record<string, string[]> }>) => {
    if (!e.response) {
      return Promise.reject(new ApiError('network', 0, {}, true))
    }
    if (e.response.status === 401 && !e.config?.url?.includes('/login')) {
      localStorage.removeItem(TOKEN_KEY)
      window.dispatchEvent(new Event('sf:unauthorized'))
    }
    return Promise.reject(new ApiError(e.response.data?.message || 'Request failed', e.response.status, e.response.data?.errors || {}))
  },
)

/** GET → data payload */
export async function get<T = any>(url: string, params?: Record<string, unknown>): Promise<T> {
  const r = await api.get(url, { params })
  return r.data.data as T
}

/** GET paginated list → {data, meta} */
export async function getPage<T = any>(url: string, params?: Record<string, unknown>) {
  const r = await api.get(url, { params })
  return r.data as { data: T[]; meta: { page: number; per_page: number; total: number; last_page: number; [k: string]: any }; [k: string]: any }
}

export async function post<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await api.post(url, body)
  return r.data.data as T
}

export async function put<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await api.put(url, body)
  return r.data.data as T
}

/** multipart (photos). Laravel cannot parse multipart PUT, so updates are POST + _method=PUT. */
export async function postForm<T = any>(url: string, values: Record<string, unknown>, method?: 'PUT'): Promise<T> {
  const fd = new FormData()
  Object.entries(values).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    if (v instanceof Blob) fd.append(k, v, (v as File).name || 'upload.jpg')
    else fd.append(k, String(v))
  })
  if (method) fd.append('_method', method)
  const r = await api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  return r.data.data as T
}

/** Authenticated file download (reports, documents). */
export async function download(url: string, params: Record<string, unknown>, filename: string) {
  const r = await api.get(url, { params, responseType: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(r.data)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export async function fetchBlobUrl(url: string): Promise<string> {
  const r = await api.get(url, { responseType: 'blob' })
  return URL.createObjectURL(r.data)
}

export interface Limits {
  storageQuotaBytes: number | null
  maxFileSizeBytes: number | null
  maxRoomMinutes: number | null
  maxActiveRooms: number | null
  maxParticipants: number | null
}

export interface User {
  id: string
  email: string
  displayName: string
  role: 'USER' | 'ADMIN'
  enabled: boolean
  createdAt: string
  limits: Limits
}

export interface Participant {
  userId: string
  displayName: string
  online: boolean
  owner: boolean
}

export interface Room {
  id: string
  code: string
  name: string
  createdAt: string
  expiresAt: string | null
  ownerId: string
  isOwner: boolean
  participants: Participant[]
}

export interface RoomSummary {
  code: string
  name: string
  expiresAt: string | null
  isOwner: boolean
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

let accessToken: string | null = null
let onSessionLost: () => void = () => {}
let refreshing: Promise<boolean> | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn
}

export function refreshSession(): Promise<boolean> {
  // Una sola petición de refresh a la vez: el refresh token se rota en cada uso.
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) return false
      const data = await res.json()
      accessToken = data.accessToken
      window.dispatchEvent(new CustomEvent('nora:session', { detail: data.user }))
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' })
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return raw(path, init, false)
    onSessionLost()
  }
  return res
}

async function fail(res: Response): Promise<never> {
  let message = `Error ${res.status}`
  let fields: Record<string, string> | undefined
  try {
    const body = await res.json()
    message = body.message ?? message
    fields = body.fields
  } catch {
    if (res.status === 429) message = 'Demasiadas peticiones, espera un momento'
    if (res.status === 413) message = 'El archivo es demasiado grande'
  }
  throw new ApiError(res.status, message, fields)
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await raw(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) return fail(res)
  return res.status === 204 ? (undefined as T) : res.json()
}

export async function download(path: string, filename: string) {
  const res = await raw(path)
  if (!res.ok) return fail(res)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return '0 KB/s' // por debajo de 1 KB/s se considera parado
  if (bytesPerSecond < 1024 * 1024) return `${Math.round(bytesPerSecond / 1024)} KB/s`
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '∞'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

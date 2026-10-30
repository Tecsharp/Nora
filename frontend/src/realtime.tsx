import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { useToast } from './toast'
import { useDialogs } from './dialogs'

export type RtStatus = 'offline' | 'connecting' | 'open'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (data: any) => void

/**
 * Cliente WebSocket único de la app. Se autentica con un ticket de un solo uso, reconecta con espera exponencial,
 * detecta conexiones muertas con ping/pong y vuelve a entrar en la sala tras cada reconexión.
 * Emite además el evento sintético "reconnected" para que las vistas recarguen lo que se perdieron.
 */
class RealtimeClient {
  status: RtStatus = 'offline'
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private statusHandlers = new Set<(s: RtStatus) => void>()
  private room: string | null = null
  private wanted = false
  private attempt = 0
  private hadConnection = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    window.addEventListener('online', () => {
      if (this.wanted && this.status !== 'open') this.connect()
    })
  }

  start() {
    if (this.wanted) return
    this.wanted = true
    this.connect()
  }

  stop() {
    this.wanted = false
    this.room = null
    this.hadConnection = false
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.setStatus('offline')
  }

  join(code: string) {
    this.room = code
    this.send({ type: 'join', code })
  }

  leave() {
    if (!this.room) return
    this.room = null
    this.send({ type: 'leave' })
  }

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) this.handlers.set(type, (set = new Set()))
    set.add(handler)
    return () => set.delete(handler)
  }

  onStatus(handler: (s: RtStatus) => void): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  /** Envía un mensaje si hay conexión; si no, se descarta (los avisos de progreso no se reenvían). */
  notify(msg: object) {
    this.send(msg)
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private emit(type: string, data: unknown) {
    this.handlers.get(type)?.forEach((h) => h(data))
  }

  private setStatus(s: RtStatus) {
    if (this.status === s) return
    this.status = s
    this.statusHandlers.forEach((h) => h(s))
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.retryTimer = this.pingTimer = this.pongTimer = null
  }

  private scheduleRetry() {
    if (!this.wanted || this.retryTimer) return
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) + Math.random() * 500
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private async connect() {
    if (!this.wanted || this.status === 'connecting' || this.status === 'open') return
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.setStatus('connecting')
    let ticket: string
    try {
      ticket = (await api<{ ticket: string }>('/ws/ticket', 'POST')).ticket
    } catch {
      this.setStatus('offline')
      this.scheduleRetry()
      return
    }
    if (!this.wanted) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.setStatus('open')
      if (this.room) this.send({ type: 'join', code: this.room })
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' })
        this.pongTimer ??= setTimeout(() => ws.close(), 10_000) // sin pong: la conexión está muerta
      }, 25_000)
      if (this.hadConnection) this.emit('reconnected', {})
      this.hadConnection = true
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'pong' && this.pongTimer) {
          clearTimeout(this.pongTimer)
          this.pongTimer = null
        }
        this.emit(msg.type, msg.data)
      } catch {
        // mensaje no válido: se ignora
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.clearTimers()
      this.setStatus('offline')
      this.scheduleRetry()
    }
  }
}

export const rt = new RealtimeClient()

export function useRealtime(type: string, handler: Handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => rt.on(type, (d) => ref.current(d)), [type])
}

export function useRtStatus(): RtStatus {
  const [status, setStatus] = useState(rt.status)
  useEffect(() => {
    setStatus(rt.status)
    return rt.onStatus(setStatus)
  }, [])
  return status
}

const Ctx = createContext<RtStatus>('offline')
export const useConnection = () => useContext(Ctx)

/** Mantiene la conexión mientras hay sesión y atiende los avisos de cuenta. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const status = useRtStatus()
  const loggedIn = !!user

  useEffect(() => {
    if (loggedIn) rt.start()
    else rt.stop()
  }, [loggedIn])

  useRealtime('account.updated', (d) => {
    toast(d.message, 'info')
    if (d.user) window.dispatchEvent(new CustomEvent('nora:session', { detail: d.user }))
  })
  useRealtime('account.disabled', (d) => {
    toast(d.message, 'error')
    logout().catch(() => {})
  })
  useRealtime('account.revoked', (d) => {
    logout().catch(() => {})
    void dialogs.notify({ title: 'Tu sesión se cerró', message: d.message, tone: 'warning', icon: 'info', confirmLabel: 'Volver a entrar' })
  })
  useRealtime('account.deleted', () => {
    logout().catch(() => {})
  })

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, CheckCheck, Clapperboard, Clock, FolderOpen, KanbanSquare, MessageSquare, SquareCheckBig, UserPlus } from 'lucide-react'
import { api } from './api'
import { useAuth } from './auth'
import { useRealtime } from './realtime'
import { useToast } from './toast'

export interface AppNotification {
  id: string
  roomCode: string | null
  roomName: string | null
  kind: string
  title: string
  body: string
  link: { tool?: string; item?: string; file?: string; conv?: string; msg?: string }
  count: number
  createdAt: string
  readAt: string | null
}

interface State {
  items: AppNotification[]
  unread: number
  markRead: (id: string) => void
  markAllRead: () => void
  open: (n: AppNotification) => void
}

const Ctx = createContext<State>({ items: [], unread: 0, markRead: () => {}, markAllRead: () => {}, open: () => {} })
export const useNotifications = () => useContext(Ctx)

/** Dirección exacta dentro de la app a la que lleva una notificación. */
export function notificationPath(n: Pick<AppNotification, 'roomCode' | 'link'>): string | null {
  if (!n.roomCode) return null
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(n.link ?? {})) if (v) q.set(k, String(v))
  const s = q.toString()
  return `/room/${n.roomCode}${s ? `?${s}` : ''}`
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const uid = user?.id

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: AppNotification[]; unread: number }>('/notifications?limit=60')
      setItems(r.items)
      setUnread(r.unread)
    } catch { /* se reintenta al reconectar */ }
  }, [])

  useEffect(() => {
    if (!uid) { setItems([]); setUnread(0); return }
    void load()
  }, [uid, load])
  useRealtime('reconnected', () => { if (uid) void load() })

  useRealtime('notification.new', (n: AppNotification) => {
    setItems((l) => [n, ...l.filter((x) => x.id !== n.id)].slice(0, 100))
    // una agrupada que ya estaba sin leer no suma otra vez
    setUnread((u) => (items.some((x) => x.id === n.id && !x.readAt) ? u : u + 1))
    if (['task', 'poll', 'event', 'review', 'file'].includes(n.kind)) toast(`${n.title}${n.body ? ` · ${n.body}` : ''}`.slice(0, 140), 'info')
  })
  useRealtime('notification.read', (d: { id?: string; all?: boolean; group?: string }) => {
    // otra pestaña o dispositivo ya la vio: se sincroniza
    if (d.id || d.all || d.group) void load()
  })

  const markRead = useCallback((id: string) => {
    setItems((l) => l.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)))
    setUnread((u) => Math.max(0, u - (items.some((n) => n.id === id && !n.readAt) ? 1 : 0)))
    api(`/notifications/${id}/read`, 'POST').catch(() => {})
  }, [items])

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString()
    setItems((l) => l.map((n) => (n.readAt ? n : { ...n, readAt: now })))
    setUnread(0)
    api('/notifications/read-all', 'POST').catch(() => void load())
  }, [load])

  const open = useCallback((n: AppNotification) => {
    markRead(n.id)
    const path = notificationPath(n)
    if (path) navigate(path)
  }, [markRead, navigate])

  const value = useMemo(() => ({ items, unread, markRead, markAllRead, open }), [items, unread, markRead, markAllRead, open])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const ICONS: Record<string, typeof Bell> = {
  task: KanbanSquare, poll: SquareCheckBig, event: CalendarDays, review: Clapperboard, file: FolderOpen,
  join: UserPlus, member: UserPlus, room: Clock, chat: MessageSquare,
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'ahora'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  if (s < 7 * 86400) return `hace ${Math.round(s / 86400)} d`
  return new Date(iso).toLocaleDateString()
}

/** Campana de la barra superior con el panel de avisos. */
export function NotificationBell() {
  const { items, unread, markAllRead, open } = useNotifications()
  const [show, setShow] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [, tick] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!show) return
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setShow(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setShow(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { clearInterval(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [show])

  const list = tab === 'unread' ? items.filter((n) => !n.readAt) : items
  return (
    <div className="notif" ref={box}>
      <button className="btn ghost sm notif-bell" aria-label={unread ? `Notificaciones, ${unread} sin ver` : 'Notificaciones'} aria-expanded={show} onClick={() => setShow((v) => !v)}>
        <Bell size={16} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {show && (
        <div className="notif-panel" role="dialog" aria-label="Notificaciones">
          <header>
            <strong>Notificaciones</strong>
            <button className="btn ghost sm" disabled={unread === 0} onClick={markAllRead}><CheckCheck size={14} /> Marcar todas como vistas</button>
          </header>
          <div className="notif-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Todas</button>
            <button role="tab" aria-selected={tab === 'unread'} className={tab === 'unread' ? 'on' : ''} onClick={() => setTab('unread')}>Sin ver{unread > 0 ? ` · ${unread}` : ''}</button>
          </div>
          <ul>
            {list.length === 0 && <li className="notif-empty"><Bell size={22} /><span>{tab === 'unread' ? 'Todo al día' : 'Aún no tienes notificaciones'}</span></li>}
            {list.map((n) => {
              const Icon = ICONS[n.kind] ?? Bell
              return (
                <li key={n.id}>
                  <button className={`notif-item ${n.readAt ? '' : 'new'}`} onClick={() => { setShow(false); open(n) }}>
                    <span className={`notif-ico k-${n.kind}`}><Icon size={15} /></span>
                    <span className="notif-txt">
                      <b>{n.title}{n.count > 1 ? ` (${n.count})` : ''}</b>
                      {n.body && <span>{n.body}</span>}
                      <small>{n.roomName && <em>{n.roomName}</em>}{ago(n.createdAt)}</small>
                    </span>
                    {!n.readAt && <i className="notif-dot" aria-label="Sin ver" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

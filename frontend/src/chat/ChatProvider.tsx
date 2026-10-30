import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { chatApi, type Conv, type Message } from './chatApi'

export interface DockWindow { id: string; min: boolean }
interface DockState { open: boolean; wins: DockWindow[] }

interface ChatState {
  room: Room
  online: Set<string>
  convs: Conv[]
  loaded: boolean
  /** Mensajes sin leer en conversaciones que no están silenciadas. */
  unread: number
  conv: (id: string) => Conv | undefined
  refresh: () => Promise<void>
  patch: (c: Conv) => void
  markRead: (id: string) => void
  narrow: boolean
  fullOpen: boolean
  openFull: (convId?: string) => void
  dock: DockState
  setDockOpen: (open: boolean) => void
  openWindow: (id: string) => void
  closeWindow: (id: string) => void
  toggleMin: (id: string) => void
  startDm: (userId: string) => Promise<Conv>
  /** Quien está escribiendo ahora en una conversación (sin contar a quien mira). */
  typing: (convId: string) => string[]
  setViewing: (convId: string, on: boolean) => void
  /** Nombre de una conversación tal como la ve esta persona. */
  title: (c: Conv) => string
}

const Ctx = createContext<ChatState | null>(null)
export const useChat = () => useContext(Ctx)!

const NARROW = '(max-width: 760px)'
const WIN_W = 340 // ancho de una ventana más el hueco
const PANEL_W = 276

export function ChatProvider({ room, online, fullOpen, onOpenFull, children }: { room: Room; online: Set<string>; fullOpen: boolean; onOpenFull: (convId?: string) => void; children: ReactNode }) {
  const { user } = useAuth()
  const code = room.code
  const uid = user?.id ?? ''
  const [convs, setConvs] = useState<Conv[]>([])
  const [loaded, setLoaded] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  const [typingMap, setTypingMap] = useState<Record<string, Record<string, { name: string; at: number }>>>({})
  const storeKey = `nora-chat-dock:${code}:${uid}`
  const [dock, setDock] = useState<DockState>(() => {
    try { const s = JSON.parse(localStorage.getItem(`nora-chat-dock:${code}:${uid}`) ?? 'null') as DockState | null; if (s && Array.isArray(s.wins)) return s } catch { /* sin almacenamiento */ }
    return { open: false, wins: [] } // por defecto el panel va plegado: no tapa nada, y el contador avisa de lo que llega
  })
  const viewing = useRef(new Map<string, number>())
  const readTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const convsRef = useRef(convs)
  convsRef.current = convs
  const fullRef = useRef(fullOpen)
  fullRef.current = fullOpen

  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(dock)) } catch { /* sin almacenamiento */ } }, [dock, storeKey])

  const sortConvs = (l: Conv[]) => [...l].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.localeCompare(a.lastMessageAt))

  const refresh = useCallback(async () => {
    try {
      const l = await chatApi.list(code)
      setConvs(sortConvs(l))
      setLoaded(true)
      // ventanas de conversaciones que ya no existen
      setDock((d) => (d.wins.some((w) => !l.some((c) => c.id === w.id)) ? { ...d, wins: d.wins.filter((w) => l.some((c) => c.id === w.id)) } : d))
    } catch { /* se reintenta al reconectar */ }
  }, [code])

  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void refresh(), 150)
  }, [refresh])

  useEffect(() => { void refresh() }, [refresh])
  useRealtime('reconnected', () => { void refresh() })

  const patch = useCallback((c: Conv) => setConvs((l) => sortConvs(l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c])), [])

  const markRead = useCallback((id: string) => {
    setConvs((l) => l.map((c) => (c.id === id && c.unread ? { ...c, unread: 0 } : c)))
    const t = readTimers.current.get(id)
    if (t) clearTimeout(t)
    readTimers.current.set(id, setTimeout(() => { readTimers.current.delete(id); chatApi.read(code, id).catch(() => {}) }, 300))
  }, [code])

  const setViewing = useCallback((id: string, on: boolean) => {
    const n = (viewing.current.get(id) ?? 0) + (on ? 1 : -1)
    if (n <= 0) viewing.current.delete(id)
    else viewing.current.set(id, n)
  }, [])

  // ---- ventanas ----
  const maxWins = Math.max(1, Math.floor((window.innerWidth - PANEL_W - 24) / WIN_W))
  const openWindow = useCallback((id: string) => {
    if (narrow) return onOpenFull(id)
    setDock((d) => {
      const rest = d.wins.filter((w) => w.id !== id)
      return { ...d, wins: [{ id, min: false }, ...rest].slice(0, Math.max(1, Math.floor((window.innerWidth - PANEL_W - 24) / WIN_W))) }
    })
  }, [narrow, onOpenFull])
  const closeWindow = useCallback((id: string) => setDock((d) => ({ ...d, wins: d.wins.filter((w) => w.id !== id) })), [])
  const toggleMin = useCallback((id: string) => setDock((d) => ({ ...d, wins: d.wins.map((w) => (w.id === id ? { ...w, min: !w.min } : w)) })), [])
  const setDockOpen = useCallback((open: boolean) => setDock((d) => ({ ...d, open })), [])
  useEffect(() => { setDock((d) => (d.wins.length > maxWins ? { ...d, wins: d.wins.slice(0, maxWins) } : d)) }, [maxWins])

  const startDm = useCallback(async (userId: string) => {
    const c = await chatApi.dm(code, userId)
    patch(c)
    openWindow(c.id)
    return c
  }, [code, patch, openWindow])

  // ---- tiempo real ----
  useRealtime('chat.message', (d: { room: string; conv: string; message: Message }) => {
    if (d.room !== code) return
    const m = d.message
    const c = convsRef.current.find((x) => x.id === d.conv)
    const mineMsg = m.authorId === uid
    const popup = (conv: Conv) => {
      // un mensaje nuevo de otra persona en un chat que no está a la vista asoma su ventana (minimizada, sin molestar)
      if (m.kind === 'TEXT' && !mineMsg && !conv.muted && conv.kind !== 'ROOM' && !fullRef.current && !window.matchMedia(NARROW).matches && !(viewing.current.has(conv.id) && document.hasFocus())) {
        setDock((dk) => (dk.wins.some((w) => w.id === conv.id) ? dk : { ...dk, wins: [{ id: conv.id, min: true }, ...dk.wins].slice(0, Math.max(1, Math.floor((window.innerWidth - PANEL_W - 24) / WIN_W))) }))
      }
    }
    if (!c) {
      // conversación nueva para esta persona (la abrió otra): se pide la lista, que ya trae sus no leídos
      void chatApi.list(code).then((l) => { setConvs(sortConvs(l)); const nc = l.find((x) => x.id === d.conv); if (nc) popup(nc) }).catch(() => {})
      return
    }
    const seen = viewing.current.has(d.conv) && document.hasFocus()
    setConvs((l) => sortConvs(l.map((x) => (x.id === d.conv ? {
      ...x, lastMessageAt: m.createdAt,
      last: { id: m.id, authorId: m.authorId, authorName: m.authorName, kind: m.kind, text: m.text.slice(0, 120), createdAt: m.createdAt },
      unread: m.kind === 'TEXT' && !mineMsg && !seen ? x.unread + 1 : x.unread,
    } : x))))
    if (seen && m.kind === 'TEXT' && !mineMsg) markRead(d.conv)
    popup(c)
    setTypingMap((t) => { if (!t[d.conv]?.[m.authorId ?? '']) return t; const n = { ...t, [d.conv]: { ...t[d.conv] } }; delete n[d.conv]![m.authorId!]; return n })
  })
  useRealtime('chat.message.updated', (d: { room: string; conv: string; message: Message }) => {
    if (d.room !== code) return
    setConvs((l) => l.map((x) => (x.id === d.conv && x.last?.id === d.message.id ? { ...x, last: { ...x.last, text: d.message.text.slice(0, 120) } } : x)))
  })
  useRealtime('chat.message.deleted', (d: { room: string }) => { if (d.room === code) refreshSoon() })
  useRealtime('chat.conv', (d: { room: string }) => { if (d.room === code) refreshSoon() })
  useRealtime('chat.read', (d: { room: string; conv: string }) => { if (d.room === code) setConvs((l) => l.map((c) => (c.id === d.conv ? { ...c, unread: 0 } : c))) })
  useRealtime('chat.typing', (d: { room: string; conv: string; userId: string; name: string }) => {
    if (d.room !== code || d.userId === uid) return
    setTypingMap((t) => ({ ...t, [d.conv]: { ...t[d.conv], [d.userId]: { name: d.name, at: Date.now() } } }))
  })
  useEffect(() => {
    if (!Object.keys(typingMap).length) return
    const t = setInterval(() => setTypingMap((m) => {
      const now = Date.now()
      let changed = false
      const out: typeof m = {}
      for (const [c, who] of Object.entries(m)) {
        const kept = Object.fromEntries(Object.entries(who).filter(([, v]) => now - v.at < 4500))
        if (Object.keys(kept).length !== Object.keys(who).length) changed = true
        if (Object.keys(kept).length) out[c] = kept
      }
      return changed ? out : m
    }), 1000)
    return () => clearInterval(t)
  }, [typingMap])

  const typing = useCallback((id: string) => Object.values(typingMap[id] ?? {}).map((v) => v.name), [typingMap])
  const unread = useMemo(() => convs.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0), [convs])
  const people = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])
  const title = useCallback((c: Conv) => {
    if (c.kind === 'ROOM') return 'General'
    if (c.kind === 'GROUP') return c.name ?? 'Grupo'
    return (c.otherUserId && people.get(c.otherUserId)?.displayName) || 'Mensaje directo'
  }, [people])
  const conv = useCallback((id: string) => convs.find((c) => c.id === id), [convs])

  const value = useMemo<ChatState>(() => ({
    room, online, convs, loaded, unread, conv, refresh, patch, markRead, narrow, fullOpen, openFull: onOpenFull, dock, setDockOpen, openWindow, closeWindow, toggleMin,
    startDm, typing, setViewing, title,
  }), [room, online, convs, loaded, unread, conv, refresh, patch, markRead, narrow, fullOpen, onOpenFull, dock, setDockOpen, openWindow, closeWindow, toggleMin, startDm, typing, setViewing, title])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

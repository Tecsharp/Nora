import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BellOff, Check, Clock, Copy, Hash, LayoutDashboard, LayoutGrid, MessageSquare, Plus, Settings, ShieldCheck, Trash2, Users } from 'lucide-react'
import type { Room } from '../api'
import { useChat } from '../chat/ChatProvider'
import type { Conv } from '../chat/chatApi'
import Avatar from '../components/Avatar'
import { remaining } from '../time'
import { OVERVIEW, PEOPLE, TOOLS, type ToolDef } from './tools'

/** Herramientas que se ven por defecto en la barra lateral; el resto está en «Todas las herramientas». */
export const DEFAULT_PINNED = ['files', 'actions', 'calendar', 'calls']
export const MAX_PINNED = 4

interface Props {
  room: Room
  active: string
  online: Set<string>
  pinned: string[]
  onSelect: (id: string) => void
  /** Abre el panel con todas las herramientas. */
  onLauncher: () => void
  badges: Record<string, ReactNode>
  owner: boolean
  copied: boolean
  onCopy: () => void
  onExtend: () => void
  onSettings: () => void
  onClose: () => void
  connection: 'open' | 'connecting' | 'offline'
  secure: boolean
  requests: number
  expired: boolean
}

const SHOWN = 5 // conversaciones que se ven por sección antes de «Ver todas»
const SIZE_KEY = 'nora-nav-chats-h'
const MIN_H = 72

/** Alto elegido para la lista de conversaciones; null = se ajusta a lo que hay (sin espacio vacío). */
function useChatsHeight() {
  const [h, setH] = useState<number | null>(() => { try { const v = Number(localStorage.getItem(SIZE_KEY)); return v >= MIN_H ? v : null } catch { return null } })
  const save = (v: number | null) => {
    setH(v)
    try { if (v == null) localStorage.removeItem(SIZE_KEY); else localStorage.setItem(SIZE_KEY, String(Math.round(v))) } catch { /* sin almacenamiento */ }
  }
  return [h, save] as const
}

/**
 * Barra lateral de la sala. Arriba, lo que más se usa: las conversaciones (general, grupos y mensajes directos, con lo que no has leído);
 * abajo, siempre a la vista, el Resumen, las Personas y solo cuatro herramientas. Las demás están en «Todas las herramientas».
 */
export default function RoomNav(p: Props) {
  const { room, active, online } = p
  const chat = useChat()
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [chatsH, setChatsH] = useChatsHeight()
  const chatsRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  // lo más alto que puede ser sin tapar las herramientas ni el pie de la barra
  const maxH = () => {
    const nav = navRef.current
    if (!nav) return MIN_H
    const others = Array.from(nav.children).reduce((n, el) => (el === chatsRef.current ? n : n + el.getBoundingClientRect().height), 0)
    return Math.max(MIN_H, nav.clientHeight - others)
  }
  const clampH = (v: number) => Math.min(maxH(), Math.max(MIN_H, v))

  // arrastrar la barra que está encima de Resumen y Personas agranda o achica la lista de conversaciones
  const startResize = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const y0 = e.clientY
    const h0 = chatsRef.current?.getBoundingClientRect().height ?? MIN_H
    handle.setPointerCapture(e.pointerId)
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => setChatsH(clampH(h0 + ev.clientY - y0))
    const up = () => { document.body.style.userSelect = ''; handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up) }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const keyResize = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = chatsRef.current?.getBoundingClientRect().height ?? MIN_H
    if (e.key === 'ArrowUp') { e.preventDefault(); setChatsH(clampH(cur - 24)) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setChatsH(clampH(cur + 24)) }
    else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setChatsH(null) }
  }
  const onlineList = room.participants.filter((x) => online.has(x.userId))
  const people = new Map(room.participants.map((x) => [x.userId, x]))

  const general = chat.convs.find((c) => c.kind === 'ROOM')
  const groups = chat.convs.filter((c) => c.kind === 'GROUP')
  const dms = chat.convs.filter((c) => c.kind === 'DM')

  const unreadBadge = (c: Conv) => (c.unread > 0 && !c.muted ? <span className="ws-badge hot" aria-label={`${c.unread} sin leer`}>{c.unread > 99 ? '99+' : c.unread}</span> : c.muted ? <BellOff size={12} className="ws-muted-ico" aria-label="Silenciada" /> : null)

  const conv = (c: Conv) => {
    const other = c.kind === 'DM' && c.otherUserId ? people.get(c.otherUserId) : undefined
    return (
      <li key={c.id}>
        <button className={`ws-item ws-conv ${c.unread > 0 && !c.muted ? 'unread' : ''}`} onClick={() => chat.openFull(c.id)} title={chat.title(c)}>
          {c.kind === 'DM' && other
            ? <span className="ws-av"><Avatar name={other.displayName} userId={other.userId} version={other.avatarVersion} size={22} />{online.has(other.userId) && <i className="ws-on" aria-label="En línea" />}</span>
            : c.kind === 'ROOM' ? <span className="ws-cdot general"><Hash size={13} /></span>
              : <span className="ws-cdot" style={{ background: c.color ?? 'var(--accent)' }}>{chat.title(c).slice(0, 1).toUpperCase()}</span>}
          <span className="ws-item-label">{chat.title(c)}</span>
          {unreadBadge(c)}
        </button>
      </li>
    )
  }
  const section = (key: string, label: string, list: Conv[]) => {
    if (!list.length) return null
    const open = more[key]
    const shown = open ? list : list.slice(0, SHOWN)
    const hidden = list.length - shown.length
    const hiddenUnread = list.slice(SHOWN).reduce((n, c) => n + (c.muted ? 0 : c.unread), 0)
    return (
      <div key={key}>
        <h6 className="ws-h">{label}</h6>
        <ul className="ws-list">{shown.map(conv)}</ul>
        {hidden > 0 && <button className="ws-more" onClick={() => setMore((m) => ({ ...m, [key]: true }))}>Ver {hidden} más{hiddenUnread > 0 && <span className="ws-badge hot">{hiddenUnread}</span>}</button>}
        {open && list.length > SHOWN && <button className="ws-more" onClick={() => setMore((m) => ({ ...m, [key]: false }))}>Ver menos</button>}
      </div>
    )
  }

  const tool = (t: ToolDef) => (
    <li key={t.id}>
      <button className={`ws-item ${active === t.id ? 'on' : ''}`} onClick={() => p.onSelect(t.id)} aria-current={active === t.id ? 'page' : undefined}>
        <t.icon size={17} />
        <span className="ws-item-label">{t.label}</span>
        {p.badges[t.id]}
      </button>
    </li>
  )
  const pinnedTools = p.pinned.slice(0, MAX_PINNED).map((id) => TOOLS.find((t) => t.id === id)).filter((t): t is ToolDef => !!t)
  // la herramienta abierta que no está fijada se ve igualmente mientras se usa, para saber dónde estás
  const current = TOOLS.find((t) => t.id === active && !pinnedTools.some((x) => x.id === t.id) && t.id !== 'chat')

  return (
    <aside className="ws-nav" ref={navRef} aria-label="Navegación de la sala">
      <div className="ws-room">
        <Link to="/" className="ws-back"><ArrowLeft size={14} /> Mis salas</Link>
        <h2 className="ws-room-name" title={room.name}>{room.name}</h2>
        <div className="ws-room-meta">
          <button className="ws-chip mono" onClick={p.onCopy} title="Copiar código de la sala" aria-label={`Copiar código ${room.code}`}>
            {p.copied ? <Check size={13} /> : <Copy size={13} />} {room.code}
          </button>
          <button className={`ws-chip ${p.expired ? 'bad' : ''}`} disabled={!p.owner} onClick={p.onExtend} title={p.owner ? 'Extender o reducir la sala' : undefined}>
            <Clock size={13} /> {remaining(room.expiresAt).replace('Expira en ', '')}
          </button>
        </div>
      </div>

      <nav className={`ws-scroll ws-chats ${chatsH != null ? 'sized' : ''}`} ref={chatsRef} style={chatsH != null ? { height: chatsH } : undefined} aria-label="Conversaciones">
        <div className="ws-chats-head">
          <button className={`ws-chats-title ${active === 'chat' ? 'on' : ''}`} onClick={() => chat.openFull()} title="Abrir todas las conversaciones">
            <MessageSquare size={15} /> Mensajes {chat.unread > 0 && <span className="ws-badge hot">{chat.unread > 99 ? '99+' : chat.unread}</span>}
          </button>
          <button className="icon-btn sm" onClick={() => chat.openFull()} aria-label="Nueva conversación" title="Nuevo grupo o mensaje directo"><Plus size={16} /></button>
        </div>
        {general && <ul className="ws-list">{conv(general)}</ul>}
        {section('groups', 'Grupos', groups)}
        {section('dms', 'Mensajes directos', dms)}
        {chat.loaded && !groups.length && !dms.length && (
          <p className="ws-empty">Crea un grupo o escribe a alguien desde <button onClick={() => chat.openFull()}>Mensajes</button>.</p>
        )}
      </nav>

      <div
        className="ws-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Cambiar el tamaño de la lista de conversaciones"
        title="Cambiar el tamaño de la lista"
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => setChatsH(null)}
        onKeyDown={keyResize}
      ><i /></div>

      <div className="ws-tools" aria-label="Sala y herramientas">
        <div className="ws-pair">
          <button className={`ws-mini ${active === OVERVIEW ? 'on' : ''}`} onClick={() => p.onSelect(OVERVIEW)} aria-current={active === OVERVIEW ? 'page' : undefined}><LayoutDashboard size={15} /> Resumen</button>
          <button className={`ws-mini ${active === PEOPLE.id ? 'on' : ''}`} onClick={() => p.onSelect(PEOPLE.id)} aria-current={active === PEOPLE.id ? 'page' : undefined}>
            <Users size={15} /> Personas {p.requests > 0 ? <span className="ws-badge hot" title="Solicitudes de entrada">{p.requests}</span> : <span className="ws-count">{room.participants.length}</span>}
          </button>
        </div>
        <ul className="ws-list">
          {pinnedTools.map(tool)}
          {current && tool(current)}
        </ul>
        <button className="ws-launch" onClick={p.onLauncher}><LayoutGrid size={16} /> Todas las herramientas</button>
      </div>

      <div className="ws-foot">
        <button className="ws-online" onClick={() => p.onSelect(PEOPLE.id)} aria-label={`${onlineList.length} personas en línea. Ver personas`}>
          <span className="ws-stack">
            {onlineList.slice(0, 4).map((x) => <Avatar key={x.userId} name={x.displayName} userId={x.userId} version={x.avatarVersion} size={24} />)}
          </span>
          <span className="ws-online-txt"><b>{onlineList.length}</b> en línea</span>
        </button>
        <div className="ws-foot-row">
          <span className={`ws-conn ${p.connection}`} title={p.secure ? 'Conexión cifrada' : 'Conexión local (HTTP)'}>
            <i /> {p.connection === 'open' ? 'En vivo' : p.connection === 'connecting' ? 'Conectando…' : 'Sin conexión'}
            {p.secure && <ShieldCheck size={13} />}
          </span>
          <span className="spacer" />
          {p.owner && <button className="icon-btn sm" onClick={p.onSettings} aria-label="Opciones de la sala" title="Opciones de la sala"><Settings size={16} /></button>}
          {p.owner && <button className="icon-btn sm danger" onClick={p.onClose} aria-label="Cerrar sala" title="Cerrar sala"><Trash2 size={16} /></button>}
        </div>
      </div>
    </aside>
  )
}

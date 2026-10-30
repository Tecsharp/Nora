import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Clock, Copy, LayoutDashboard, Pin, PinOff, Settings, ShieldCheck, Trash2 } from 'lucide-react'
import type { Room } from '../api'
import Avatar from '../components/Avatar'
import { remaining } from '../time'
import { GROUPS, OVERVIEW, PEOPLE, TOOLS, type ToolDef } from './tools'

interface Props {
  room: Room
  active: string
  online: Set<string>
  pinned: string[]
  onTogglePin: (id: string) => void
  onSelect: (id: string) => void
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

/** Barra lateral de la sala: datos de la sala, herramientas agrupadas (con fijadas arriba) y las personas conectadas. */
export default function RoomNav(p: Props) {
  const { room, active, online, pinned } = p
  const onlineList = room.participants.filter((x) => online.has(x.userId))
  const item = (t: ToolDef) => (
    <li key={t.id}>
      <button className={`ws-item ${active === t.id ? 'on' : ''}`} onClick={() => p.onSelect(t.id)} aria-current={active === t.id ? 'page' : undefined}>
        <t.icon size={17} />
        <span className="ws-item-label">{t.label}</span>
        {p.badges[t.id]}
        <span className="ws-pin" role="button" tabIndex={0} aria-pressed={pinned.includes(t.id)} aria-label={pinned.includes(t.id) ? `Desfijar ${t.label}` : `Fijar ${t.label}`} title={pinned.includes(t.id) ? 'Quitar de fijadas' : 'Fijar arriba'}
          onClick={(e) => { e.stopPropagation(); p.onTogglePin(t.id) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); p.onTogglePin(t.id) } }}>
          {pinned.includes(t.id) ? <PinOff size={13} /> : <Pin size={13} />}
        </span>
      </button>
    </li>
  )
  const pinnedTools = pinned.map((id) => TOOLS.find((t) => t.id === id)).filter((t): t is ToolDef => !!t)

  return (
    <aside className="ws-nav" aria-label="Navegación de la sala">
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

      <nav className="ws-scroll">
        <ul className="ws-list">
          <li>
            <button className={`ws-item ${active === OVERVIEW ? 'on' : ''}`} onClick={() => p.onSelect(OVERVIEW)} aria-current={active === OVERVIEW ? 'page' : undefined}>
              <LayoutDashboard size={17} /><span className="ws-item-label">Resumen</span>
            </button>
          </li>
          <li>
            <button className={`ws-item ${active === PEOPLE.id ? 'on' : ''}`} onClick={() => p.onSelect(PEOPLE.id)} aria-current={active === PEOPLE.id ? 'page' : undefined}>
              <PEOPLE.icon size={17} /><span className="ws-item-label">Personas</span>
              {p.requests > 0 ? <span className="ws-badge hot" title="Solicitudes de entrada">{p.requests}</span> : <span className="ws-count">{room.participants.length}</span>}
            </button>
          </li>
        </ul>
        {pinnedTools.length > 0 && (
          <>
            <h6 className="ws-h">Fijadas</h6>
            <ul className="ws-list">{pinnedTools.map(item)}</ul>
          </>
        )}
        {GROUPS.map((g) => {
          const list = TOOLS.filter((t) => t.group === g.id && !pinned.includes(t.id))
          return list.length ? (
            <div key={g.id}>
              <h6 className="ws-h">{g.label}</h6>
              <ul className="ws-list">{list.map(item)}</ul>
            </div>
          ) : null
        })}
      </nav>

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

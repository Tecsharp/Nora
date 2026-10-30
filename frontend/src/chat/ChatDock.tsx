import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, ChevronDown, ChevronUp, Maximize2, MessageSquare, Minus, Search, Settings2, UserPlus, X } from 'lucide-react'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import { useToast } from '../toast'
import { ConvAvatar, relTime, useConvSubtitle } from './ChatBits'
import ChatPane from './ChatPane'
import { useChat } from './ChatProvider'
import { ConvInfoDialog } from './ConvInfo'
import type { Conv } from './chatApi'
import { NewGroupDialog } from './GroupDialogs'
import { useMessages } from './useMessages'

/**
 * Dock de chat abajo a la derecha, como el de Facebook o Google Workspace: el panel de contactos en la esquina y, a su izquierda,
 * las conversaciones abiertas como ventanas que se pueden minimizar. Va por el mismo WebSocket que el resto de la sala.
 */
export default function ChatDock() {
  const chat = useChat()
  const { dock, narrow, fullOpen, convs } = chat
  useEffect(() => { document.body.classList.add('has-cdock'); return () => document.body.classList.remove('has-cdock') }, [])
  if (fullOpen) return null
  const wins = narrow ? [] : dock.wins.map((w) => ({ w, c: convs.find((c) => c.id === w.id) })).filter((x): x is { w: typeof x.w; c: Conv } => !!x.c)
  // en el <body>: la página tiene animaciones con transform, que harían que «fixed» se midiera contra ella y no contra el navegador
  return createPortal(
    <div className="cdock" role="complementary" aria-label="Chat">
      <ContactsPanel />
      {wins.map(({ w, c }) => <DockWindow key={w.id} conv={c} min={w.min} />)}
    </div>,
    document.body,
  )
}

function ContactsPanel() {
  const chat = useChat()
  const { user } = useAuth()
  const toast = useToast()
  const { room, online, convs, dock, unread, narrow } = chat
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const search = q.trim().toLowerCase()

  const chats = useMemo(() => convs.filter((c) => c.kind !== 'DM' || c.last || c.createdBy === user?.id).filter((c) => !search || chat.title(c).toLowerCase().includes(search)),
    [convs, search, chat, user?.id])
  const people = useMemo(() => room.participants.filter((p) => p.userId !== user?.id && (!search || p.displayName.toLowerCase().includes(search)))
    .sort((a, b) => Number(online.has(b.userId)) - Number(online.has(a.userId)) || a.displayName.localeCompare(b.displayName)), [room.participants, user?.id, search, online])

  const open = !narrow && dock.open
  const onlineCount = room.participants.filter((p) => online.has(p.userId)).length

  const talk = async (userId: string) => {
    const existing = convs.find((c) => c.kind === 'DM' && c.otherUserId === userId)
    if (existing) return chat.openWindow(existing.id)
    try { await chat.startDm(userId) } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el chat', 'error') }
  }

  return (
    <section className={`cpanel ${open ? 'open' : ''}`}>
      <button className="cpanel-head" aria-expanded={open} onClick={() => (narrow ? chat.openFull() : chat.setDockOpen(!dock.open))}>
        <MessageSquare size={17} />
        <strong>Chat</strong>
        <span className="muted small">{onlineCount} en línea</span>
        {unread > 0 && <span className="cbadge">{unread > 99 ? '99+' : unread}</span>}
        <span className="spacer" />
        {!narrow && (open ? <ChevronDown size={16} /> : <ChevronUp size={16} />)}
      </button>
      {open && (
        <>
          <div className="cpanel-tools">
            <label className="kb-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar en el chat" /></label>
            <button className="icon-btn sm" title="Nuevo grupo" aria-label="Nuevo grupo" onClick={() => setCreating(true)}><UserPlus size={16} /></button>
            <button className="icon-btn sm" title="Abrir el chat completo" aria-label="Abrir el chat completo" onClick={() => chat.openFull()}><Maximize2 size={15} /></button>
          </div>
          <div className="cpanel-body">
            {chats.length > 0 && <h5>Chats</h5>}
            <ul>
              {chats.map((c) => (
                <li key={c.id}>
                  <button className={`crow ${c.unread && !c.muted ? 'unread' : ''}`} onClick={() => chat.openWindow(c.id)}>
                    <ConvAvatar conv={c} size={34} />
                    <span className="crow-txt">
                      <b className="truncate">{chat.title(c)}</b>
                      <small className="truncate">{c.last ? `${c.last.kind === 'SYSTEM' ? '' : c.last.authorId === user?.id ? 'Tú: ' : c.kind === 'DM' ? '' : `${c.last.authorName.split(' ')[0]}: `}${c.last.text}` : c.kind === 'ROOM' ? 'Todas las personas de la sala' : 'Sin mensajes'}</small>
                    </span>
                    <span className="crow-meta">
                      {c.last && <time>{relTime(c.last.createdAt)}</time>}
                      {c.muted ? <BellOff size={12} /> : c.unread > 0 && <span className="cbadge">{c.unread > 99 ? '99+' : c.unread}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <h5>En la sala · {room.participants.length - 1}</h5>
            <ul>
              {people.map((p) => (
                <li key={p.userId}>
                  <button className="crow" onClick={() => void talk(p.userId)}>
                    <Avatar name={p.displayName} userId={p.userId} version={p.avatarVersion} online={online.has(p.userId)} size={30} />
                    <span className="crow-txt"><b className="truncate">{p.displayName}</b><small>{online.has(p.userId) ? 'Conectado' : 'Desconectado'}</small></span>
                  </button>
                </li>
              ))}
              {people.length === 0 && <li className="muted small cpanel-none">{search ? 'Nada que coincida' : 'Aún no hay nadie más en la sala'}</li>}
            </ul>
          </div>
        </>
      )}
      {creating && <NewGroupDialog onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); chat.openWindow(c.id) }} />}
    </section>
  )
}

function DockWindow({ conv, min }: { conv: Conv; min: boolean }) {
  const chat = useChat()
  const store = useMessages(chat.room.code, conv.id)
  const sub = useConvSubtitle(conv)
  const [info, setInfo] = useState(false)
  return (
    <section className={`cwin ${min ? 'min' : ''}`} aria-label={`Chat con ${chat.title(conv)}`}
      onKeyDown={(e) => {
        // Esc cierra la ventana, salvo que lo haya usado algo de dentro (cancelar respuesta, menciones…) o venga de un diálogo abierto encima
        if (e.key === 'Escape' && !e.defaultPrevented && e.currentTarget.contains(e.target as Node)) { e.stopPropagation(); chat.closeWindow(conv.id) }
      }}>
      <header className="cwin-head" tabIndex={0} onClick={() => chat.toggleMin(conv.id)}>
        <ConvAvatar conv={conv} size={30} />
        <span className="cwin-title">
          <b className="truncate">{chat.title(conv)}</b>
          {!min && <small className="truncate">{sub}</small>}
        </span>
        {min && conv.unread > 0 && !conv.muted && <span className="cbadge">{conv.unread > 99 ? '99+' : conv.unread}</span>}
        <span className="cwin-btns" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn sm" aria-label="Ajustes del chat" title="Ajustes" onClick={() => setInfo(true)}><Settings2 size={15} /></button>
          <button className="icon-btn sm" aria-label="Abrir en el chat completo" title="Abrir en el chat completo" onClick={() => chat.openFull(conv.id)}><Maximize2 size={14} /></button>
          <button className="icon-btn sm" aria-label={min ? 'Restaurar' : 'Minimizar'} title={min ? 'Restaurar' : 'Minimizar'} onClick={() => chat.toggleMin(conv.id)}><Minus size={15} /></button>
          <button className="icon-btn sm" aria-label="Cerrar" title="Cerrar" onClick={() => chat.closeWindow(conv.id)}><X size={15} /></button>
        </span>
      </header>
      {!min && <ChatPane conv={conv} store={store} variant="window" />}
      {info && <ConvInfoDialog conv={conv} onClose={() => setInfo(false)} />}
    </section>
  )
}

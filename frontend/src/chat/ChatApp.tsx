import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BellOff, Info, MessageSquarePlus, Pin, Search, Sparkles, UserPlus } from 'lucide-react'
import { useAuth } from '../auth'
import AiAssist, { type AiAction } from '../ai/AiAssist'
import { useToast } from '../toast'
import type { FocusTarget } from '../tools/focus'
import { ConvAvatar, relTime, useConvSubtitle } from './ChatBits'
import ChatPane from './ChatPane'
import { useChat } from './ChatProvider'
import ConvInfo from './ConvInfo'
import { chatApi, type Conv } from './chatApi'
import { NewDmDialog, NewGroupDialog } from './GroupDialogs'
import { useMessages } from './useMessages'

type Filter = 'all' | 'unread' | 'groups' | 'direct'
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'Todos' }, { id: 'unread', label: 'No leídos' }, { id: 'groups', label: 'Grupos' }, { id: 'direct', label: 'Directos' }]
const SUMMARY: AiAction[] = [{ id: 'sum', label: 'Resumir la conversación', task: 'chat_summary' }]

/** Vista completa del chat, al estilo de Telegram Web: todas las conversaciones a la izquierda y la elegida a la derecha, con sus ajustes. */
export default function ChatApp({ focus }: { focus?: FocusTarget | null }) {
  const chat = useChat()
  const { user } = useAuth()
  const toast = useToast()
  const { convs, loaded, room } = chat
  const [sel, setSel] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [info, setInfo] = useState(false)
  const [newGroup, setNewGroup] = useState(false)
  const [newDm, setNewDm] = useState(false)
  const [target, setTarget] = useState<{ id: string; nonce: number } | null>(null)
  const done = useRef(0)

  // desde una notificación: se abre la conversación y se va al mensaje
  useEffect(() => {
    if (!focus?.conv || done.current === focus.nonce || !convs.some((c) => c.id === focus.conv)) return
    done.current = focus.nonce
    setSel(focus.conv)
    if (focus.msg) setTarget({ id: focus.msg, nonce: focus.nonce })
  }, [focus, convs])
  // por defecto, la general (o la que se estaba mirando en el dock)
  useEffect(() => {
    if (sel || !loaded || chat.narrow || (focus?.conv && done.current !== focus.nonce)) return // en el móvil se empieza por la lista
    const dockFirst = chat.dock.wins.find((w) => !w.min && convs.some((c) => c.id === w.id))?.id
    setSel(dockFirst ?? convs.find((c) => c.kind === 'ROOM')?.id ?? convs[0]?.id ?? null)
  }, [sel, loaded, convs, chat.dock.wins, chat.narrow, focus])
  useEffect(() => { if (sel && loaded && !convs.some((c) => c.id === sel)) setSel(chat.narrow ? null : convs.find((c) => c.kind === 'ROOM')?.id ?? null) }, [convs, loaded, sel, chat.narrow])

  const search = q.trim().toLowerCase()
  const list = useMemo(() => convs.filter((c) => c.kind !== 'DM' || c.last || c.createdBy === user?.id).filter((c) => {
    if (search && !chat.title(c).toLowerCase().includes(search) && !(c.last?.text.toLowerCase().includes(search))) return false
    if (filter === 'unread') return c.unread > 0
    if (filter === 'groups') return c.kind === 'GROUP' || c.kind === 'ROOM'
    if (filter === 'direct') return c.kind === 'DM'
    return true
  }), [convs, search, filter, chat, user?.id])
  const current = convs.find((c) => c.id === sel) ?? null

  const openDm = async (userId: string) => {
    setNewDm(false)
    try {
      const c = await chatApi.dm(room.code, userId)
      chat.patch(c)
      setSel(c.id)
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el chat', 'error') }
  }

  return (
    <div className={`capp ${current ? 'has-conv' : ''} ${info ? 'with-info' : ''}`}>
      <aside className="capp-side" aria-label="Conversaciones">
        <div className="capp-side-head">
          <h3>Chats</h3>
          <button className="icon-btn" title="Nuevo mensaje" aria-label="Nuevo mensaje" onClick={() => setNewDm(true)}><MessageSquarePlus size={18} /></button>
          <button className="icon-btn" title="Nuevo grupo" aria-label="Nuevo grupo" onClick={() => setNewGroup(true)}><UserPlus size={18} /></button>
        </div>
        <label className="kb-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar chats y mensajes…" aria-label="Buscar chats" /></label>
        <div className="capp-filters" role="tablist">
          {FILTERS.map((f) => <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        <ul className="capp-list">
          {!loaded && <li className="muted small capp-none">Cargando…</li>}
          {list.map((c) => (
            <li key={c.id}>
              <button className={`capp-row ${c.id === sel ? 'on' : ''}`} onClick={() => setSel(c.id)} aria-current={c.id === sel}>
                <ConvAvatar conv={c} size={46} />
                <span className="capp-row-txt">
                  <span className="capp-row-top"><b className="truncate">{chat.title(c)}</b>{c.pinned && <Pin size={11} />}{c.last && <time>{relTime(c.last.createdAt)}</time>}</span>
                  <span className="capp-row-bot">
                    <span className="truncate">{c.last ? `${c.last.kind === 'SYSTEM' ? '' : c.last.authorId === user?.id ? 'Tú: ' : c.kind === 'DM' ? '' : `${c.last.authorName.split(' ')[0]}: `}${c.last.text}` : c.kind === 'ROOM' ? 'Todas las personas de la sala' : 'Sin mensajes todavía'}</span>
                    {c.muted && <BellOff size={13} />}
                    {c.unread > 0 && <span className={`cbadge ${c.muted ? 'muted' : ''}`}>{c.unread > 99 ? '99+' : c.unread}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {loaded && list.length === 0 && <li className="muted small capp-none">{search || filter !== 'all' ? 'Nada que coincida' : 'Aún no hay conversaciones'}</li>}
        </ul>
      </aside>
      <section className="capp-main">
        {current ? <Conversation key={current.id} conv={current} info={info} onInfo={() => setInfo((v) => !v)} onBack={() => setSel(null)} focusMsg={target} />
          : <div className="capp-blank"><Sparkles size={34} /><strong>Elige una conversación</strong><span className="small muted">O empieza un grupo o un mensaje directo con las personas de la sala.</span></div>}
      </section>
      {info && current && (
        <aside className="capp-info" aria-label="Ajustes de la conversación">
          <ConvInfo conv={current} onClose={() => setInfo(false)} onGone={() => { setInfo(false); setSel(null) }} />
        </aside>
      )}
      {newGroup && <NewGroupDialog onClose={() => setNewGroup(false)} onCreated={(c) => { setNewGroup(false); setSel(c.id) }} />}
      {newDm && <NewDmDialog onClose={() => setNewDm(false)} onPick={(id) => void openDm(id)} />}
    </div>
  )
}

function Conversation({ conv, info, onInfo, onBack, focusMsg }: { conv: Conv; info: boolean; onInfo: () => void; onBack: () => void; focusMsg: { id: string; nonce: number } | null }) {
  const chat = useChat()
  const store = useMessages(chat.room.code, conv.id)
  const sub = useConvSubtitle(conv)
  const text = () => store.items.filter((m) => m.kind === 'TEXT').slice(-120).map((m) => `${m.authorName}: ${m.text}`).join('\n')
  return (
    <>
      <header className="capp-head">
        <button className="icon-btn capp-back" aria-label="Volver a los chats" onClick={onBack}><ArrowLeft size={18} /></button>
        <button className="capp-who" onClick={onInfo} aria-label="Ver ajustes de la conversación">
          <ConvAvatar conv={conv} size={40} />
          <span><b className="truncate">{chat.title(conv)}</b><small className="truncate">{sub}</small></span>
        </button>
        <span className="spacer" />
        <AiAssist actions={SUMMARY} getText={text} label="Resumir" title="Resumir la conversación con IA" disabled={store.items.length < 3} />
        <button className={`icon-btn ${info ? 'on' : ''}`} aria-label="Ajustes de la conversación" aria-pressed={info} title="Ajustes" onClick={onInfo}><Info size={18} /></button>
      </header>
      <ChatPane conv={conv} store={store} variant="full" focusMsg={focusMsg} />
    </>
  )
}

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, Check, CornerUpLeft, Copy, Pencil, Send, Smile, Sparkles, Trash2, X } from 'lucide-react'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import { useDialogs } from '../dialogs'
import { rt } from '../realtime'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useToast } from '../toast'
import { flash } from '../tools/focus'
import type { Conv, Message } from './chatApi'
import { useChat } from './ChatProvider'
import type { MessagesStore } from './useMessages'

const QUICK = ['👍', '❤️', '😂', '🎉', '👀', '🙏']
const PICKER = ['😀', '😄', '😅', '😂', '🙂', '😉', '😍', '🤔', '😮', '😢', '😡', '🙌', '👏', '💪', '🔥', '✨', '🎉', '✅', '❌', '⚠️', '💡', '📌', '🚀', '☕']
const GROUP_GAP_MS = 5 * 60_000

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const dayLabel = (d: Date) => {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, today)) return 'Hoy'
  if (sameDay(d, yesterday)) return 'Ayer'
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const clock = (d: Date) => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Texto con enlaces pulsables y @menciones resaltadas (sin HTML: nada del mensaje se interpreta). */
export function rich(text: string, names: string[], me: string): ReactNode[] {
  const mention = names.length ? `|@(?:${[...names].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})` : ''
  const re = new RegExp(`(https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)\\]'"])${mention}`, 'giu')
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('@')) out.push(<span key={k++} className={`chat-mention ${t.slice(1).toLowerCase() === me.toLowerCase() ? 'me' : ''}`}>{t}</span>)
    else out.push(<a key={k++} href={t} target="_blank" rel="noopener noreferrer">{t}</a>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface Props {
  conv: Conv
  store: MessagesStore
  variant: 'window' | 'full'
  /** Mensaje al que llevar (viene de una notificación). */
  focusMsg?: { id: string; nonce: number } | null
}

/** Mensajes y caja de escritura de una conversación. La usan la ventana del dock y la vista completa. */
export default function ChatPane({ conv, store, variant, focusMsg }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const chat = useChat()
  const { room, online } = chat
  const { items, loading, error, hasMore } = store
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [emojis, setEmojis] = useState(false)
  const [sending, setSending] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const count = useRef(0)
  const lastTyping = useRef(0)
  const firstUnread = useRef<string | null | undefined>(undefined) // se fija al abrir: «Mensajes nuevos» no se mueve mientras se lee
  const initial = useRef(true)

  const canWrite = canWriteIn(room, user) && !(conv.kind === 'GROUP' && conv.postPolicy === 'ADMINS' && conv.role !== 'ADMIN')
  const staff = conv.kind === 'ROOM' ? isStaffIn(room, user) : conv.kind === 'GROUP' && conv.role === 'ADMIN'
  const who = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])
  const names = useMemo(() => room.participants.map((p) => p.displayName), [room.participants])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const typers = chat.typing(conv.id)

  // quienes se pueden mencionar aquí
  const mentionable = useMemo(() => {
    const ids = conv.kind === 'ROOM' ? room.participants.map((p) => p.userId) : conv.kind === 'GROUP' ? conv.members.map((m) => m.userId) : [user?.id ?? '', conv.otherUserId ?? '']
    return ids.filter((id) => id && id !== user?.id).map((id) => who.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
  }, [conv, room.participants, who, user?.id])
  const mention = useMemo(() => {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(draft.slice(0, caret))
    if (!m) return null
    const q = m[1]!.toLowerCase()
    const opts = mentionable.filter((p) => p.displayName.toLowerCase().includes(q) || p.displayName.toLowerCase().split(' ').some((w) => w.startsWith(q))).slice(0, 6)
    return opts.length ? { q: m[1]!, opts, start: caret - m[1]!.length - 1 } : null
  }, [draft, caret, mentionable])
  useEffect(() => setPick(0), [mention?.q])

  const toBottom = useCallback((smooth = false) => {
    const el = list.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stick.current = true
    setUnseen(0)
  }, [])

  useLayoutEffect(() => {
    if (loading) return
    if (firstUnread.current === undefined) {
      const mark = conv.lastReadAt
      firstUnread.current = conv.unread > 0 && mark ? items.find((m) => m.kind === 'TEXT' && m.createdAt > mark && m.authorId !== user?.id)?.id ?? null : null
    }
    const added = items.length - count.current
    const last = items[items.length - 1]
    if (initial.current && items.length) {
      initial.current = false
      const first = firstUnread.current && list.current?.querySelector<HTMLElement>(`[data-msg="${firstUnread.current}"]`)
      if (first) { first.scrollIntoView({ block: 'center' }); stick.current = false } else toBottom()
    } else if (added > 0 && last) {
      if (stick.current || last.authorId === user?.id) toBottom(true)
      else setUnseen((n) => n + added)
    }
    count.current = items.length
  }, [items, loading, toBottom, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { firstUnread.current = undefined; initial.current = true; count.current = 0; setDraft(''); setReplyTo(null); setEditing(null) }, [conv.id])

  // lo que se está leyendo se marca como leído (si la pestaña está a la vista)
  useEffect(() => {
    chat.setViewing(conv.id, true)
    return () => chat.setViewing(conv.id, false)
  }, [conv.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loading || conv.unread === 0 || !document.hasFocus() || document.visibilityState !== 'visible') return
    chat.markRead(conv.id)
  }, [loading, conv.unread, conv.id, items.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => { if (conv.unread > 0 && !loading) chat.markRead(conv.id) }
    window.addEventListener('focus', on)
    return () => window.removeEventListener('focus', on)
  }, [conv.id, conv.unread, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ir a un mensaje concreto (notificaciones, citas)
  const jump = useCallback((id: string) => flash(`[data-msg="${id}"]`), [])
  const done = useRef(0)
  useEffect(() => {
    if (!focusMsg || loading || done.current === focusMsg.nonce) return
    if (byId.has(focusMsg.id)) { done.current = focusMsg.nonce; setTimeout(() => jump(focusMsg.id), 80) }
    else if (hasMore) void store.older()
    else done.current = focusMsg.nonce
  }, [focusMsg, loading, byId, hasMore, jump, store])

  const onScroll = () => {
    const el = list.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (stick.current) setUnseen(0)
  }
  const older = async () => {
    const el = list.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    await store.older()
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before })
  }

  const grow = () => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }
  useEffect(grow, [draft])

  const typed = (text: string) => {
    setDraft(text)
    if (text.trim() && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now()
      rt.notify({ type: 'chat.typing', conv: conv.id })
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      if (editing) await store.edit(editing.id, text)
      else await store.send(text, replyTo?.id)
      setDraft('')
      setReplyTo(null)
      setEditing(null)
      setEmojis(false)
      lastTyping.current = 0
      if (!editing) requestAnimationFrame(() => toBottom(true))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar el mensaje', 'error')
    } finally {
      setSending(false)
      input.current?.focus()
    }
  }

  const insertMention = (name: string) => {
    if (!mention) return
    const next = `${draft.slice(0, mention.start)}@${name} ${draft.slice(caret)}`
    const pos = mention.start + name.length + 2
    setDraft(next)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(pos, pos); setCaret(pos) })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return setPick((p) => (p + 1) % mention.opts.length) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setPick((p) => (p - 1 + mention.opts.length) % mention.opts.length) }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); return insertMention(mention.opts[pick]!.displayName) }
      if (e.key === 'Escape') { e.stopPropagation(); setCaret(0); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape' && (editing || replyTo)) {
      e.stopPropagation()
      setEditing(null)
      setReplyTo(null)
      setDraft('')
    }
  }

  const react = (m: Message, emoji: string) => store.react(m.id, emoji).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo reaccionar', 'error'))
  const startEdit = (m: Message) => {
    setEditing(m)
    setReplyTo(null)
    setDraft(m.text)
    requestAnimationFrame(() => input.current?.focus())
  }
  const del = async (m: Message) => {
    if (!(await dialogs.confirm({ title: '¿Borrar el mensaje?', message: 'Desaparecerá para todas las personas de esta conversación.', confirmLabel: 'Borrar', tone: 'danger', icon: 'trash' }))) return
    try { await store.remove(m.id) } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error') }
  }
  const insertEmoji = (e: string) => {
    const el = input.current
    const a = el?.selectionStart ?? draft.length
    const b = el?.selectionEnd ?? draft.length
    setDraft(draft.slice(0, a) + e + draft.slice(b))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + e.length, a + e.length) })
  }

  const rows: ReactNode[] = []
  let prev: Message | null = null
  for (const m of items) {
    const at = new Date(m.createdAt)
    const newDay = !prev || !sameDay(new Date(prev.createdAt), at)
    if (newDay) rows.push(<div key={`d${m.id}`} className="chat-day"><span>{dayLabel(at)}</span></div>)
    if (firstUnread.current === m.id) rows.push(<div key={`u${m.id}`} className="chat-unread"><span>Mensajes nuevos</span></div>)
    if (m.kind === 'SYSTEM') {
      rows.push(<div key={m.id} data-msg={m.id} className="chat-sys"><span>{m.text}</span></div>)
      prev = null
      continue
    }
    const head = newDay || !prev || prev.authorId !== m.authorId || prev.authorName !== m.authorName || at.getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS
    const mine = m.authorId === user?.id
    const author = m.authorId ? who.get(m.authorId) : undefined
    const quoted = m.replyTo ? byId.get(m.replyTo) : undefined
    const reactions = Object.entries(m.reactions ?? {})
    const showName = head && !mine && conv.kind !== 'DM'
    rows.push(
      <div key={m.id} data-msg={m.id} className={`chat-msg ${mine ? 'mine' : ''} ${head ? 'head' : 'cont'}`}>
        <div className="chat-av">{head && !mine && <Avatar name={m.authorName} userId={m.authorId ?? undefined} version={author?.avatarVersion} online={m.authorId ? online.has(m.authorId) : false} size={variant === 'window' ? 28 : 34} />}</div>
        <div className="chat-col">
          {showName && <div className="chat-meta"><strong>{m.authorName}</strong><time title={at.toLocaleString('es')}>{clock(at)}</time></div>}
          {head && !showName && <div className="chat-meta"><time title={at.toLocaleString('es')}>{clock(at)}</time></div>}
          <div className="chat-bubble-wrap">
            <div className="chat-bubble">
              {m.replyTo && (quoted
                ? <button type="button" className="chat-quote" onClick={() => jump(quoted.id)}><strong>{quoted.authorName}</strong><span>{quoted.text}</span></button>
                : <div className="chat-quote gone"><span>Mensaje borrado</span></div>)}
              <p>{rich(m.text, names, user?.displayName ?? '')}{m.edited && <small className="chat-edited"> (editado)</small>}</p>
            </div>
            <div className="chat-actions" role="toolbar" aria-label="Acciones del mensaje">
              {QUICK.slice(0, variant === 'window' ? 2 : 3).map((e) => <button key={e} type="button" className="chat-act" onClick={() => void react(m, e)} aria-label={`Reaccionar ${e}`}>{e}</button>)}
              <Menu label="Más reacciones" trigger={<span className="chat-act"><Smile size={15} /></span>}
                items={[{ heading: 'Reaccionar' }, ...QUICK.map((e) => ({ label: e, onClick: () => void react(m, e) }))]} />
              {canWrite && <button type="button" className="chat-act" aria-label="Responder" title="Responder" onClick={() => { setReplyTo(m); setEditing(null); input.current?.focus() }}><CornerUpLeft size={15} /></button>}
              <Menu label="Más acciones" items={[
                { label: 'Copiar texto', icon: <Copy size={16} />, onClick: () => void navigator.clipboard.writeText(m.text).then(() => toast('Copiado', 'success')) },
                ...(mine && canWrite ? [{ label: 'Editar', icon: <Pencil size={16} />, onClick: () => startEdit(m) }] : []),
                ...((mine || staff) && canWriteIn(room, user) ? [{ label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void del(m) }] : []),
              ]} />
            </div>
          </div>
          {reactions.length > 0 && (
            <div className="chat-reacts">
              {reactions.map(([e, ids]) => (
                <button key={e} type="button" className={`chat-react ${ids.includes(user?.id ?? '') ? 'on' : ''}`} title={ids.map((id) => who.get(id)?.displayName ?? 'Alguien').join(', ')} onClick={() => void react(m, e)}>{e} <span>{ids.length}</span></button>
              ))}
            </div>
          )}
        </div>
      </div>,
    )
    prev = m
  }

  const roLabel = !canWriteIn(room, user)
    ? <>Tu rol en esta sala es de <strong>lector</strong>: puedes leer y reaccionar, pero no escribir.</>
    : <>En este grupo solo escriben las personas <strong>administradoras</strong>.</>

  return (
    <div className={`chat ${variant}`}>
      <div className="chat-list" ref={list} onScroll={onScroll} aria-live="polite" aria-label="Mensajes">
        {hasMore && <button className="btn ghost sm chat-older" onClick={() => void older()}>Cargar mensajes anteriores</button>}
        {loading && <p className="muted small center-text">Cargando mensajes…</p>}
        {error && <p className="error small center-text">{error}</p>}
        {!loading && !items.length && !error && (
          <div className="chat-empty">
            <Sparkles size={variant === 'window' ? 22 : 30} />
            <strong>Aquí empieza la conversación</strong>
            <span className="small">{canWrite ? 'Escribe el primer mensaje: llegará en tiempo real.' : 'Todavía no hay mensajes.'}</span>
          </div>
        )}
        {rows}
      </div>
      {unseen > 0 && <button className="chat-new" onClick={() => toBottom(true)}><ArrowDown size={14} /> {unseen} {unseen === 1 ? 'nuevo' : 'nuevos'}</button>}
      <div className="chat-typing" aria-live="polite">{typers.length > 0 && <><span className="dots"><i /><i /><i /></span> {typers.length === 1 ? `${typers[0]} está escribiendo…` : `${typers.slice(0, 2).join(' y ')} están escribiendo…`}</>}</div>
      {canWrite ? (
        <div className="chat-composer">
          {(replyTo || editing) && (
            <div className="chat-ctx">
              {editing ? <Pencil size={14} /> : <CornerUpLeft size={14} />}
              <span className="truncate">{editing ? 'Editando tu mensaje' : <>Respondiendo a <strong>{replyTo!.authorName}</strong>: {replyTo!.text}</>}</span>
              <button className="icon-btn sm" aria-label="Cancelar" onClick={() => { setReplyTo(null); setEditing(null); setDraft('') }}><X size={14} /></button>
            </div>
          )}
          {mention && (
            <ul className="chat-mentions" role="listbox" aria-label="Mencionar">
              {mention.opts.map((p, i) => (
                <li key={p.userId} role="option" aria-selected={i === pick}>
                  <button type="button" className={i === pick ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); insertMention(p.displayName) }}>
                    <Avatar name={p.displayName} userId={p.userId} version={p.avatarVersion} online={online.has(p.userId)} size={22} /> {p.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="chat-input">
            <button type="button" className="icon-btn" aria-label="Emojis" aria-pressed={emojis} onClick={() => setEmojis((v) => !v)}><Smile size={19} /></button>
            <textarea ref={input} rows={1} value={draft} maxLength={4000} placeholder={variant === 'window' ? 'Escribe un mensaje…' : 'Escribe un mensaje…  (Enter envía, Mayús+Enter salto de línea)'} aria-label="Mensaje"
              onChange={(e) => { typed(e.target.value); setCaret(e.target.selectionStart) }} onKeyDown={onKey}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)} onClick={(e) => setCaret(e.currentTarget.selectionStart)} />
            <button className="btn primary chat-send" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label={editing ? 'Guardar cambios' : 'Enviar'}>{editing ? <Check size={17} /> : <Send size={17} />}</button>
          </div>
          {emojis && (
            <div className="chat-emojis" role="listbox" aria-label="Emojis">
              {PICKER.map((e) => <Fragment key={e}><button type="button" onClick={() => insertEmoji(e)}>{e}</button></Fragment>)}
            </div>
          )}
        </div>
      ) : <p className="callout small chat-ro">{roLabel}</p>}
    </div>
  )
}

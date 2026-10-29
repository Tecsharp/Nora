import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, Check, CornerUpLeft, Copy, Pencil, Send, Smile, Sparkles, Trash2, X } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import AiAssist, { type AiAction } from '../ai/AiAssist'
import { useItems, type Item } from './useItems'

interface ChatData {
  text: string
  replyTo?: string
  edited?: boolean
  reactions?: Record<string, string[]>
}

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
function rich(text: string, names: string[], me: string): ReactNode[] {
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

const SUMMARY: AiAction[] = [{ id: 'sum', label: 'Resumir la conversación', task: 'chat_summary' }]

export default function ChatTool({ room, online, onSeen }: { room: Room; online: Set<string>; onSeen?: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const { items, loading, error, hasMore, create, update, remove, act, loadOlder } = useItems<ChatData>(room.code, 'chat', { limit: 60 })
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Item<ChatData> | null>(null)
  const [editing, setEditing] = useState<Item<ChatData> | null>(null)
  const [emojis, setEmojis] = useState(false)
  const [sending, setSending] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true) // ¿está al final? Entonces los mensajes nuevos lo mantienen ahí
  const count = useRef(0)
  const names = useMemo(() => room.participants.map((p) => p.displayName), [room.participants])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const who = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])

  const toBottom = useCallback((smooth = false) => {
    const el = list.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stick.current = true
    setUnseen(0)
  }, [])

  // al llegar mensajes: si se estaba al final, se baja; si no, se avisa («N nuevos»)
  useLayoutEffect(() => {
    const added = items.length - count.current
    const last = items[items.length - 1]
    if (count.current === 0 && items.length) toBottom()
    else if (added > 0 && last) {
      if (stick.current || last.authorId === user?.id) toBottom(true)
      else setUnseen((n) => n + added)
    }
    count.current = items.length
  }, [items, toBottom, user?.id])

  useEffect(() => { onSeen?.() }, [items.length, onSeen])

  const onScroll = () => {
    const el = list.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (stick.current) setUnseen(0)
  }

  const older = async () => {
    const el = list.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    await loadOlder()
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before })
  }

  const grow = () => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }
  useEffect(grow, [draft])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      if (editing) await update(editing.id, { text, replyTo: editing.data.replyTo })
      else await create({ text, replyTo: replyTo?.id })
      setDraft('')
      setReplyTo(null)
      setEditing(null)
      setEmojis(false)
      if (!editing) requestAnimationFrame(() => toBottom(true))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar el mensaje', 'error')
    } finally {
      setSending(false)
      input.current?.focus()
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape' && (editing || replyTo)) {
      setEditing(null)
      setReplyTo(null)
      setDraft('')
    }
  }

  const react = (m: Item<ChatData>, emoji: string) => act(m.id, 'react', { emoji }).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo reaccionar', 'error'))
  const startEdit = (m: Item<ChatData>) => {
    setEditing(m)
    setReplyTo(null)
    setDraft(m.data.text)
    requestAnimationFrame(() => input.current?.focus())
  }
  const del = async (m: Item<ChatData>) => {
    if (!(await dialogs.confirm({ title: '¿Borrar el mensaje?', message: 'Desaparecerá para todas las personas de la sala.', confirmLabel: 'Borrar', tone: 'danger', icon: 'trash' }))) return
    try {
      await remove(m.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error')
    }
  }
  const jump = (id: string) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-msg="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.classList.add('flash')
    setTimeout(() => el?.classList.remove('flash'), 1400)
  }
  const insertEmoji = (e: string) => {
    const el = input.current
    const a = el?.selectionStart ?? draft.length
    const b = el?.selectionEnd ?? draft.length
    setDraft(draft.slice(0, a) + e + draft.slice(b))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + e.length, a + e.length) })
  }
  const onlineCount = room.participants.filter((p) => online.has(p.userId)).length
  const last40 = () => items.slice(-120).map((m) => `${m.authorName}: ${m.data.text}`).join('\n')

  const rows: ReactNode[] = []
  let prev: Item<ChatData> | null = null
  for (const m of items) {
    const at = new Date(m.createdAt)
    const newDay = !prev || !sameDay(new Date(prev.createdAt), at)
    if (newDay) rows.push(<div key={`d${m.id}`} className="chat-day"><span>{dayLabel(at)}</span></div>)
    const head = newDay || prev!.authorId !== m.authorId || prev!.authorName !== m.authorName || at.getTime() - new Date(prev!.createdAt).getTime() > GROUP_GAP_MS
    const mine = m.authorId === user?.id
    const author = m.authorId ? who.get(m.authorId) : undefined
    const quoted = m.data.replyTo ? byId.get(m.data.replyTo) : undefined
    const reactions = Object.entries(m.data.reactions ?? {})
    rows.push(
      <div key={m.id} data-msg={m.id} className={`chat-msg ${mine ? 'mine' : ''} ${head ? 'head' : 'cont'}`}>
        <div className="chat-av">{head && <Avatar name={m.authorName} userId={m.authorId ?? undefined} version={author?.avatarVersion} online={m.authorId ? online.has(m.authorId) : false} size={34} />}</div>
        <div className="chat-col">
          {head && <div className="chat-meta"><strong>{mine ? 'Tú' : m.authorName}</strong><time title={at.toLocaleString('es')}>{clock(at)}</time></div>}
          <div className="chat-bubble-wrap">
            <div className="chat-bubble">
              {m.data.replyTo && (quoted
                ? <button type="button" className="chat-quote" onClick={() => jump(quoted.id)}><strong>{quoted.authorName}</strong><span>{quoted.data.text}</span></button>
                : <div className="chat-quote gone"><span>Mensaje borrado</span></div>)}
              <p>{rich(m.data.text, names, user?.displayName ?? '')}{m.data.edited && <small className="chat-edited"> (editado)</small>}</p>
            </div>
            <div className="chat-actions" role="toolbar" aria-label="Acciones del mensaje">
              {QUICK.slice(0, 3).map((e) => <button key={e} type="button" className="chat-act" onClick={() => void react(m, e)} aria-label={`Reaccionar ${e}`}>{e}</button>)}
              <Menu label="Más reacciones" trigger={<span className="chat-act"><Smile size={15} /></span>}
                items={[{ heading: 'Reaccionar' }, ...QUICK.map((e) => ({ label: e, onClick: () => void react(m, e) }))]} />
              {canWrite && <button type="button" className="chat-act" aria-label="Responder" title="Responder" onClick={() => { setReplyTo(m); setEditing(null); input.current?.focus() }}><CornerUpLeft size={15} /></button>}
              <Menu label="Más acciones" items={[
                { label: 'Copiar texto', icon: <Copy size={16} />, onClick: () => void navigator.clipboard.writeText(m.data.text).then(() => toast('Copiado', 'success')) },
                ...(mine && canWrite ? [{ label: 'Editar', icon: <Pencil size={16} />, onClick: () => startEdit(m) }] : []),
                ...((mine || staff) && canWrite ? [{ label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void del(m) }] : []),
              ]} />
            </div>
          </div>
          {reactions.length > 0 && (
            <div className="chat-reacts">
              {reactions.map(([e, ids]) => {
                const names2 = ids.map((id) => who.get(id)?.displayName ?? 'Alguien').join(', ')
                return <button key={e} type="button" className={`chat-react ${ids.includes(user?.id ?? '') ? 'on' : ''}`} title={names2} onClick={() => void react(m, e)}>{e} <span>{ids.length}</span></button>
              })}
            </div>
          )}
        </div>
      </div>,
    )
    prev = m
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="badge green"><i /> {onlineCount} {onlineCount === 1 ? 'conectado' : 'conectados'}</span>
        <span className="muted small">{room.participants.length} en la sala</span>
        <span className="spacer" />
        <AiAssist actions={SUMMARY} getText={last40} label="Resumir" title="Resumir la conversación con IA" disabled={items.length < 3} />
      </div>
      <div className="chat-list" ref={list} onScroll={onScroll} aria-live="polite" aria-label="Mensajes">
        {hasMore && <button className="btn ghost sm chat-older" onClick={() => void older()}>Cargar mensajes anteriores</button>}
        {loading && <p className="muted small center-text">Cargando mensajes…</p>}
        {error && <p className="error small center-text">{error}</p>}
        {!loading && !items.length && !error && (
          <div className="chat-empty">
            <Sparkles size={30} />
            <strong>Aquí empieza la conversación</strong>
            <span className="small">{canWrite ? 'Escribe el primer mensaje: lo verán todas las personas de la sala en tiempo real.' : 'Todavía no hay mensajes.'}</span>
          </div>
        )}
        {rows}
      </div>
      {unseen > 0 && <button className="chat-new" onClick={() => toBottom(true)}><ArrowDown size={14} /> {unseen} {unseen === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}</button>}
      {canWrite ? (
        <div className="chat-composer">
          {(replyTo || editing) && (
            <div className="chat-ctx">
              {editing ? <Pencil size={14} /> : <CornerUpLeft size={14} />}
              <span className="truncate">{editing ? 'Editando tu mensaje' : <>Respondiendo a <strong>{replyTo!.authorName}</strong>: {replyTo!.data.text}</>}</span>
              <button className="icon-btn sm" aria-label="Cancelar" onClick={() => { setReplyTo(null); setEditing(null); setDraft('') }}><X size={14} /></button>
            </div>
          )}
          <div className="chat-input">
            <button type="button" className="icon-btn" aria-label="Emojis" aria-pressed={emojis} onClick={() => setEmojis((v) => !v)}><Smile size={19} /></button>
            <textarea ref={input} rows={1} value={draft} maxLength={4000} placeholder="Escribe un mensaje…  (Enter envía, Mayús+Enter salto de línea)" aria-label="Mensaje"
              onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
            <button className="btn primary chat-send" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label={editing ? 'Guardar cambios' : 'Enviar'}>{editing ? <Check size={17} /> : <Send size={17} />}</button>
          </div>
          {emojis && (
            <div className="chat-emojis" role="listbox" aria-label="Emojis">
              {PICKER.map((e) => <Fragment key={e}><button type="button" onClick={() => insertEmoji(e)}>{e}</button></Fragment>)}
            </div>
          )}
        </div>
      ) : <p className="callout small chat-ro">Tu rol en esta sala es de <strong>lector</strong>: puedes leer y reaccionar, pero no escribir.</p>}
    </div>
  )
}

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Check, CornerUpLeft, Copy, Pencil, Send, Smile, SmilePlus, Sparkles, Trash2, X } from 'lucide-react'
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

interface Row { key: string; type: 'top' | 'end' | 'day' | 'unread' | 'sys' | 'msg'; m?: Message; head?: boolean; label?: string }

/** Mensajes y caja de escritura de una conversación. La usan la ventana del dock y la vista completa. */
export default function ChatPane({ conv, store, variant, focusMsg }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const chat = useChat()
  const { room, online } = chat
  const { items, loading, error } = store
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [emojis, setEmojis] = useState(false)
  const [sending, setSending] = useState(false)
  const [pickFor, setPickFor] = useState<string | null>(null) // mensaje con el selector de reacciones abierto
  const [activeMsg, setActiveMsg] = useState<string | null>(null) // mensaje tocado (en pantallas táctiles no hay «hover»)
  const [unseen, setUnseen] = useState(0)
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const vbox = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastId = useRef<string | null>(null)
  const anchor = useRef<{ key: string; start: number; top: number; view: number } | null>(null)
  const busy = useRef({ older: false, newer: false })
  const pendingJump = useRef<string | null>(null)
  const pinned = useRef(true) // pegada al final: las filas se miden después de pintarse y se sigue al final hasta que la persona mueva la lista
  const userAt = useRef(0) // última vez que la persona movió la lista (rueda, tacto, teclado, barra): solo eso la «despega» del final
  const [jumpTick, setJumpTick] = useState(0)
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

  // «Mensajes nuevos»: se fija al abrir y no se mueve mientras se lee
  if (!loading && firstUnread.current === undefined) {
    const mark = conv.lastReadAt
    firstUnread.current = conv.unread > 0 && mark ? items.find((m) => m.kind === 'TEXT' && m.createdAt > mark && m.authorId !== user?.id)?.id ?? null : null
  }
  const firstUnreadId = firstUnread.current ?? null

  // La lista es virtual: solo se pintan los mensajes que se ven (más unos pocos de margen), aunque la conversación tenga miles.
  const rows = useMemo<Row[]>(() => {
    // la primera fila es el botón de «anteriores» (o un hueco) y la última, un hueco: así los desplazamientos de la lista empiezan en cero y cuadran con la lista virtual
    const out: Row[] = [{ key: 'top', type: 'top' }]
    let prev: Message | null = null
    for (const m of items) {
      const at = new Date(m.createdAt)
      const newDay = !prev || !sameDay(new Date(prev.createdAt), at)
      if (newDay) out.push({ key: `d${m.id}`, type: 'day', label: dayLabel(at) })
      if (firstUnreadId === m.id) out.push({ key: `u${m.id}`, type: 'unread' })
      if (m.kind === 'SYSTEM') {
        out.push({ key: m.id, type: 'sys', m })
        prev = null
        continue
      }
      const head = newDay || !prev || prev.authorId !== m.authorId || prev.authorName !== m.authorName || at.getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS
      out.push({ key: m.id, type: 'msg', m, head })
      prev = m
    }
    out.push({ key: 'end', type: 'end' })
    return out
  }, [items, firstUnreadId])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => list.current, estimateSize: () => 76, overscan: 8, getItemKey: (i) => rows[i]?.key ?? i })

  const toBottom = useCallback(() => {
    const n = rowsRef.current.length
    if (n) virtualizer.scrollToIndex(n - 1, { align: 'end' })
    stick.current = true
    pinned.current = true
    setUnseen(0)
    // los mensajes se miden al pintarse: se corrige unos fotogramas para quedar de verdad al final
    let k = 0
    const fix = () => { const el = list.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; if (++k < 5) requestAnimationFrame(fix) }
    requestAnimationFrame(fix)
  }, [virtualizer])

  // Las filas se miden al pintarse y la altura total cambia: si se estaba al final, se sigue al final
  useEffect(() => {
    const box = vbox.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { const el = list.current; if (el && pinned.current) el.scrollTop = el.scrollHeight })
    ro.observe(box)
    return () => ro.disconnect()
  }, [loading])

  useLayoutEffect(() => {
    if (loading) return
    const el = list.current
    const last = items[items.length - 1]
    // se acaban de cargar mensajes anteriores: se mantiene en pantalla lo que se estaba leyendo
    if (anchor.current && el) {
      const a = anchor.current
      anchor.current = null
      const idx = rows.findIndex((r) => r.key === a.key)
      const start = idx >= 0 ? virtualizer.measurementsCache[idx]?.start : undefined
      if (start != null) el.scrollTop += start - a.start // lo añadido por encima (con alturas estimadas)
      // al pintarse las filas nuevas se miden y cambian de altura: unos fotogramas se recoloca lo leído en su sitio exacto
      const t0 = Date.now()
      const settle = () => {
        const list0 = list.current
        const node = list0?.querySelector<HTMLElement>(`[data-rowkey="${a.key}"]`)
        if (!list0 || !node || userAt.current > t0) return
        const diff = node.getBoundingClientRect().top - list0.getBoundingClientRect().top - a.view
        if (Math.abs(diff) > 1) list0.scrollTop += diff
        if (Date.now() - t0 < 700) requestAnimationFrame(settle)
      }
      requestAnimationFrame(settle)
      lastId.current = last?.id ?? null
      return
    }
    if (initial.current && items.length) {
      initial.current = false
      const idx = firstUnreadId ? rows.findIndex((r) => r.key === firstUnreadId) : -1
      if (idx >= 0) { virtualizer.scrollToIndex(idx, { align: 'center' }); stick.current = false; pinned.current = false } else toBottom()
    } else if (last && last.id !== lastId.current && !store.hasNewer) {
      const was = lastId.current ? items.findIndex((m) => m.id === lastId.current) : -1
      const added = was >= 0 ? items.length - 1 - was : 1
      if (stick.current || pinned.current || last.authorId === user?.id) toBottom()
      else if (added > 0) setUnseen((n) => n + added)
    }
    lastId.current = last?.id ?? null
  }, [items, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { firstUnread.current = undefined; initial.current = true; lastId.current = null; setDraft(''); setReplyTo(null); setEditing(null) }, [conv.id])

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

  // ir a un mensaje concreto (notificaciones, citas, resultados de búsqueda): si no está cargado se pide una ventana centrada en él
  const goTo = useCallback(async (id: string) => {
    const ok = await store.jump(id)
    if (!ok) return toast('Ese mensaje ya no existe', 'info')
    pendingJump.current = id
    setJumpTick((n) => n + 1)
  }, [store.jump, toast]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = pendingJump.current
    if (!id) return
    const idx = rows.findIndex((r) => r.key === id)
    if (idx < 0) return // la ventana aún no se pintó: se vuelve a intentar al cambiar las filas
    pendingJump.current = null
    stick.current = false
    pinned.current = false
    virtualizer.scrollToIndex(idx, { align: 'center' })
    setTimeout(() => flash(`[data-msg="${id}"]`), 140)
  }, [rows, jumpTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = useRef(0)
  useEffect(() => {
    if (!focusMsg || loading || done.current === focusMsg.nonce) return
    done.current = focusMsg.nonce
    void goTo(focusMsg.id)
  }, [focusMsg, loading, goTo])

  const older = useCallback(async () => {
    const el = list.current
    const first = virtualizer.getVirtualItems().find((v) => String(v.key) !== 'top' && v.end > (el?.scrollTop ?? 0))
    const node = first ? el?.querySelector<HTMLElement>(`[data-rowkey="${String(first.key)}"]`) : null
    if (el && first) anchor.current = { key: String(first.key), start: first.start, top: el.scrollTop, view: node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : first.start - el.scrollTop }
    try { await store.older() } finally { setTimeout(() => { anchor.current = null }, 80) }
  }, [store.older, virtualizer]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = list.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = dist < 80 && !store.hasNewer
    if (dist >= 80 && Date.now() - userAt.current < 700) pinned.current = false // la persona subió: se suelta del final
    if (stick.current) setUnseen(0)
    // al acercarse a un extremo se piden más mensajes solos
    if (el.scrollTop < 500 && store.hasMore && !busy.current.older) { busy.current.older = true; void older().finally(() => { busy.current.older = false }) }
    if (dist < 700 && store.hasNewer && !busy.current.newer) { busy.current.newer = true; void store.newer().finally(() => { busy.current.newer = false }) }
  }
  const goLatest = async () => {
    if (store.hasNewer) {
      stick.current = true
      await store.latest()
      initial.current = true // al terminar de cargar se baja al final
    } else toBottom()
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
      if (!editing) requestAnimationFrame(() => toBottom())
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
    if (emojis && e.key === 'Escape') { e.stopPropagation(); return setEmojis(false) }
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

  useEffect(() => {
    if (!pickFor) return
    const away = (e: MouseEvent) => { if (!(e.target as Element).closest('.chat-picker, .chat-act-react')) setPickFor(null) }
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPickFor(null) } }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true) }
  }, [pickFor])

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

  const renderRow = (row: Row) => {
    if (row.type === 'top') return store.hasMore ? <button className="btn ghost sm chat-older" onClick={() => void older()}>Cargar mensajes anteriores</button> : null
    if (row.type === 'end') return null
    if (row.type === 'day') return <div className="chat-day"><span>{row.label}</span></div>
    if (row.type === 'unread') return <div className="chat-unread"><span>Mensajes nuevos</span></div>
    const m = row.m!
    if (row.type === 'sys') return <div data-msg={m.id} className="chat-sys"><span>{m.text}</span></div>
    const head = !!row.head
    const at = new Date(m.createdAt)
    const mine = m.authorId === user?.id
    const author = m.authorId ? who.get(m.authorId) : undefined
    const quoted = m.reply ?? (m.replyTo ? byId.get(m.replyTo) : undefined) // la cita viene resuelta del servidor, aunque el original no esté cargado
    const reactions = Object.entries(m.reactions ?? {})
    const showName = head && !mine && conv.kind !== 'DM'
    return (
      <div data-msg={m.id} className={`chat-msg ${mine ? 'mine' : ''} ${head ? 'head' : 'cont'}`}>
        <div className="chat-av">{head && !mine && <Avatar name={m.authorName} userId={m.authorId ?? undefined} version={author?.avatarVersion} online={m.authorId ? online.has(m.authorId) : false} size={variant === 'window' ? 28 : 34} />}</div>
        <div className="chat-col">
          {showName && <div className="chat-meta"><strong>{m.authorName}</strong><time title={at.toLocaleString('es')}>{clock(at)}</time></div>}
          {head && !showName && <div className="chat-meta"><time title={at.toLocaleString('es')}>{clock(at)}</time></div>}
          <div className={`chat-bubble-wrap ${activeMsg === m.id || pickFor === m.id ? 'show' : ''}`} onClick={() => setActiveMsg((a) => (a === m.id ? null : m.id))}>
            <div className="chat-bubble">
              {m.replyTo && (quoted
                ? <button type="button" className="chat-quote" onClick={() => void goTo(quoted.id)}><strong>{quoted.authorName}</strong><span>{quoted.text}</span></button>
                : <div className="chat-quote gone"><span>Mensaje borrado</span></div>)}
              <p>{rich(m.text, names, user?.displayName ?? '')}{m.edited && <small className="chat-edited"> (editado)</small>}</p>
            </div>
            <div className="chat-actions" role="toolbar" aria-label="Acciones del mensaje" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="chat-act chat-act-react" aria-label="Reaccionar" aria-expanded={pickFor === m.id} title="Reaccionar" onClick={() => setPickFor((p) => (p === m.id ? null : m.id))}><SmilePlus size={15} /></button>
              {canWrite && <button type="button" className="chat-act" aria-label="Responder" title="Responder" onClick={() => { setReplyTo(m); setEditing(null); input.current?.focus() }}><CornerUpLeft size={15} /></button>}
              <Menu label="Más acciones" items={[
                { label: 'Copiar texto', icon: <Copy size={16} />, onClick: () => void navigator.clipboard.writeText(m.text).then(() => toast('Copiado', 'success')) },
                ...(mine && canWrite ? [{ label: 'Editar', icon: <Pencil size={16} />, onClick: () => startEdit(m) }] : []),
                ...((mine || staff) && canWriteIn(room, user) ? [{ label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void del(m) }] : []),
              ]} />
              {pickFor === m.id && (
                <div className="chat-picker" role="listbox" aria-label="Elegir reacción">
                  {QUICK.map((e) => <button key={e} type="button" role="option" aria-selected="false" onClick={() => { setPickFor(null); setActiveMsg(null); void react(m, e) }}>{e}</button>)}
                </div>
              )}
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
      </div>
    )
  }

  const roLabel = !canWriteIn(room, user)
    ? <>Tu rol en esta sala es de <strong>lector</strong>: puedes leer y reaccionar, pero no escribir.</>
    : <>En este grupo solo escriben las personas <strong>administradoras</strong>.</>

  return (
    <div className={`chat ${variant}`}>
      <div className="chat-list" ref={list} onScroll={onScroll} onWheel={() => { userAt.current = Date.now() }} onTouchMove={() => { userAt.current = Date.now() }} onPointerDown={() => { userAt.current = Date.now() }} onKeyDown={() => { userAt.current = Date.now() }} aria-live="polite" aria-label="Mensajes">
        {loading && <p className="muted small center-text">Cargando mensajes…</p>}
        {error && <p className="error small center-text">{error}</p>}
        {!loading && !items.length && !error && (
          <div className="chat-empty">
            <Sparkles size={variant === 'window' ? 22 : 30} />
            <strong>Aquí empieza la conversación</strong>
            <span className="small">{canWrite ? 'Escribe el primer mensaje: llegará en tiempo real.' : 'Todavía no hay mensajes.'}</span>
          </div>
        )}
        <div ref={vbox} className="chat-vbox" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]
            if (!row) return null
            return (
              <div key={v.key} data-index={v.index} data-rowkey={row.key} ref={virtualizer.measureElement} className={`chat-vrow ${row.type} ${row.head ? 'head' : ''}`} style={{ transform: `translateY(${v.start}px)` }}>
                {renderRow(row)}
              </div>
            )
          })}
        </div>
      </div>
      {(store.hasNewer || unseen > 0) && (
        <button className="chat-new" onClick={() => void goLatest()}><ArrowDown size={14} /> {store.hasNewer ? 'Ir a los mensajes recientes' : `${unseen} ${unseen === 1 ? 'nuevo' : 'nuevos'}`}</button>
      )}
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

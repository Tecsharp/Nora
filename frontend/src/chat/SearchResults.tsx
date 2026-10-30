import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { ConvAvatar, relTime } from './ChatBits'
import { useChat } from './ChatProvider'
import { chatApi, type Message } from './chatApi'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Un trozo del mensaje alrededor de la primera coincidencia, con lo buscado resaltado. */
function Snippet({ text, q }: { text: string; q: string }) {
  const parts = useMemo(() => {
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    const start = Math.max(0, i - 40)
    const cut = (start > 0 ? '…' : '') + text.slice(start, start + 140) + (start + 140 < text.length ? '…' : '')
    return cut.split(new RegExp(`(${escapeRe(q)})`, 'ig'))
  }, [text, q])
  return <>{parts.map((t, k) => (t.toLowerCase() === q.toLowerCase() ? <mark key={k}>{t}</mark> : <span key={k}>{t}</span>))}</>
}

/**
 * Resultados de buscar en el historial del chat: en una conversación (`conv`) o en todas las que ves. Se piden al servidor (que usa un índice de
 * texto), de más reciente a más antiguo y por páginas, así que sirve igual con miles de mensajes. Pulsar uno lleva a ese mensaje.
 */
export default function SearchResults({ q, conv, onPick }: { q: string; conv?: string; onPick: (m: Message) => void }) {
  const chat = useChat()
  const term = q.trim()
  const [items, setItems] = useState<Message[]>([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    setItems([]); setMore(false); setError('')
    if (term.length < 2) return
    const n = ++seq.current
    setBusy(true)
    const t = setTimeout(() => {
      chatApi.search(chat.room.code, term, conv).then((r) => { if (seq.current === n) { setItems(r.items); setMore(r.more) } })
        .catch((e) => { if (seq.current === n) setError(e instanceof Error ? e.message : 'No se pudo buscar') })
        .finally(() => { if (seq.current === n) setBusy(false) })
    }, 280)
    return () => clearTimeout(t)
  }, [term, conv, chat.room.code])

  const loadMore = async () => {
    const last = items[items.length - 1]
    if (!last || busy) return
    setBusy(true)
    try {
      const r = await chatApi.search(chat.room.code, term, conv, last.createdAt)
      setItems((l) => [...l, ...r.items])
      setMore(r.more)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo buscar') } finally { setBusy(false) }
  }

  if (term.length < 2) return <p className="srch-hint"><Search size={14} /> Escribe al menos 2 letras para buscar en el historial.</p>
  return (
    <div className="srch">
      {items.map((m) => {
        const c = chat.conv(m.conv)
        return (
          <button key={m.id} className="srch-row" onClick={() => onPick(m)}>
            {!conv && c && <ConvAvatar conv={c} size={30} />}
            <span className="srch-txt">
              <span className="srch-top"><b className="truncate">{!conv && c ? chat.title(c) : m.authorName}</b><time>{relTime(m.createdAt)}</time></span>
              {!conv && <small className="srch-by">{m.authorName}</small>}
              <span className="srch-snip"><Snippet text={m.text} q={term} /></span>
            </span>
          </button>
        )
      })}
      {busy && <p className="srch-hint">Buscando…</p>}
      {error && <p className="srch-hint err">{error}</p>}
      {!busy && !error && items.length === 0 && <p className="srch-hint">Nada coincide con «{term}».</p>}
      {more && !busy && <button className="btn ghost sm srch-more" onClick={() => void loadMore()}>Ver más resultados</button>}
    </div>
  )
}

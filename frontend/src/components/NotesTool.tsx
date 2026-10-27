import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { api, ApiError } from '../api'
import { useRealtime } from '../realtime'

interface Note {
  id: string
  content: string
  authorName: string
  createdAt: string
}

interface Props {
  code: string
  kind: 'NOTE' | 'CLIPBOARD'
  placeholder: string
  copyable?: boolean
}

export default function NotesTool({ code, kind, placeholder, copyable }: Props) {
  const [items, setItems] = useState<Note[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const path = `/rooms/${code}/notes`

  const load = useCallback(() => api<Note[]>(`${path}?kind=${kind}`).then(setItems).catch(() => {}), [path, kind])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000) // respaldo; los cambios llegan por WebSocket
    return () => clearInterval(t)
  }, [load])

  useRealtime('reconnected', load)
  useRealtime('note.added', (d: { kind: string; note: Note }) => {
    if (d.kind === kind) setItems((all) => (all.some((n) => n.id === d.note.id) ? all : [d.note, ...all]))
  })
  useRealtime('note.deleted', (d: { kind: string; id: string }) => {
    if (d.kind === kind) setItems((all) => all.filter((n) => n.id !== d.id))
  })

  async function add(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const note = await api<Note>(`${path}?kind=${kind}`, 'POST', { content: text })
      setText('')
      setItems((all) => (all.some((n) => n.id === note.id) ? all : [note, ...all]))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar')
    }
  }

  return (
    <div className="stack">
      <form className="stack" onSubmit={add}>
        <textarea rows={4} maxLength={20000} required placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" disabled={!text.trim()}>Añadir</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="list">
        {items.map((n) => (
          <li key={n.id}>
            <p className="pre">{n.content}</p>
            <div className="row spread">
              <span className="muted small">{n.authorName} · {new Date(n.createdAt).toLocaleString()}</span>
              <div className="row">
                {copyable && (
                  <button className="icon-btn" aria-label="Copiar" title="Copiar" onClick={() => navigator.clipboard?.writeText(n.content)}>
                    <Copy size={16} />
                  </button>
                )}
                <button className="icon-btn danger" aria-label="Borrar" title="Borrar"
                  onClick={async () => {
                    await api(`${path}/${n.id}`, 'DELETE').catch((e) => setError(e.message))
                  }}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

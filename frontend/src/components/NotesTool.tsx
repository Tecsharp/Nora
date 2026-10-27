import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Copy, FolderInput, Pencil, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import Menu, { type MenuItem } from './Menu'

interface Note {
  id: string
  content: string
  authorId: string
  authorName: string
  createdAt: string
  folderId: string | null
}

interface Category {
  id: string
  name: string
  createdBy: string
}

interface Props {
  room: Room
  kind: 'NOTE' | 'CLIPBOARD'
  placeholder: string
  copyable?: boolean
}

const ALL = 'all'
const NONE = 'none'

/** Notas y portapapeles de la sala, organizados en categorías. */
export default function NotesTool({ room, kind, placeholder, copyable }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const code = room.code
  const [items, setItems] = useState<Note[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string>(ALL)
  const [composeCat, setComposeCat] = useState<string>('')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [catName, setCatName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const path = `/rooms/${code}/notes`
  const catPath = `/rooms/${code}/folders?kind=${kind}`
  const isStaff = room.isOwner || user?.role === 'ADMIN'
  const canTouch = (ownerId: string) => ownerId === user?.id || isStaff

  const load = useCallback(() => {
    api<Note[]>(`${path}?kind=${kind}`).then(setItems).catch(() => {})
    api<Category[]>(catPath).then(setCats).catch(() => {})
  }, [path, kind, catPath])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000) // respaldo; los cambios llegan por WebSocket
    return () => clearInterval(t)
  }, [load])

  useRealtime('reconnected', load)
  useRealtime('note.added', (d: { kind: string; note: Note }) => {
    if (d.kind === kind) setItems((all) => (all.some((n) => n.id === d.note.id) ? all : [d.note, ...all]))
  })
  useRealtime('note.updated', (d: { kind: string; note: Note }) => {
    if (d.kind === kind) setItems((all) => all.map((n) => (n.id === d.note.id ? d.note : n)))
  })
  useRealtime('note.deleted', (d: { kind: string; id: string }) => {
    if (d.kind === kind) setItems((all) => all.filter((n) => n.id !== d.id))
  })
  useRealtime('folder.added', (f: Category & { kind: string }) => {
    if (f.kind === kind) setCats((all) => (all.some((c) => c.id === f.id) ? all : [...all, f].sort((a, b) => a.name.localeCompare(b.name))))
  })
  useRealtime('folder.updated', (f: Category & { kind: string }) => {
    if (f.kind === kind) setCats((all) => all.map((c) => (c.id === f.id ? f : c)).sort((a, b) => a.name.localeCompare(b.name)))
  })
  useRealtime('folder.deleted', (d: { kind: string; ids: string[] }) => {
    if (d.kind !== kind) return
    setCats((all) => all.filter((c) => !d.ids.includes(c.id)))
    setItems((all) => all.filter((n) => !n.folderId || !d.ids.includes(n.folderId)))
    setFilter((f) => (d.ids.includes(f) ? ALL : f))
  })

  const countOf = (id: string) => items.filter((n) => (id === NONE ? !n.folderId : n.folderId === id)).length
  const currentCat = cats.find((c) => c.id === filter)
  // Al escribir, la categoría por defecto es la que se está viendo
  const targetCat = composeCat || (currentCat ? currentCat.id : '')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (n) => (filter === ALL || (filter === NONE ? !n.folderId : n.folderId === filter)) && (!q || n.content.toLowerCase().includes(q)),
    )
  }, [items, filter, query])

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Algo salió mal')

  async function add(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const note = await api<Note>(`${path}?kind=${kind}`, 'POST', { content: text, folderId: targetCat || null })
      setText('')
      setItems((all) => (all.some((n) => n.id === note.id) ? all : [note, ...all]))
    } catch (err) {
      fail(err)
    }
  }

  async function createCat(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const c = await api<Category>(catPath, 'POST', { name: catName })
      setCats((all) => (all.some((x) => x.id === c.id) ? all : [...all, c].sort((a, b) => a.name.localeCompare(b.name))))
      setAdding(false)
      setCatName('')
      setFilter(c.id)
    } catch (err) {
      fail(err)
    }
  }

  async function renameCat(e: FormEvent) {
    e.preventDefault()
    if (!currentCat) return
    try {
      const c = await api<Category>(`/rooms/${code}/folders/${currentCat.id}`, 'PATCH', { name: catName })
      setCats((all) => all.map((x) => (x.id === c.id ? c : x)).sort((a, b) => a.name.localeCompare(b.name)))
      setRenaming(false)
    } catch (err) {
      fail(err)
    }
  }

  async function removeCat() {
    if (!currentCat) return
    const n = countOf(currentCat.id)
    if (!confirm(`¿Borrar la categoría «${currentCat.name}»${n ? ` y sus ${n} elemento${n === 1 ? '' : 's'}` : ''}? No se puede deshacer.`)) return
    await api(`/rooms/${code}/folders/${currentCat.id}`, 'DELETE').catch(fail)
  }

  async function move(n: Note, folderId: string | null) {
    try {
      const updated = await api<Note>(`${path}/${n.id}`, 'PATCH', { folderId })
      setItems((all) => all.map((x) => (x.id === updated.id ? updated : x)))
    } catch (err) {
      fail(err)
    }
  }

  async function copy(n: Note) {
    await navigator.clipboard?.writeText(n.content).catch(() => {})
    toast('Copiado al portapapeles', 'success')
  }

  function menu(n: Note): MenuItem[] {
    const items: MenuItem[] = []
    if (copyable) items.push({ label: 'Copiar', icon: <Copy size={16} />, onClick: () => void copy(n) })
    if (canTouch(n.authorId)) {
      items.push({ heading: 'Mover a' })
      if (n.folderId) items.push({ label: 'Sin categoría', icon: <FolderInput size={16} />, onClick: () => void move(n, null) })
      for (const c of cats) if (c.id !== n.folderId) items.push({ label: c.name, icon: <FolderInput size={16} />, onClick: () => void move(n, c.id) })
      items.push('separator', {
        label: 'Borrar', icon: <Trash2 size={16} />, danger: true,
        onClick: () => void api(`${path}/${n.id}`, 'DELETE').catch(fail),
      })
    }
    return items
  }

  const catName2 = (id: string | null) => cats.find((c) => c.id === id)?.name

  return (
    <div className="explorer">
      <form className="composer" onSubmit={add}>
        <textarea rows={3} maxLength={20000} required placeholder={placeholder} aria-label="Contenido" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row spread">
          <label className="check" style={{ color: 'var(--muted)' }}>
            Categoría
            <select className="page-size" value={targetCat} onChange={(e) => setComposeCat(e.target.value)} aria-label="Categoría del nuevo elemento">
              <option value="">Sin categoría</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="btn primary sm" disabled={!text.trim()}><Plus size={15} /> Añadir</button>
        </div>
      </form>

      <div className="ex-toolbar">
        <div className="chips grow" role="tablist" aria-label="Categorías">
          <button className={`chip ${filter === ALL ? 'active' : ''}`} onClick={() => setFilter(ALL)}>Todas <span className="count">{items.length}</span></button>
          <button className={`chip ${filter === NONE ? 'active' : ''}`} onClick={() => setFilter(NONE)}>Sin categoría <span className="count">{countOf(NONE)}</span></button>
          {cats.map((c) => (
            <button key={c.id} className={`chip ${filter === c.id ? 'active' : ''}`} onClick={() => setFilter(c.id)}>
              {c.name} <span className="count">{countOf(c.id)}</span>
            </button>
          ))}
        </div>
        <button className="btn sm" onClick={() => { setAdding((a) => !a); setRenaming(false); setCatName('') }}><Plus size={15} /> Categoría</button>
      </div>

      {adding && (
        <form className="inline-form" onSubmit={createCat}>
          <input autoFocus required maxLength={60} placeholder="Nombre de la categoría" aria-label="Nombre de la categoría" value={catName} onChange={(e) => setCatName(e.target.value)} />
          <button className="btn primary sm" disabled={!catName.trim()}>Crear</button>
          <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancelar</button>
        </form>
      )}
      {renaming && currentCat && (
        <form className="inline-form" onSubmit={renameCat}>
          <input autoFocus required maxLength={60} aria-label="Nuevo nombre" value={catName} onChange={(e) => setCatName(e.target.value)} />
          <button className="btn primary sm" disabled={!catName.trim()}><Check size={15} /> Guardar</button>
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(false)}><X size={15} /></button>
        </form>
      )}

      <div className="row spread" style={{ padding: '10px 16px 0' }}>
        <div className="input-icon grow" style={{ maxWidth: 320 }}>
          <Search size={15} />
          <input type="search" placeholder="Buscar…" aria-label="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} style={{ borderRadius: 999, paddingTop: 7, paddingBottom: 7 }} />
        </div>
        {currentCat && canTouch(currentCat.createdBy) && (
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn sm" aria-label="Cambiar nombre de la categoría" title="Cambiar nombre" onClick={() => { setRenaming(true); setAdding(false); setCatName(currentCat.name) }}><Pencil size={15} /></button>
            <button className="icon-btn danger sm" aria-label="Borrar categoría" title="Borrar categoría" onClick={removeCat}><Trash2 size={15} /></button>
          </div>
        )}
      </div>

      <div className="ex-body">
        {error && <p className="error small" role="alert">{error}</p>}
        {shown.length === 0 ? (
          <div className="empty">
            <StickyNote size={36} />
            <strong>{query ? 'Sin resultados' : 'Aquí no hay nada todavía'}</strong>
            <span className="small">{query ? 'Prueba con otra búsqueda.' : 'Escribe arriba para añadir el primer elemento.'}</span>
          </div>
        ) : (
          <div className="note-grid">
            {shown.map((n) => (
              <article key={n.id} className="note-card">
                <p className="pre">{n.content}</p>
                <div className="row spread nowrap">
                  <span className="muted small truncate">
                    {n.authorName} · {new Date(n.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {filter === ALL && catName2(n.folderId) ? ` · ${catName2(n.folderId)}` : ''}
                  </span>
                  <div className="row nowrap" style={{ gap: 2 }}>
                    {copyable && (
                      <button className="icon-btn sm" aria-label="Copiar" title="Copiar" onClick={() => void copy(n)}><Copy size={15} /></button>
                    )}
                    {menu(n).length > 0 && <Menu items={menu(n)} />}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

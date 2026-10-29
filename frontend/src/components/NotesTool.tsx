import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Copy, FolderInput, Pencil, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { useDialogs } from '../dialogs'
import Menu, { type MenuItem } from './Menu'
import Modal from './Modal'
import Tabs from './Tabs'
import { fmtDateTime } from '../dates'

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
  const dialogs = useDialogs()
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
  const [editing, setEditing] = useState<Note | null>(null)
  const [draft, setDraft] = useState('')
  const [draftCat, setDraftCat] = useState('')
  const [saving, setSaving] = useState(false)
  const path = `/rooms/${code}/notes`
  const catPath = `/rooms/${code}/folders?kind=${kind}`
  const isStaff = isStaffIn(room, user)
  const canWrite = canWriteIn(room, user)
  const canTouch = (ownerId: string) => canWrite && (ownerId === user?.id || isStaff)

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
    if (!await dialogs.confirm({ title: `¿Borrar la categoría «${currentCat.name}»?`, message: n ? <>También se borrarán sus <b>{n} elemento{n === 1 ? '' : 's'}</b>. No se puede deshacer.</> : 'No se puede deshacer.', confirmLabel: 'Borrar categoría', tone: 'danger' })) return
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

  function open(n: Note) {
    setEditing(n)
    setDraft(n.content)
    setDraftCat(n.folderId ?? '')
    setError('')
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (draft !== editing.content) body.content = draft
      if ((draftCat || null) !== editing.folderId) body.folderId = draftCat || null
      if (Object.keys(body).length > 0) {
        const updated = await api<Note>(`${path}/${editing.id}`, 'PATCH', body)
        setItems((all) => all.map((x) => (x.id === updated.id ? updated : x)))
      }
      setEditing(null)
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
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
      items.push({ label: 'Editar', icon: <Pencil size={16} />, onClick: () => open(n) })
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
      {!canWrite && <p className="callout small" style={{ margin: '12px 16px 0' }}>Tu rol en esta sala es de <strong>lector</strong>: puedes ver y copiar, pero no añadir ni modificar.</p>}
      {canWrite && <form className="composer" onSubmit={add}>
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
      </form>}

      <div className="ex-toolbar">
        <div className="grow" style={{ minWidth: 0 }}>
          <Tabs label="Categorías" value={filter} onChange={setFilter} size="sm"
            items={[
              { id: ALL, label: 'Todas', count: items.length },
              { id: NONE, label: 'Sin categoría', count: countOf(NONE) },
              ...cats.map((c) => ({ id: c.id, label: c.name, count: countOf(c.id) })),
            ]} />
        </div>
        {canWrite && <button className="btn sm" onClick={() => { setAdding((a) => !a); setRenaming(false); setCatName('') }}><Plus size={15} /> Categoría</button>}
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
          <div key={`${filter}-${query}`} className="note-grid swap">
            {shown.map((n) => (
              <article key={n.id} className="note-card" role="button" tabIndex={0} aria-label="Abrir"
                onClick={() => open(n)} onKeyDown={(e) => { if (e.key === 'Enter') open(n) }}>
                <p className="pre note-text">{n.content}</p>
                <div className="row spread nowrap">
                  <span className="muted small truncate">
                    {n.authorName} · {fmtDateTime(n.createdAt)}
                    {filter === ALL && catName2(n.folderId) ? ` · ${catName2(n.folderId)}` : ''}
                  </span>
                  <div className="row nowrap" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
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

      {editing && (
        <Modal title={canTouch(editing.authorId) ? 'Editar' : 'Contenido'} onClose={() => setEditing(null)}
          footer={
            <>
              {copyable && <button className="btn ghost" onClick={() => void copy(editing)}><Copy size={15} /> Copiar</button>}
              <span className="grow" />
              <button className="btn ghost" onClick={() => setEditing(null)}>{canTouch(editing.authorId) ? 'Cancelar' : 'Cerrar'}</button>
              {canTouch(editing.authorId) && (
                <button className="btn primary" disabled={saving || !draft.trim()} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
              )}
            </>
          }>
          <textarea rows={12} maxLength={20000} aria-label="Contenido" value={draft} readOnly={!canTouch(editing.authorId)}
            onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 220 }} autoFocus />
          {canTouch(editing.authorId) && (
            <label>
              Categoría
              <select value={draftCat} onChange={(e) => setDraftCat(e.target.value)}>
                <option value="">Sin categoría</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <span className="muted small">{editing.authorName} · {fmtDateTime(editing.createdAt)}</span>
          {error && <p className="error small" role="alert">{error}</p>}
        </Modal>
      )}
    </div>
  )
}

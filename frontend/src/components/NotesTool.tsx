import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, Copy, Folder, FolderInput, FolderPlus, House, Pencil, Plus, Search, Square, SquareCheck, StickyNote, Trash2, X } from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { useDialogs } from '../dialogs'
import { fmtDateTime } from '../dates'
import { useMarquee } from '../marquee'
import Menu, { type MenuItem } from './Menu'
import Modal from './Modal'

interface Note {
  id: string
  content: string
  authorId: string
  authorName: string
  createdAt: string
  folderId: string | null
}

interface FolderItem {
  id: string
  name: string
  parentId: string | null
  createdBy: string
}

interface Props {
  room: Room
  kind: 'NOTE' | 'CLIPBOARD'
  placeholder: string
  copyable?: boolean
}

const NOTES_MIME = 'application/x-nora-notes'
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Notas de la sala organizadas en carpetas (anidadas), con búsqueda, selección múltiple y arrastrar para mover. */
export default function NotesTool({ room, kind, placeholder, copyable }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const code = room.code
  const [items, setItems] = useState<Note[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editing, setEditing] = useState<Note | null>(null)
  const [draft, setDraft] = useState('')
  const [draftFolder, setDraftFolder] = useState('')
  const [saving, setSaving] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const path = `/rooms/${code}/notes`
  const folderPath = `/rooms/${code}/folders?kind=${kind}`
  const isStaff = isStaffIn(room, user)
  const canWrite = canWriteIn(room, user)
  const canTouch = (ownerId: string) => canWrite && (ownerId === user?.id || isStaff) // editar y borrar: de su autor o de quien modera
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Algo salió mal')

  const load = useCallback(() => {
    api<Note[]>(`${path}?kind=${kind}`).then(setItems).catch(() => {})
    api<FolderItem[]>(folderPath).then(setFolders).catch(() => {})
  }, [path, kind, folderPath])
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
  useRealtime('folder.added', (f: FolderItem & { kind: string }) => f.kind === kind && setFolders((all) => (all.some((c) => c.id === f.id) ? all : [...all, f])))
  useRealtime('folder.updated', (f: FolderItem & { kind: string }) => f.kind === kind && setFolders((all) => all.map((c) => (c.id === f.id ? f : c))))
  useRealtime('folder.deleted', (d: { kind: string; ids: string[] }) => {
    if (d.kind !== kind) return
    setFolders((all) => all.filter((c) => !d.ids.includes(c.id)))
    setItems((all) => all.filter((n) => !n.folderId || !d.ids.includes(n.folderId)))
    setCurrent((c) => (c && d.ids.includes(c) ? null : c))
  })

  // ---- navegación ----
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const trail = useMemo(() => {
    const out: FolderItem[] = []
    for (let f = current ? byId.get(current) : undefined; f && out.length < 12; f = f.parentId ? byId.get(f.parentId) : undefined) out.unshift(f)
    return out
  }, [current, byId])
  const label = (f: FolderItem) => {
    const parts: string[] = []
    for (let x: FolderItem | undefined = f; x && parts.length < 12; x = x.parentId ? byId.get(x.parentId) : undefined) parts.unshift(x.name)
    return parts.join(' / ')
  }
  const where = (id: string | null) => (id ? byId.get(id)?.name ?? '' : 'Notas')
  const searching = query.trim() !== ''
  const q = query.trim().toLowerCase()
  const shownFolders = useMemo(() => folders.filter((f) => (searching ? f.name.toLowerCase().includes(q) : f.parentId === current)).sort(byName), [folders, current, searching, q])
  const shown = useMemo(() => items.filter((n) => (searching ? n.content.toLowerCase().includes(q) : (n.folderId ?? null) === current)), [items, current, searching, q])
  const countIn = (id: string) => items.filter((n) => n.folderId === id).length + folders.filter((f) => f.parentId === id).length

  const go = (id: string | null) => {
    setCurrent(id)
    setQuery('')
    setSel(new Set())
    setAnchor(null)
  }

  // ---- selección ----
  const selected = useMemo(() => items.filter((n) => sel.has(n.id)), [items, sel])
  const deletable = selected.filter((n) => canTouch(n.authorId))
  const toggle = (id: string) => {
    setSel((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
    setAnchor(id)
  }
  const clickNote = (n: Note, e: MouseEvent | KeyboardEvent) => {
    if (e.shiftKey && anchor) {
      const ids = shown.map((x) => x.id)
      const a = ids.indexOf(anchor)
      const z = ids.indexOf(n.id)
      if (a >= 0 && z >= 0) return setSel(new Set(ids.slice(Math.min(a, z), Math.max(a, z) + 1)))
    }
    if (e.ctrlKey || e.metaKey || sel.size > 0) toggle(n.id)
    else openNote(n)
  }
  const { box, justDragged } = useMarquee(bodyRef, true, (ids, additive) => setSel((s) => (additive ? new Set([...s, ...ids]) : new Set(ids))))
  useEffect(() => {
    if (!sel.size) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.stopImmediatePropagation()
      setSel(new Set())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel.size])

  // ---- acciones ----
  async function add(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const note = await api<Note>(`${path}?kind=${kind}`, 'POST', { content: text, folderId: current })
      setText('')
      setItems((all) => (all.some((n) => n.id === note.id) ? all : [note, ...all]))
    } catch (err) {
      fail(err)
    }
  }

  async function createFolder(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const f = await api<FolderItem>(folderPath, 'POST', { name: folderName, parentId: current })
      setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f]))
      setCreating(false)
      setFolderName('')
    } catch (err) {
      fail(err)
    }
  }

  async function renameFolder(f: FolderItem) {
    const n = await dialogs.prompt({ title: 'Cambiar nombre de la carpeta', label: 'Nombre', initial: f.name, maxLength: 60 })
    if (!n || n === f.name) return
    try {
      const u = await api<FolderItem>(`/rooms/${code}/folders/${f.id}`, 'PATCH', { name: n })
      setFolders((all) => all.map((x) => (x.id === u.id ? u : x)))
    } catch (err) {
      fail(err)
    }
  }

  async function removeFolder(f: FolderItem) {
    const ids = new Set([f.id])
    for (let grew = true; grew;) {
      grew = false
      for (const x of folders) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true }
    }
    const n = items.filter((i) => i.folderId && ids.has(i.folderId)).length
    if (!await dialogs.confirm({ title: `¿Borrar la carpeta «${f.name}»?`, message: n ? <>También se borrarán sus <b>{n} nota{n === 1 ? '' : 's'}</b>. No se puede deshacer.</> : 'No se puede deshacer.', confirmLabel: 'Borrar carpeta', tone: 'danger' })) return
    await api(`/rooms/${code}/folders/${f.id}`, 'DELETE').catch(fail)
  }

  async function moveMany(list: Note[], folderId: string | null) {
    if (!canWrite) return toast('Tu rol en esta sala es de solo lectura', 'warning')
    const todo = list.filter((n) => (n.folderId ?? null) !== folderId) // cualquiera que pueda escribir puede mover
    if (!todo.length) return toast(`Ya ${list.length === 1 ? 'está' : 'están'} en ${where(folderId)}`, 'info')
    const results = await Promise.allSettled(todo.map((n) => api<Note>(`${path}/${n.id}`, 'PATCH', { folderId })))
    const moved = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    setItems((all) => all.map((x) => moved.find((m) => m.id === x.id) ?? x))
    const bad = todo.length - moved.length
    toast(bad ? `Se movieron ${moved.length} y ${bad} no se pudieron mover` : `${moved.length} nota${moved.length === 1 ? '' : 's'} movida${moved.length === 1 ? '' : 's'} a «${where(folderId)}»`, bad ? 'error' : 'success')
    setSel(new Set())
  }

  async function removeMany(list: Note[]) {
    const todo = list.filter((n) => canTouch(n.authorId))
    if (!todo.length) return
    if (!await dialogs.confirm({ title: todo.length === 1 ? '¿Borrar esta nota?' : `¿Borrar ${todo.length} notas?`, message: 'Se eliminarán de la sala para todos. No se puede deshacer.', confirmLabel: todo.length === 1 ? 'Borrar nota' : 'Borrar notas', tone: 'danger' })) return
    await Promise.allSettled(todo.map((n) => api(`${path}/${n.id}`, 'DELETE')))
    setSel(new Set())
  }

  function openNote(n: Note) {
    setEditing(n)
    setDraft(n.content)
    setDraftFolder(n.folderId ?? '')
    setError('')
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (draft !== editing.content) body.content = draft
      if ((draftFolder || null) !== editing.folderId) body.folderId = draftFolder || null
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

  /** «Mover a»: la raíz y todas las carpetas con su ruta. */
  const moveTargets = (list: Note[]): MenuItem[] => [
    { label: 'Notas (sin carpeta)', icon: <House size={16} />, onClick: () => void moveMany(list, null) },
    ...folders.map((f) => ({ f, l: label(f) })).sort((a, b) => a.l.localeCompare(b.l)).map(({ f, l }) => ({ label: l, icon: <FolderInput size={16} />, onClick: () => void moveMany(list, f.id) })),
  ]

  function menu(n: Note): MenuItem[] {
    const items: MenuItem[] = []
    if (copyable) items.push({ label: 'Copiar', icon: <Copy size={16} />, onClick: () => void copy(n) })
    items.push({ label: canTouch(n.authorId) ? 'Editar' : 'Abrir', icon: <Pencil size={16} />, onClick: () => openNote(n) })
    if (canWrite) items.push({ heading: 'Mover a' }, ...moveTargets([n]))
    if (canTouch(n.authorId)) items.push('separator', { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void removeMany([n]) })
    return items
  }

  // ---- arrastrar y soltar ----
  const dragIds = (n: Note) => (sel.has(n.id) ? [...sel] : [n.id])
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(NOTES_MIME)) return
      e.preventDefault()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: DragEvent) => {
      setDropTarget(null)
      const raw = e.dataTransfer.getData(NOTES_MIME)
      if (!raw) return
      e.preventDefault()
      const ids: string[] = JSON.parse(raw)
      void moveMany(items.filter((n) => ids.includes(n.id)), folderId)
    },
  })
  const activate = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  const empty = shownFolders.length === 0 && shown.length === 0

  return (
    <div className={`explorer ${sel.size > 0 ? 'sel-active' : ''}`}>
      {!canWrite && <p className="callout small" style={{ margin: '12px 16px 0' }}>Tu rol en esta sala es de <strong>lector</strong>: puedes ver y copiar, pero no añadir ni modificar.</p>}
      {canWrite && (
        <form className="composer" onSubmit={add}>
          <textarea rows={3} maxLength={20000} required placeholder={placeholder} aria-label="Contenido" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row spread">
            <span className="muted small">Se añadirá en «{where(current)}»</span>
            <button className="btn primary sm" disabled={!text.trim()}><Plus size={15} /> Añadir</button>
          </div>
        </form>
      )}

      <div className="ex-toolbar">
        {canWrite && <button className="btn sm" onClick={() => { setCreating((c) => !c); setFolderName('') }}><FolderPlus size={15} /> Nueva carpeta</button>}
        <span className="grow" />
        <div className="input-icon">
          <Search size={15} />
          <input type="search" placeholder="Buscar notas…" aria-label="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {creating && (
        <form className="inline-form" onSubmit={createFolder}>
          <input autoFocus required maxLength={60} placeholder="Nombre de la carpeta" aria-label="Nombre de la carpeta" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          <button className="btn primary sm" disabled={!folderName.trim()}>Crear</button>
          <button type="button" className="btn ghost sm" onClick={() => setCreating(false)}>Cancelar</button>
        </form>
      )}

      <nav className="crumbs" aria-label="Ruta">
        <button className={`${current === null && !searching ? 'cur' : ''} ${dropTarget === 'root' ? 'drop-target' : ''}`} onClick={() => go(null)} {...dropProps('root', null)}>
          <House size={15} /> Notas
        </button>
        {trail.map((f, i) => (
          <span key={f.id} className="row nowrap" style={{ gap: 0 }}>
            <ChevronRight size={14} className="sep" />
            <button className={`${i === trail.length - 1 ? 'cur' : ''} ${dropTarget === `c-${f.id}` ? 'drop-target' : ''}`} onClick={() => go(f.id)} {...dropProps(`c-${f.id}`, f.id)}>{f.name}</button>
          </span>
        ))}
        {searching && <span className="muted small" style={{ marginLeft: 8 }}>Resultados de «{query.trim()}»</span>}
      </nav>

      {sel.size > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="Notas seleccionadas">
          <button type="button" className="icon-btn sm" aria-label="Quitar la selección" title="Quitar la selección (Esc)" onClick={() => setSel(new Set())}><X size={16} /></button>
          <strong>{sel.size} seleccionada{sel.size === 1 ? '' : 's'}</strong>
          <button type="button" className="btn ghost sm" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((n) => n.id)))}>{sel.size === shown.length ? 'Quitar todas' : 'Seleccionar todas'}</button>
          <span className="grow" />
          {canWrite && (
            <Menu label="Mover las seleccionadas a" items={[{ heading: `Mover ${selected.length} a` }, ...moveTargets(selected)]}
              trigger={<span className="btn sm"><FolderInput size={15} /> Mover a… <ChevronDown size={14} /></span>} />
          )}
          {deletable.length > 0 && <button type="button" className="btn sm danger" onClick={() => void removeMany(deletable)}><Trash2 size={15} /> Borrar{deletable.length < selected.length ? ` (${deletable.length})` : ''}</button>}
        </div>
      )}

      <div ref={bodyRef} className="ex-body" onClick={(e) => { if (!justDragged.current && sel.size > 0 && !(e.target as Element).closest('[data-sel-id], button, a, .fitem, .menu, input, select')) setSel(new Set()) }}>
        {error && <p className="error small" role="alert">{error}</p>}
        {box && <div className="marquee" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
        {empty ? (
          <div className="empty">
            {searching ? <Search size={36} /> : <StickyNote size={36} />}
            <strong>{searching ? 'Sin resultados' : current ? 'Esta carpeta está vacía' : 'Aquí no hay nada todavía'}</strong>
            <span className="small">{searching ? 'Prueba con otra búsqueda.' : 'Escribe arriba para añadir la primera nota, o crea una carpeta para ordenarlas.'}</span>
          </div>
        ) : (
          <>
            {shownFolders.length > 0 && (
              <>
                {!searching && <div className="ex-section">Carpetas</div>}
                <div className="fgrid">
                  {shownFolders.map((f) => {
                    const n = countIn(f.id)
                    const mine = canTouch(f.createdBy)
                    return (
                      <div key={f.id} className={`fitem folder ${dropTarget === f.id ? 'drop-target' : ''}`} role="button" tabIndex={0} aria-label={`Carpeta ${f.name}`}
                        onClick={() => go(f.id)} onKeyDown={activate(() => go(f.id))} {...dropProps(f.id, f.id)}>
                        <span className="ficon"><Folder size={22} /></span>
                        <span className="fbody">
                          <span className="fname truncate">{f.name}</span>
                          <span className="fmeta truncate">{n} elemento{n === 1 ? '' : 's'}{searching && f.parentId ? ` · ${where(f.parentId)}` : ''}</span>
                        </span>
                        {mine && (
                          <span className="factions">
                            <Menu items={[
                              { label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: () => void renameFolder(f) },
                              'separator',
                              { label: 'Borrar carpeta', icon: <Trash2 size={16} />, danger: true, onClick: () => void removeFolder(f) },
                            ]} />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {shown.length > 0 && (
              <>
                {!searching && <div className="ex-section">Notas</div>}
                <div key={`${current}-${searching}`} className="note-grid swap">
                  {shown.map((n) => (
                    <article key={n.id} data-sel-id={n.id} className={`note-card ${sel.has(n.id) ? 'selected' : ''}`} role="button" tabIndex={0} aria-label="Abrir"
                      draggable={canWrite} onDragStart={(e) => { e.dataTransfer.setData(NOTES_MIME, JSON.stringify(dragIds(n))); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={(e) => clickNote(n, e)} onKeyDown={(e) => { if (e.key === 'Enter') clickNote(n, e) }}>
                      <button type="button" className={`board-check ${sel.has(n.id) ? 'on' : ''}`} aria-label={`${sel.has(n.id) ? 'Quitar de la selección' : 'Seleccionar'} la nota`} aria-pressed={sel.has(n.id)}
                        onClick={(e) => { e.stopPropagation(); toggle(n.id) }}>{sel.has(n.id) ? <SquareCheck size={20} /> : <Square size={20} />}</button>
                      <p className="pre note-text">{n.content}</p>
                      <div className="row spread nowrap">
                        <span className="muted small truncate">
                          {n.authorName} · {fmtDateTime(n.createdAt)}{searching && n.folderId ? ` · ${where(n.folderId)}` : ''}
                        </span>
                        <div className="row nowrap" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                          {copyable && <button className="icon-btn sm" aria-label="Copiar" title="Copiar" onClick={() => void copy(n)}><Copy size={15} /></button>}
                          <Menu items={menu(n)} />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="ex-status">
        <span>{shownFolders.length} carpeta{shownFolders.length === 1 ? '' : 's'} · {shown.length} nota{shown.length === 1 ? '' : 's'}</span>
        <span className="hide-sm">{canWrite ? 'Arrastra con el ratón para seleccionar varias · arrástralas a una carpeta para moverlas' : 'Clic para abrir'}</span>
      </div>

      {editing && (
        <Modal title={canTouch(editing.authorId) ? 'Editar' : 'Contenido'} onClose={() => setEditing(null)}
          footer={
            <>
              {copyable && <button className="btn ghost" onClick={() => void copy(editing)}><Copy size={15} /> Copiar</button>}
              <span className="grow" />
              <button className="btn ghost" onClick={() => setEditing(null)}>{canTouch(editing.authorId) || canWrite ? 'Cancelar' : 'Cerrar'}</button>
              {(canTouch(editing.authorId) || canWrite) && (
                <button className="btn primary" disabled={saving || !draft.trim()} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
              )}
            </>
          }>
          <textarea rows={12} maxLength={20000} aria-label="Contenido" value={draft} readOnly={!canTouch(editing.authorId)}
            onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 220 }} autoFocus />
          {canWrite && (
            <label>
              Carpeta
              <select value={draftFolder} onChange={(e) => setDraftFolder(e.target.value)}>
                <option value="">Notas (sin carpeta)</option>
                {[...folders].sort((a, b) => label(a).localeCompare(label(b))).map((f) => <option key={f.id} value={f.id}>{label(f)}</option>)}
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

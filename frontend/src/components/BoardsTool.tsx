import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  ChevronDown, ChevronRight, Download, Folder, FolderInput, FolderPlus, House, LayoutGrid, List, Loader2, PenTool, Pencil, Plus, Search, SquareCheck, Square, Trash2, Upload, X,
} from 'lucide-react'
import { api, ApiError, getAccessToken, type Room } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useToast } from '../toast'
import { useDialogs } from '../dialogs'
import type { DocInfo } from '../collab/DocEditor'
import { renderSavedBoard } from '../collab/boardIO'
import Menu, { type MenuItem } from './Menu'
import Tabs from './Tabs'
import { useMarquee } from '../marquee'

interface BoardItem extends DocInfo {
  createdBy: string
  createdByName: string
  updatedAt: string
}

interface FolderItem {
  id: string
  name: string
  parentId: string | null
  createdBy: string
}

type View = 'grid' | 'list'
type Sort = 'name' | 'date'

const VIEW_KEY = 'nora-boards-view'
const BOARDS_MIME = 'application/x-nora-boards'
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Miniatura de la pizarra: se pide con el token (no hay cabecera en <img>) y se muestra como blob. */
function Thumb({ code, board }: { code: string; board: BoardItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!board.thumbAt) return setUrl(null)
    let alive = true
    let made: string | null = null
    fetch(`/api/rooms/${code}/docs/${board.id}/thumbnail`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!alive || !b) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [code, board.id, board.thumbAt])
  return url ? <img src={url} alt="" className="board-thumb-img" draggable={false} /> : <PenTool size={34} className="board-thumb-empty" />
}

/**
 * Explorador de pizarras de la sala: carpetas anidadas, búsqueda, vistas de cuadrícula y lista, selección múltiple y
 * arrastrar (una o varias pizarras) a una carpeta o a la ruta de arriba para moverlas.
 */
export default function BoardsTool({ room, onOpen }: { room: Room; onOpen: (d: DocInfo) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const [boards, setBoards] = useState<BoardItem[] | null>(null)
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { box, justDragged } = useMarquee(bodyRef, true, (ids, additive) => setSel((s) => (additive ? new Set([...s, ...ids]) : new Set(ids))))
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const canTouch = (ownerId: string) => canWrite && (ownerId === user?.id || staff)
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Algo salió mal', 'error')
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch { /* sin almacenamiento */ }
  }

  const load = useCallback(() => api<BoardItem[]>(`/rooms/${room.code}/docs`).then((all) => setBoards(all.filter((d) => d.kind === 'BOARD'))).catch(() => setBoards([])), [room.code])
  const loadFolders = useCallback(() => api<FolderItem[]>(`/rooms/${room.code}/folders?kind=BOARD`).then(setFolders).catch(() => {}), [room.code])
  useEffect(() => void load(), [load])
  useEffect(() => void loadFolders(), [loadFolders])
  useRealtime('reconnected', () => { void load(); void loadFolders() })
  useRealtime('doc.created', (d: BoardItem) => d.kind === 'BOARD' && setBoards((all) => (all && !all.some((x) => x.id === d.id) ? [d, ...all] : all)))
  useRealtime('doc.renamed', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, name: d.name, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.thumb', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, thumbAt: d.thumbAt, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.moved', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, folderId: d.folderId } : x)) ?? all))
  useRealtime('doc.deleted', (d: { id: string }) => {
    setBoards((all) => all?.filter((x) => x.id !== d.id) ?? all)
    setSel((s) => (s.has(d.id) ? new Set([...s].filter((x) => x !== d.id)) : s))
  })
  useRealtime('folder.added', (f: FolderItem & { kind: string }) => f.kind === 'BOARD' && setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f])))
  useRealtime('folder.updated', (f: FolderItem & { kind: string }) => f.kind === 'BOARD' && setFolders((all) => all.map((x) => (x.id === f.id ? f : x))))
  useRealtime('folder.deleted', (d: { kind: string; ids: string[] }) => {
    if (d.kind !== 'BOARD') return
    setFolders((all) => all.filter((x) => !d.ids.includes(x.id)))
    setBoards((all) => all?.filter((b) => !b.folderId || !d.ids.includes(b.folderId)) ?? all)
    setCurrent((c) => (c && d.ids.includes(c) ? null : c))
  })

  // ---- navegación ----
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const path = useMemo(() => {
    const out: FolderItem[] = []
    for (let f = current ? folderById.get(current) : undefined; f && out.length < 12; f = f.parentId ? folderById.get(f.parentId) : undefined) out.unshift(f)
    return out
  }, [current, folderById])
  const where = (id: string | null) => (id ? folderById.get(id)?.name ?? '' : 'Pizarras')
  const searching = query.trim().length > 0

  const shownFolders = useMemo(() => {
    const q = query.trim().toLowerCase()
    return folders.filter((f) => (q ? f.name.toLowerCase().includes(q) : f.parentId === current)).sort(byName)
  }, [folders, current, query])
  const shownBoards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (boards ?? []).filter((b) => (q ? b.name.toLowerCase().includes(q) : (b.folderId ?? null) === current))
    return list.sort(sort === 'date' ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) : byName)
  }, [boards, current, query, sort])
  const countIn = (id: string) => (boards?.filter((b) => b.folderId === id).length ?? 0) + folders.filter((f) => f.parentId === id).length

  const go = (id: string | null) => {
    setCurrent(id)
    setQuery('')
    setSel(new Set())
    setAnchor(null)
  }

  // ---- selección ----
  const mineSel = useMemo(() => (boards ?? []).filter((b) => sel.has(b.id)), [boards, sel])
  const movable = mineSel.filter((b) => canTouch(b.createdBy))
  const toggle = (id: string) => {
    setSel((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
    setAnchor(id)
  }
  const clickBoard = (b: BoardItem, e: MouseEvent | KeyboardEvent) => {
    if (e.shiftKey && anchor) {
      const ids = shownBoards.map((x) => x.id)
      const a = ids.indexOf(anchor)
      const z = ids.indexOf(b.id)
      if (a >= 0 && z >= 0) {
        setSel(new Set(ids.slice(Math.min(a, z), Math.max(a, z) + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey || sel.size > 0) toggle(b.id)
    else onOpen(b)
  }
  const allShown = shownBoards.length > 0 && shownBoards.every((b) => sel.has(b.id))
  useEffect(() => {
    if (!sel.size) return
    // Esc quita primero la selección (en fase de captura, para que no cierre también el explorador)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return
      e.stopImmediatePropagation()
      setSel(new Set())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel.size])

  // ---- acciones ----
  async function moveMany(list: BoardItem[], folderId: string | null) {
    const todo = list.filter((b) => canTouch(b.createdBy) && (b.folderId ?? null) !== folderId)
    if (!todo.length) return toast(list.length ? 'No hay nada que mover (ya están ahí o no son tuyas)' : 'Nada seleccionado', 'info')
    const results = await Promise.allSettled(todo.map((b) => api<BoardItem>(`/rooms/${room.code}/docs/${b.id}/folder`, 'PUT', { folderId })))
    setBoards((all) => all?.map((x) => (todo.some((t) => t.id === x.id) ? { ...x, folderId } : x)) ?? all)
    const bad = results.filter((r) => r.status === 'rejected').length
    const okCount = todo.length - bad
    toast(bad ? `Se movieron ${okCount} y ${bad} no se pudieron mover` : `${okCount} pizarra${okCount === 1 ? '' : 's'} movida${okCount === 1 ? '' : 's'} a «${folderId ? folderById.get(folderId)?.name : 'Pizarras'}»`, bad ? 'error' : 'success')
    setSel(new Set())
  }

  async function removeMany(list: BoardItem[]) {
    const todo = list.filter((b) => canTouch(b.createdBy))
    if (!todo.length || !await dialogs.confirm({ title: todo.length === 1 ? `¿Borrar la pizarra «${todo[0]!.name}»?` : `¿Borrar ${todo.length} pizarras?`, message: 'También se borran sus archivos .excalidraw de la sala. No se puede deshacer.', confirmLabel: todo.length === 1 ? 'Borrar pizarra' : 'Borrar pizarras', tone: 'danger' })) return
    await Promise.allSettled(todo.map((b) => api(`/rooms/${room.code}/docs/${b.id}`, 'DELETE')))
    setSel(new Set())
  }

  async function createFolder(e: FormEvent) {
    e.preventDefault()
    try {
      const f = await api<FolderItem>(`/rooms/${room.code}/folders?kind=BOARD`, 'POST', { name: folderName, parentId: current })
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
      const u = await api<FolderItem>(`/rooms/${room.code}/folders/${f.id}`, 'PATCH', { name: n.trim() })
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
    const n = (boards ?? []).filter((b) => b.folderId && ids.has(b.folderId)).length
    if (!await dialogs.confirm({ title: `¿Borrar la carpeta «${f.name}»?`, message: n ? <>También se borrarán sus <b>{n} pizarra{n === 1 ? '' : 's'}</b>. No se puede deshacer.</> : 'No se puede deshacer.', confirmLabel: 'Borrar carpeta', tone: 'danger' })) return
    await api(`/rooms/${room.code}/folders/${f.id}`, 'DELETE').catch(fail)
  }

  async function create() {
    setBusy('Creando…')
    try {
      onOpen(await api<BoardItem>(`/rooms/${room.code}/docs`, 'POST', { kind: 'BOARD', name: 'Pizarra sin título', folderId: current }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo crear la pizarra', 'error')
    } finally {
      setBusy('')
    }
  }

  /** Importa una pizarra: .excalidraw/.json tal cual; PNG o SVG con la escena incrustada se convierten aquí. */
  async function importFile(file: File) {
    setBusy('Importando…')
    try {
      let blob: Blob = file
      let name = file.name.replace(/\.(excalidraw|json|png|svg)$/i, '')
      if (/\.(png|svg)$/i.test(file.name) || file.type.startsWith('image/')) {
        const { loadFromBlob, serializeAsJSON } = await import('@excalidraw/excalidraw')
        let data
        try {
          data = await loadFromBlob(file, null, null)
        } catch {
          throw new Error('Esa imagen no lleva una pizarra incrustada. Para añadir una imagen, ábrela desde dentro de una pizarra (menú ⋯ → Importar).')
        }
        blob = new Blob([serializeAsJSON(data.elements, data.appState, data.files ?? {}, 'local')], { type: 'application/json' })
      } else {
        const parsed = JSON.parse(await file.text()) as { elements?: unknown }
        if (!Array.isArray(parsed.elements)) throw new Error('No es un archivo de pizarra válido (.excalidraw)')
      }
      const fd = new FormData()
      fd.append('file', new File([blob], `${name || 'Pizarra importada'}.excalidraw`, { type: 'application/json' }))
      const up = await fetch(`/api/rooms/${room.code}/files`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: fd })
      if (!up.ok) throw new ApiError(up.status, (await up.json().catch(() => null))?.message ?? `Error ${up.status}`)
      const f = (await up.json()) as { id: string }
      onOpen(await api<BoardItem>(`/rooms/${room.code}/docs/from-file/${f.id}${current ? `?folderId=${current}` : ''}`, 'POST'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar', 'error')
    } finally {
      setBusy('')
    }
  }

  /** Descarga una pizarra sin abrirla: el .excalidraw tal cual está guardado en la sala, o su imagen (PNG, SVG, PDF) dibujada aquí. */
  async function downloadBoard(b: BoardItem, format: 'excalidraw' | 'png' | 'svg' | 'pdf') {
    if (!b.sourceFileId) return toast('Esta pizarra aún no tiene archivo', 'error')
    setBusy('Preparando descarga…')
    try {
      const res = await fetch(`/api/rooms/${room.code}/files/${b.sourceFileId}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } })
      if (!res.ok) throw new Error('No se pudo leer el archivo de la pizarra')
      const raw = await res.blob()
      const blob = format === 'excalidraw' ? raw : await renderSavedBoard(raw, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${b.name}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  /** «Mover a»: Pizarras (raíz) y todas las carpetas con su ruta. */
  const moveTargets = (list: BoardItem[]): MenuItem[] => {
    const label = (f: FolderItem) => {
      const parts: string[] = []
      for (let x: FolderItem | undefined = f; x && parts.length < 12; x = x.parentId ? folderById.get(x.parentId) : undefined) parts.unshift(x.name)
      return parts.join(' / ')
    }
    const items: MenuItem[] = [{ label: 'Pizarras (sin carpeta)', icon: <House size={16} />, onClick: () => void moveMany(list, null) }]
    for (const f of [...folders].sort((a, b) => label(a).localeCompare(label(b)))) items.push({ label: label(f), icon: <FolderInput size={16} />, onClick: () => void moveMany(list, f.id) })
    return items
  }

  function boardMenu(b: BoardItem): MenuItem[] {
    const mine = canTouch(b.createdBy)
    const items: MenuItem[] = []
    if (mine) items.push({ label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: async () => {
      const n = await dialogs.prompt({ title: 'Cambiar nombre de la pizarra', label: 'Nombre', initial: b.name, maxLength: 120 })
      if (n) await api(`/rooms/${room.code}/docs/${b.id}`, 'PATCH', { name: n }).catch(fail)
    } })
    items.push({ heading: 'Descargar como' })
    for (const [f, label] of [['excalidraw', 'Pizarra (.excalidraw)'], ['png', 'Imagen PNG'], ['svg', 'Imagen SVG'], ['pdf', 'PDF']] as const) {
      items.push({ label, icon: <Download size={16} />, onClick: () => void downloadBoard(b, f) })
    }
    if (mine) {
      items.push({ heading: 'Mover a' }, ...moveTargets([b]), 'separator', { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void removeMany([b]) })
    }
    return items
  }

  // ---- arrastrar y soltar ----
  const dragIds = (b: BoardItem) => (sel.has(b.id) ? [...sel] : [b.id])
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(BOARDS_MIME)) return
      e.preventDefault()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: DragEvent) => {
      setDropTarget(null)
      const raw = e.dataTransfer.getData(BOARDS_MIME)
      if (!raw || !canWrite) return
      e.preventDefault()
      const ids: string[] = JSON.parse(raw)
      void moveMany((boards ?? []).filter((b) => ids.includes(b.id)), folderId)
    },
  })
  const activate = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  // ---- pintado ----
  const folderRows: ReactNode[] = shownFolders.map((f) => {
    const n = countIn(f.id)
    const mine = canTouch(f.createdBy)
    return (
      <div key={`d-${f.id}`} className={`fitem folder ${dropTarget === f.id ? 'drop-target' : ''}`} role="button" tabIndex={0} aria-label={`Carpeta ${f.name}`}
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
  })

  const check = (b: BoardItem) => (
    <button type="button" className={`board-check ${sel.has(b.id) ? 'on' : ''}`} aria-label={`${sel.has(b.id) ? 'Quitar de la selección' : 'Seleccionar'} ${b.name}`} aria-pressed={sel.has(b.id)}
      onClick={(e) => { e.stopPropagation(); toggle(b.id) }}>
      {sel.has(b.id) ? <SquareCheck size={20} /> : <Square size={20} />}
    </button>
  )
  const dragProps = (b: BoardItem) => canTouch(b.createdBy) ? {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(BOARDS_MIME, JSON.stringify(dragIds(b)))
      e.dataTransfer.effectAllowed = 'move'
    },
  } : {}
  const meta = (b: BoardItem) => `${b.createdByName} · ${when(b.updatedAt)}${searching && b.folderId ? ` · ${where(b.folderId)}` : ''}`

  const boardCards = shownBoards.map((b) => view === 'grid' ? (
    <div key={b.id} data-sel-id={b.id} className={`board-card ${sel.has(b.id) ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Abrir ${b.name}`} {...dragProps(b)}
      onClick={(e) => clickBoard(b, e)} onKeyDown={(e) => e.key === 'Enter' && clickBoard(b, e)}>
      <div className="board-thumb"><Thumb code={room.code} board={b} /></div>
      {check(b)}
      <div className="board-meta">
        <span className="fbody"><span className="fname truncate">{b.name}</span><span className="fmeta truncate">{meta(b)}</span></span>
        <span onClick={(e) => e.stopPropagation()}><Menu items={boardMenu(b)} /></span>
      </div>
    </div>
  ) : (
    <div key={b.id} data-sel-id={b.id} className={`fitem board-row ${sel.has(b.id) ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Abrir ${b.name}`} {...dragProps(b)}
      onClick={(e) => clickBoard(b, e)} onKeyDown={(e) => e.key === 'Enter' && clickBoard(b, e)}>
      {check(b)}
      <span className="ficon"><PenTool size={20} /></span>
      <span className="fbody"><span className="fname truncate">{b.name}</span><span className="fmeta truncate">{meta(b)}</span></span>
      <span className="factions" onClick={(e) => e.stopPropagation()}><Menu items={boardMenu(b)} /></span>
    </div>
  ))

  const empty = shownFolders.length === 0 && shownBoards.length === 0

  return (
    <div className={`explorer ${sel.size > 0 ? 'sel-active' : ''}`}>
      <div className="ex-toolbar">
        {canWrite && (
          <>
            <button className="btn primary sm" disabled={!!busy} onClick={() => void create()}>{busy === 'Creando…' ? <Loader2 size={15} className="spin-icon" /> : <Plus size={15} />} Nueva pizarra</button>
            <button className="btn sm" disabled={!!busy} onClick={() => pick.current?.click()}>{busy === 'Importando…' ? <Loader2 size={15} className="spin-icon" /> : <Upload size={15} />} Importar…</button>
            <button className="btn sm" onClick={() => { setCreating((c) => !c); setFolderName('') }}><FolderPlus size={15} /> Nueva carpeta</button>
            <input ref={pick} type="file" hidden accept=".excalidraw,.json,application/json,image/png,image/svg+xml" aria-label="Importar pizarra"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
          </>
        )}
        {busy === 'Preparando descarga…' && <span className="muted small"><Loader2 size={14} className="spin-icon" /> Preparando descarga…</span>}
        <span className="grow" />
        <div className="input-icon">
          <Search size={15} />
          <input type="search" placeholder="Buscar pizarras…" aria-label="Buscar pizarras" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="page-size" aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="name">Nombre</option>
          <option value="date">Más recientes</option>
        </select>
        <Tabs role="radiogroup" label="Vista" size="sm" value={view} onChange={(v) => setView(v as View)}
          items={[{ id: 'grid', title: 'Cuadrícula', icon: <LayoutGrid size={15} /> }, { id: 'list', title: 'Lista', icon: <List size={15} /> }]} />
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
          <House size={15} /> Pizarras
        </button>
        {path.map((f, i) => (
          <span key={f.id} className="row nowrap" style={{ gap: 0 }}>
            <ChevronRight size={14} className="sep" />
            <button className={`${i === path.length - 1 ? 'cur' : ''} ${dropTarget === `c-${f.id}` ? 'drop-target' : ''}`} onClick={() => go(f.id)} {...dropProps(`c-${f.id}`, f.id)}>{f.name}</button>
          </span>
        ))}
        {searching && <span className="muted small" style={{ marginLeft: 8 }}>Resultados de «{query.trim()}»</span>}
      </nav>

      {sel.size > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="Pizarras seleccionadas">
          <button type="button" className="icon-btn sm" aria-label="Quitar la selección" title="Quitar la selección (Esc)" onClick={() => setSel(new Set())}><X size={16} /></button>
          <strong>{sel.size} seleccionada{sel.size === 1 ? '' : 's'}</strong>
          <button type="button" className="btn ghost sm" onClick={() => setSel(allShown ? new Set() : new Set(shownBoards.map((b) => b.id)))}>{allShown ? 'Quitar todas' : 'Seleccionar todas'}</button>
          <span className="grow" />
          {movable.length > 0 && (
            <>
              <Menu label="Mover las seleccionadas a" items={[{ heading: `Mover ${movable.length} a` }, ...moveTargets(movable)]}
                trigger={<span className="btn sm"><FolderInput size={15} /> Mover a… <ChevronDown size={14} /></span>} />
              <button type="button" className="btn sm danger" onClick={() => void removeMany(movable)}><Trash2 size={15} /> Borrar</button>
            </>
          )}
        </div>
      )}

      <div ref={bodyRef} className="ex-body" onClick={(e) => { if (!justDragged.current && sel.size > 0 && !(e.target as Element).closest('[data-sel-id], button, a, .fitem, .menu, input, select')) setSel(new Set()) }}>
        {box && <div className="marquee" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
        {!canWrite && <p className="callout small" style={{ marginBottom: 10 }}>Tu rol en esta sala es de <strong>lector</strong>: puedes abrir las pizarras para verlas y descargarlas.</p>}
        {boards === null ? <p className="muted">Cargando…</p> : empty ? (
          <div className="empty">
            {searching ? <Search size={36} /> : <PenTool size={36} />}
            <strong>{searching ? 'Sin resultados' : current ? 'Esta carpeta está vacía' : 'Todavía no hay pizarras'}</strong>
            <span className="small">{searching ? 'Prueba con otro nombre.' : canWrite ? 'Crea una pizarra, importa un archivo .excalidraw o arrastra aquí pizarras desde otra carpeta.' : 'Todavía no hay nada que ver.'}</span>
          </div>
        ) : (
          <>
            {folderRows.length > 0 && <>
              {!searching && <div className="ex-section">Carpetas</div>}
              <div className={view === 'grid' ? 'fgrid' : 'flist'}>{folderRows}</div>
            </>}
            {boardCards.length > 0 && <>
              {!searching && <div className="ex-section">Pizarras</div>}
              <div key={`${view}-${current}-${searching}`} className={`${view === 'grid' ? 'board-grid' : 'flist'} swap`}>{boardCards}</div>
            </>}
          </>
        )}
      </div>

      <div className="ex-status">
        <span>{shownFolders.length} carpeta{shownFolders.length === 1 ? '' : 's'} · {shownBoards.length} pizarra{shownBoards.length === 1 ? '' : 's'}</span>
        <span className="hide-sm">{canWrite ? 'Ctrl/⌘ o Mayús + clic para seleccionar varias · arrástralas a una carpeta para moverlas' : 'Clic para abrir'}</span>
      </div>
    </div>
  )
}

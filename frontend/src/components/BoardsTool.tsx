import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Download, FolderInput, Loader2, PenTool, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { api, ApiError, getAccessToken, type Room } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useToast } from '../toast'
import type { DocInfo } from '../collab/DocEditor'
import { renderSavedBoard } from '../collab/boardIO'
import Menu, { type MenuItem } from './Menu'
import Tabs from './Tabs'

interface BoardItem extends DocInfo {
  createdBy: string
  createdByName: string
  updatedAt: string
}

interface Folder {
  id: string
  name: string
  createdBy: string
}

const ALL = 'all'
const NONE = 'none'
const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name)

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

/** Pizarras colaborativas de la sala (galería): crear, importar, abrir, renombrar, mover entre carpetas y borrar. */
export default function BoardsTool({ room, onOpen }: { room: Room; onOpen: (d: DocInfo) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [boards, setBoards] = useState<BoardItem[] | null>(null)
  const [busy, setBusy] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [filter, setFilter] = useState(ALL)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [folderName, setFolderName] = useState('')
  const pick = useRef<HTMLInputElement>(null)
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)

  const load = useCallback(() => api<BoardItem[]>(`/rooms/${room.code}/docs`).then((all) => setBoards(all.filter((d) => d.kind === 'BOARD'))).catch(() => setBoards([])), [room.code])
  const loadFolders = useCallback(() => api<Folder[]>(`/rooms/${room.code}/folders?kind=BOARD`).then(setFolders).catch(() => {}), [room.code])
  useEffect(() => void load(), [load])
  useEffect(() => void loadFolders(), [loadFolders])
  useRealtime('reconnected', () => { void load(); void loadFolders() })
  useRealtime('folder.added', (f: Folder & { kind: string }) => f.kind === 'BOARD' && setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f].sort(byName))))
  useRealtime('folder.updated', (f: Folder & { kind: string }) => f.kind === 'BOARD' && setFolders((all) => all.map((x) => (x.id === f.id ? f : x)).sort(byName)))
  useRealtime('folder.deleted', (d: { kind: string; ids: string[] }) => {
    if (d.kind !== 'BOARD') return
    setFolders((all) => all.filter((x) => !d.ids.includes(x.id)))
    setBoards((all) => all?.filter((b) => !b.folderId || !d.ids.includes(b.folderId)) ?? all)
    setFilter((f) => (d.ids.includes(f) ? ALL : f))
  })
  useRealtime('doc.moved', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, folderId: d.folderId } : x)) ?? all))
  useRealtime('doc.created', (d: BoardItem) => d.kind === 'BOARD' && setBoards((all) => (all && !all.some((x) => x.id === d.id) ? [d, ...all] : all)))
  useRealtime('doc.renamed', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, name: d.name, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.thumb', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, thumbAt: d.thumbAt, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.deleted', (d: { id: string }) => setBoards((all) => all?.filter((x) => x.id !== d.id) ?? all))

  const currentFolder = folders.find((f) => f.id === filter)
  const countOf = (id: string) => boards?.filter((b) => (id === NONE ? !b.folderId : b.folderId === id)).length ?? 0
  const shown = useMemo(() => (boards ?? []).filter((b) => filter === ALL || (filter === NONE ? !b.folderId : b.folderId === filter)), [boards, filter])
  const canTouch = (ownerId: string) => canWrite && (ownerId === user?.id || staff)
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Algo salió mal', 'error')

  async function createFolder(e: FormEvent) {
    e.preventDefault()
    try {
      const f = await api<Folder>(`/rooms/${room.code}/folders?kind=BOARD`, 'POST', { name: folderName })
      setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f].sort(byName)))
      setAdding(false)
      setFolderName('')
      setFilter(f.id)
    } catch (err) {
      fail(err)
    }
  }

  async function renameFolder(e: FormEvent) {
    e.preventDefault()
    if (!currentFolder) return
    try {
      const f = await api<Folder>(`/rooms/${room.code}/folders/${currentFolder.id}`, 'PATCH', { name: folderName })
      setFolders((all) => all.map((x) => (x.id === f.id ? f : x)).sort(byName))
      setRenaming(false)
    } catch (err) {
      fail(err)
    }
  }

  async function removeFolder() {
    if (!currentFolder) return
    const n = countOf(currentFolder.id)
    if (!confirm(`¿Borrar la carpeta «${currentFolder.name}»${n ? ` y sus ${n} pizarra${n === 1 ? '' : 's'}` : ''}? No se puede deshacer.`)) return
    await api(`/rooms/${room.code}/folders/${currentFolder.id}`, 'DELETE').catch(fail)
  }

  async function move(b: BoardItem, folderId: string | null) {
    try {
      const d = await api<BoardItem>(`/rooms/${room.code}/docs/${b.id}/folder`, 'PUT', { folderId })
      setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, folderId: d.folderId } : x)) ?? all)
    } catch (err) {
      fail(err)
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

  function menu(b: BoardItem, mine: boolean): MenuItem[] {
    const items: MenuItem[] = []
    if (mine) items.push({ label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: async () => {
      const n = window.prompt('Nuevo nombre', b.name)
      if (n?.trim()) await api(`/rooms/${room.code}/docs/${b.id}`, 'PATCH', { name: n.trim() }).catch(fail)
    } })
    items.push({ heading: 'Descargar como' })
    for (const [f, label] of [['excalidraw', 'Pizarra (.excalidraw)'], ['png', 'Imagen PNG'], ['svg', 'Imagen SVG'], ['pdf', 'PDF']] as const) {
      items.push({ label, icon: <Download size={16} />, onClick: () => void downloadBoard(b, f) })
    }
    if (mine && (folders.length || b.folderId)) {
      items.push({ heading: 'Mover a' })
      if (b.folderId) items.push({ label: 'Sin carpeta', icon: <FolderInput size={16} />, onClick: () => void move(b, null) })
      for (const f of folders) if (f.id !== b.folderId) items.push({ label: f.name, icon: <FolderInput size={16} />, onClick: () => void move(b, f.id) })
    }
    if (mine) items.push('separator', { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: async () => {
      if (confirm(`¿Borrar la pizarra «${b.name}»? También se borra su archivo .excalidraw de la sala.`)) await api(`/rooms/${room.code}/docs/${b.id}`, 'DELETE').catch(fail)
    } })
    return items
  }

  async function create() {
    setBusy('Creando…')
    try {
      onOpen(await api<BoardItem>(`/rooms/${room.code}/docs`, 'POST', { kind: 'BOARD', name: 'Pizarra sin título', folderId: currentFolder?.id ?? null }))
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
      onOpen(await api<BoardItem>(`/rooms/${room.code}/docs/from-file/${f.id}${currentFolder ? `?folderId=${currentFolder.id}` : ''}`, 'POST'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="explorer">
      {canWrite ? (
        <div className="ex-toolbar">
          <button className="btn primary sm" disabled={!!busy} onClick={() => void create()}>{busy === 'Creando…' ? <Loader2 size={15} className="spin-icon" /> : <Plus size={15} />} Nueva pizarra</button>
          <button className="btn sm" disabled={!!busy} onClick={() => pick.current?.click()}>{busy === 'Importando…' ? <Loader2 size={15} className="spin-icon" /> : <Upload size={15} />} Importar…</button>
          <input ref={pick} type="file" hidden accept=".excalidraw,.json,application/json,image/png,image/svg+xml" aria-label="Importar pizarra"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
          <span className="muted small">Importa archivos <b>.excalidraw</b>, o imágenes PNG/SVG exportadas con la escena incrustada.</span>
        </div>
      ) : (
        <p className="callout small" style={{ margin: '12px 16px 0' }}>Tu rol en esta sala es de <strong>lector</strong>: puedes abrir las pizarras para verlas.</p>
      )}
      <div className="ex-toolbar">
        <div className="grow" style={{ minWidth: 0 }}>
          <Tabs label="Carpetas" value={filter} onChange={setFilter} size="sm"
            items={[
              { id: ALL, label: 'Todas', count: boards?.length ?? 0 },
              { id: NONE, label: 'Sin carpeta', count: countOf(NONE) },
              ...folders.map((f) => ({ id: f.id, label: f.name, count: countOf(f.id) })),
            ]} />
        </div>
        {canWrite && <button className="btn sm" onClick={() => { setAdding((a) => !a); setRenaming(false); setFolderName('') }}><Plus size={15} /> Carpeta</button>}
        {currentFolder && canTouch(currentFolder.createdBy) && (
          <>
            <button className="icon-btn sm" aria-label="Cambiar nombre de la carpeta" title="Cambiar nombre" onClick={() => { setRenaming(true); setAdding(false); setFolderName(currentFolder.name) }}><Pencil size={15} /></button>
            <button className="icon-btn danger sm" aria-label="Borrar carpeta" title="Borrar carpeta" onClick={() => void removeFolder()}><Trash2 size={15} /></button>
          </>
        )}
      </div>
      {adding && (
        <form className="inline-form" onSubmit={createFolder}>
          <input autoFocus required maxLength={60} placeholder="Nombre de la carpeta" aria-label="Nombre de la carpeta" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          <button className="btn primary sm" disabled={!folderName.trim()}>Crear</button>
          <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancelar</button>
        </form>
      )}
      {renaming && currentFolder && (
        <form className="inline-form" onSubmit={renameFolder}>
          <input autoFocus required maxLength={60} aria-label="Nuevo nombre" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          <button className="btn primary sm" disabled={!folderName.trim()}><Check size={15} /> Guardar</button>
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(false)}><X size={15} /></button>
        </form>
      )}
      <div className="ex-body">
        {boards === null ? <p className="muted">Cargando…</p> : shown.length === 0 ? (
          <div className="empty"><PenTool size={36} /><strong>{filter === ALL ? 'Todavía no hay pizarras' : 'No hay pizarras aquí'}</strong><span className="small">Crea una nueva o importa un archivo .excalidraw para dibujar entre todos.</span></div>
        ) : (
          <div className="board-grid">
            {shown.map((b) => (
              <div key={b.id} className="board-card" role="button" tabIndex={0} aria-label={`Abrir ${b.name}`} onClick={() => onOpen(b)} onKeyDown={(e) => e.key === 'Enter' && onOpen(b)}>
                <div className="board-thumb"><Thumb code={room.code} board={b} /></div>
                <div className="board-meta">
                  <span className="fbody"><span className="fname truncate">{b.name}</span><span className="fmeta truncate">{b.createdByName} · {when(b.updatedAt)}{filter === ALL && b.folderId ? ` · ${folders.find((f) => f.id === b.folderId)?.name ?? ''}` : ''}</span></span>
                  <span onClick={(e) => e.stopPropagation()}><Menu items={menu(b, canTouch(b.createdBy))} /></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

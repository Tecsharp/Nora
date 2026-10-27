import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  ChevronRight, Download, File, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder, FolderInput, FolderPlus,
  House, LayoutGrid, List, Pencil, Search, Trash2, Upload,
} from 'lucide-react'
import { api, ApiError, download, formatBytes, type Room } from '../api'
import { useAuth } from '../auth'
import { pickFiles } from '../fileHandles'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { fileFromHandle, isActive, loadInterrupted, pruneStaleHandles, uploads, useUploads, type PendingUpload } from '../uploadManager'
import Menu, { type MenuItem } from './Menu'
import Modal from './Modal'
import Tabs from './Tabs'
import ProgressBar from './ProgressBar'

interface FileItem {
  id: string
  name: string
  sizeBytes: number
  uploaderId: string
  createdAt: string
  folderId: string | null
}

interface FolderItem {
  id: string
  parentId: string | null
  name: string
  createdBy: string
  createdAt: string
}

/** Subida de otra persona, reportada por el servidor por WebSocket. */
interface Remote {
  uploadId: string
  userId: string
  name: string
  received: number
  total: number
}

type Sort = 'name' | 'date' | 'size'
type View = 'grid' | 'list'

const VIEW_KEY = 'nora-files-view'
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

const EXT: Record<string, typeof File> = {
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage, heic: FileImage, jxl: FileImage, avif: FileImage,
  mp4: FileVideo, mov: FileVideo, mkv: FileVideo, webm: FileVideo, avi: FileVideo,
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, m4a: FileAudio, ogg: FileAudio,
  pdf: FileText, doc: FileText, docx: FileText, txt: FileText, md: FileText, rtf: FileText, xls: FileText, xlsx: FileText, ppt: FileText, pptx: FileText, csv: FileText,
  zip: FileArchive, rar: FileArchive, '7z': FileArchive, tar: FileArchive, gz: FileArchive,
  js: FileCode, ts: FileCode, tsx: FileCode, json: FileCode, html: FileCode, css: FileCode, py: FileCode, java: FileCode, sh: FileCode, yml: FileCode, xml: FileCode,
}
const iconFor = (name: string) => EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? File

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function FilesTool({ room }: { room: Room }) {
  const { user } = useAuth()
  const toast = useToast()
  const mine = useUploads().filter((i) => i.code === room.code)
  const [files, setFiles] = useState<FileItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [remotes, setRemotes] = useState<Record<string, Remote>>({})
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<string | null>(null)
  const [view, setViewState] = useState<View>(readView)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [renaming, setRenaming] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [moving, setMoving] = useState<FileItem | null>(null)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* preferencia opcional */
    }
  }

  const who = useCallback((id: string) => room.participants.find((p) => p.userId === id)?.displayName ?? '—', [room.participants])
  const isStaff = room.isOwner || user?.role === 'ADMIN'
  const canTouch = (ownerId: string) => ownerId === user?.id || isStaff

  const load = useCallback(() => {
    api<FileItem[]>(`/rooms/${room.code}/files`).then(setFiles).catch(() => {})
    api<FolderItem[]>(`/rooms/${room.code}/folders?kind=FILE`).then(setFolders).catch(() => {})
    loadInterrupted(room.code).then(setPending)
    void pruneStaleHandles(room.code)
  }, [room.code])

  useEffect(load, [load])
  // Al terminar o cancelar una subida propia se actualiza la lista de interrumpidas
  const activeCount = mine.filter(isActive).length
  useEffect(load, [activeCount, load])
  // Respaldo por si se pierde algún evento mientras no hay WebSocket
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  useRealtime('reconnected', load)
  useRealtime('file.added', (f: FileItem) => {
    setFiles((all) => (all.some((x) => x.id === f.id) ? all : [f, ...all]))
    if (f.uploaderId !== user?.id) toast(`${who(f.uploaderId)} subió «${f.name}»`, 'success')
  })
  useRealtime('file.updated', (f: FileItem) => setFiles((all) => all.map((x) => (x.id === f.id ? f : x))))
  useRealtime('file.deleted', (d: { id: string }) => setFiles((all) => all.filter((x) => x.id !== d.id)))
  useRealtime('folder.added', (f: FolderItem) => setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f])))
  useRealtime('folder.updated', (f: FolderItem) => setFolders((all) => all.map((x) => (x.id === f.id ? f : x))))
  useRealtime('folder.deleted', (d: { kind: string; id: string; ids: string[]; files: string[] }) => {
    if (d.kind !== 'FILE') return
    setFolders((all) => all.filter((x) => !d.ids.includes(x.id)))
    setFiles((all) => all.filter((x) => !d.files.includes(x.id)))
    setCurrent((c) => (c && d.ids.includes(c) ? null : c))
  })
  useRealtime('upload.progress', (d: Remote) => {
    if (d.userId !== user?.id) setRemotes((r) => ({ ...r, [d.uploadId]: d }))
  })
  const dropRemote = (d: { uploadId: string }) =>
    setRemotes((r) => {
      const { [d.uploadId]: _gone, ...rest } = r
      return rest
    })
  useRealtime('upload.done', dropRemote)
  useRealtime('upload.aborted', dropRemote)

  // ── Navegación ──
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const path = useMemo(() => {
    const out: FolderItem[] = []
    for (let id = current, guard = 0; id && guard < 20; guard++) {
      const f = byId.get(id)
      if (!f) break
      out.unshift(f)
      id = f.parentId
    }
    return out
  }, [current, byId])
  useEffect(() => {
    if (current && !byId.has(current) && folders.length > 0) setCurrent(null)
  }, [current, byId, folders.length])

  const searching = query.trim() !== ''
  const q = query.trim().toLowerCase()
  const shownFolders = useMemo(
    () => folders.filter((f) => (searching ? f.name.toLowerCase().includes(q) : f.parentId === current)).sort((a, b) => a.name.localeCompare(b.name)),
    [folders, searching, q, current],
  )
  const shownFiles = useMemo(() => {
    const list = files.filter((f) => (searching ? f.name.toLowerCase().includes(q) : (f.folderId ?? null) === current))
    return list.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.sizeBytes - a.sizeBytes : b.createdAt.localeCompare(a.createdAt))
  }, [files, searching, q, current, sort])

  const countIn = (id: string) => files.filter((f) => f.folderId === id).length + folders.filter((f) => f.parentId === id).length
  const where = (folderId: string | null) =>
    folderId ? [...pathOf(folderId, byId).map((f) => f.name)].join(' / ') : 'Todos los archivos'

  // ── Acciones ──
  async function onPick() {
    setError('')
    // Las subidas viven en un gestor global: cerrar el explorador no las interrumpe.
    for (const { file, handle } of await pickFiles()) uploads.add(room.code, file, handle, current)
  }

  async function resume(p: PendingUpload) {
    setError('')
    const file = await fileFromHandle(room.code, p, true) // 1 clic: si hace falta, el navegador pide permiso
    if (file) {
      uploads.add(room.code, file)
      return
    }
    toast(`Elige de nuevo «${p.name}» para continuar`, 'info')
    onPick()
  }

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Algo salió mal')

  async function createFolder(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const f = await api<FolderItem>(`/rooms/${room.code}/folders?kind=FILE`, 'POST', { name: folderName, parentId: current })
      setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f]))
      setCreating(false)
      setFolderName('')
    } catch (err) {
      fail(err)
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault()
    if (!renaming) return
    setError('')
    try {
      if (renaming.kind === 'folder') {
        const f = await api<FolderItem>(`/rooms/${room.code}/folders/${renaming.id}`, 'PATCH', { name: renaming.name })
        setFolders((all) => all.map((x) => (x.id === f.id ? f : x)))
      } else {
        const f = await api<FileItem>(`/rooms/${room.code}/files/${renaming.id}`, 'PATCH', { name: renaming.name })
        setFiles((all) => all.map((x) => (x.id === f.id ? f : x)))
      }
      setRenaming(null)
    } catch (err) {
      fail(err)
    }
  }

  async function removeFolder(f: FolderItem) {
    const n = countIn(f.id)
    if (!confirm(`¿Borrar la carpeta «${f.name}»${n ? ` y todo su contenido (${n} elemento${n === 1 ? '' : 's'})` : ''}? No se puede deshacer.`)) return
    await api(`/rooms/${room.code}/folders/${f.id}`, 'DELETE').catch(fail)
  }

  async function removeFile(f: FileItem) {
    if (!confirm(`¿Borrar «${f.name}»?`)) return
    await api(`/rooms/${room.code}/files/${f.id}`, 'DELETE').catch(fail)
  }

  async function moveFile(f: FileItem, folderId: string | null) {
    if ((f.folderId ?? null) === folderId) return
    setError('')
    try {
      const updated = await api<FileItem>(`/rooms/${room.code}/files/${f.id}`, 'PATCH', { folderId })
      setFiles((all) => all.map((x) => (x.id === updated.id ? updated : x)))
      toast(`«${f.name}» movido a ${where(folderId)}`, 'success')
    } catch (err) {
      fail(err)
    }
  }

  const downloadFile = (f: FileItem) =>
    download(`/rooms/${room.code}/files/${f.id}`, f.name).catch((e) => setError(e instanceof ApiError ? e.message : 'Error al descargar'))

  // ── Arrastrar y soltar ──
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const NORA_MIME = 'application/x-nora-file'

  function dropOn(e: DragEvent, folderId: string | null) {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    setDragOver(false)
    const id = e.dataTransfer.getData(NORA_MIME)
    if (id) {
      const f = files.find((x) => x.id === id)
      if (f && canTouch(f.uploaderId)) void moveFile(f, folderId)
      return
    }
    for (const file of Array.from(e.dataTransfer.files)) uploads.add(room.code, file, undefined, folderId)
  }

  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: DragEvent) => dropOn(e, folderId),
  })

  const activate = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  function fileMenu(f: FileItem): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Descargar', icon: <Download size={16} />, onClick: () => void downloadFile(f) }]
    if (canTouch(f.uploaderId)) {
      items.push(
        { label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: () => setRenaming({ kind: 'file', id: f.id, name: f.name }) },
        { label: 'Mover a…', icon: <FolderInput size={16} />, onClick: () => setMoving(f) },
        'separator',
        { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void removeFile(f) },
      )
    }
    return items
  }

  function folderMenu(f: FolderItem): MenuItem[] {
    if (!canTouch(f.createdBy)) return []
    return [
      { label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: () => setRenaming({ kind: 'folder', id: f.id, name: f.name }) },
      'separator',
      { label: 'Borrar carpeta', icon: <Trash2 size={16} />, danger: true, onClick: () => void removeFolder(f) },
    ]
  }

  const empty = shownFolders.length === 0 && shownFiles.length === 0
  const rows: ReactNode[] = []

  for (const f of shownFolders) {
    const menu = folderMenu(f)
    rows.push(
      <div key={`d-${f.id}`} className={`fitem folder ${dropTarget === f.id ? 'drop-target' : ''}`} role="button" tabIndex={0}
        aria-label={`Carpeta ${f.name}`}
        onClick={() => { setCurrent(f.id); setQuery('') }} onKeyDown={activate(() => { setCurrent(f.id); setQuery('') })}
        {...dropProps(f.id, f.id)}>
        <span className="ficon"><Folder size={22} /></span>
        <span className="fbody">
          <span className="fname truncate">{f.name}</span>
          <span className="fmeta truncate">{countIn(f.id)} elemento{countIn(f.id) === 1 ? '' : 's'}{searching && f.parentId ? ` · ${where(f.parentId)}` : ''}</span>
        </span>
        {menu.length > 0 && <span className="factions"><Menu items={menu} /></span>}
      </div>,
    )
  }

  for (const f of shownFiles) {
    const Icon = iconFor(f.name)
    rows.push(
      <div key={`f-${f.id}`} className="fitem" role="button" tabIndex={0} aria-label={`Descargar ${f.name}`}
        draggable={canTouch(f.uploaderId)}
        onDragStart={(e) => { e.dataTransfer.setData(NORA_MIME, f.id); e.dataTransfer.effectAllowed = 'move' }}
        onClick={() => void downloadFile(f)} onKeyDown={activate(() => void downloadFile(f))}>
        <span className="ficon"><Icon size={22} /></span>
        <span className="fbody">
          <span className="fname truncate">{f.name}</span>
          <span className="fmeta truncate">
            {formatBytes(f.sizeBytes)} · {who(f.uploaderId)}{view === 'list' ? ` · ${when(f.createdAt)}` : ''}
            {searching && f.folderId ? ` · ${where(f.folderId)}` : ''}
          </span>
        </span>
        <span className="factions">
          <button className="icon-btn sm" title="Descargar" aria-label={`Descargar ${f.name}`} onClick={(e) => { e.stopPropagation(); void downloadFile(f) }}>
            <Download size={16} />
          </button>
          <Menu items={fileMenu(f)} />
        </span>
      </div>,
    )
  }

  return (
    <div
      className="explorer"
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => dropOn(e, current)}
    >
      <div className="ex-toolbar">
        <button className="btn primary sm" onClick={onPick}><Upload size={15} /> Subir</button>
        <button className="btn sm" onClick={() => { setCreating((c) => !c); setFolderName('') }}><FolderPlus size={15} /> Nueva carpeta</button>
        <span className="grow" />
        <div className="input-icon">
          <Search size={15} />
          <input type="search" placeholder="Buscar archivos…" aria-label="Buscar archivos" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="page-size" aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="name">Nombre</option>
          <option value="date">Más recientes</option>
          <option value="size">Tamaño</option>
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
      {renaming && (
        <form className="inline-form" onSubmit={rename}>
          <input autoFocus required maxLength={renaming.kind === 'folder' ? 60 : 255} aria-label="Nuevo nombre" value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
          <button className="btn primary sm" disabled={!renaming.name.trim()}>Guardar</button>
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(null)}>Cancelar</button>
        </form>
      )}

      <nav className="crumbs" aria-label="Ruta">
        <button className={`${current === null && !searching ? 'cur' : ''} ${dropTarget === 'root' ? 'drop-target' : ''}`}
          onClick={() => { setCurrent(null); setQuery('') }} {...dropProps('root', null)}>
          <House size={15} /> Archivos
        </button>
        {path.map((f, i) => (
          <span key={f.id} className="row nowrap" style={{ gap: 0 }}>
            <ChevronRight size={14} className="sep" />
            <button className={`${i === path.length - 1 ? 'cur' : ''} ${dropTarget === `c-${f.id}` ? 'drop-target' : ''}`}
              onClick={() => { setCurrent(f.id); setQuery('') }} {...dropProps(`c-${f.id}`, f.id)}>
              {f.name}
            </button>
          </span>
        ))}
        {searching && <span className="muted small" style={{ marginLeft: 8 }}>Resultados de «{query.trim()}»</span>}
      </nav>

      <div className={`ex-body ${dragOver ? 'dragging' : ''}`}>
        {error && <p className="error small" role="alert">{error}</p>}

        {mine.map((i) => (
          <div key={i.key} className="upload-item">
            <div className="row spread nowrap">
              <strong className="truncate small">{i.file.name}</strong>
              {isActive(i) ? (
                <button className="btn ghost sm" onClick={() => uploads.cancel(i.key)}>Cancelar</button>
              ) : (
                <button className="btn ghost sm" onClick={() => uploads.dismiss(i.key)}>Quitar</button>
              )}
            </div>
            <ProgressBar p={i.progress} />
          </div>
        ))}
        {activeCount > 0 && <p className="muted small" style={{ marginBottom: 8 }}>Puedes cerrar el explorador: las subidas continúan en segundo plano.</p>}

        {Object.values(remotes).map((r) => (
          <div key={r.uploadId} className="upload-item">
            <span className="small"><strong>{who(r.userId)}</strong> está subiendo «{r.name}»</span>
            <ProgressBar p={{ state: 'uploading', loaded: r.received, total: r.total, speed: 0, eta: null }} hideSpeed />
          </div>
        ))}

        {pending.map((p) => (
          <div key={p.id} className="upload-item pending">
            <div className="row spread">
              <span className="small">
                Subida interrumpida: <strong className="break">{p.name}</strong> ({Math.round((p.receivedBytes / p.size) * 100)}% enviado)
              </span>
              <div className="row">
                <button className="btn sm" onClick={() => resume(p)}>Reanudar</button>
                <button className="btn ghost sm"
                  onClick={async () => {
                    await api(`/rooms/${room.code}/uploads/${p.id}`, 'DELETE').catch((e) => setError(e.message))
                    load()
                  }}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        ))}

        {empty ? (
          <div className="empty">
            {searching ? <Search size={36} /> : <Folder size={36} />}
            <strong>{searching ? 'Sin resultados' : current ? 'Esta carpeta está vacía' : 'No hay archivos en esta sala'}</strong>
            <span className="small">
              {searching ? 'Prueba con otro nombre.' : 'Pulsa «Subir» o arrastra archivos aquí.'}
              {!searching && ` Máx. por archivo: ${formatBytes(user?.limits.maxFileSizeBytes)}.`}
            </span>
          </div>
        ) : (
          <>
            {!searching && <div className="ex-section">{shownFolders.length > 0 && shownFiles.length > 0 ? 'Carpetas y archivos' : shownFolders.length > 0 ? 'Carpetas' : 'Archivos'}</div>}
            <div key={`${view}-${current}-${searching}`} className={`${view === 'grid' ? 'fgrid' : 'flist'} swap`}>{rows}</div>
          </>
        )}
      </div>

      <div className="ex-status">
        <span>{shownFolders.length} carpeta{shownFolders.length === 1 ? '' : 's'} · {shownFiles.length} archivo{shownFiles.length === 1 ? '' : 's'}</span>
        <span className="hide-sm">Subida reanudable · arrastra un archivo a una carpeta para moverlo</span>
      </div>

      {moving && (
        <Modal title={`Mover «${moving.name}»`} onClose={() => setMoving(null)}>
          <div className="stack tight">
            <button className="chip" style={{ justifyContent: 'flex-start', padding: '10px 14px' }} disabled={(moving.folderId ?? null) === null}
              onClick={() => { void moveFile(moving, null); setMoving(null) }}>
              <House size={15} /> Archivos (raíz)
            </button>
            {folderTree(folders).map(({ folder, depth }) => (
              <button key={folder.id} className="chip" style={{ justifyContent: 'flex-start', padding: '10px 14px', marginLeft: depth * 18 }}
                disabled={moving.folderId === folder.id}
                onClick={() => { void moveFile(moving, folder.id); setMoving(null) }}>
                <Folder size={15} /> {folder.name}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

function pathOf(id: string, byId: Map<string, FolderItem>): FolderItem[] {
  const out: FolderItem[] = []
  for (let cur: string | null = id, guard = 0; cur && guard < 20; guard++) {
    const f = byId.get(cur)
    if (!f) break
    out.unshift(f)
    cur = f.parentId
  }
  return out
}

/** Aplana el árbol de carpetas en orden alfabético con su profundidad, para elegir destino. */
function folderTree(folders: FolderItem[]): { folder: FolderItem; depth: number }[] {
  const out: { folder: FolderItem; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    folders
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((f) => {
        out.push({ folder: f, depth })
        walk(f.id, depth + 1)
      })
  }
  walk(null, 0)
  return out
}

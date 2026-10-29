import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  ChevronRight, Download, X, File, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder, PenTool, Presentation, Sheet, FilePlus2, ChevronDown, FolderInput, FolderPlus, FolderUp, Eye, Loader2,
  House, LayoutGrid, List, Pencil, Search, Square, SquareCheck, Trash2, Upload,
} from 'lucide-react'
import { api, ApiError, downloadWithProgress, formatBytes, type DownloadHandle, type Room } from '../api'
import { useAuth } from '../auth'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { pickFiles, pickFolder } from '../fileHandles'
import { collectFromEntries, collectFromFiles, entriesFromDrop, type Collected } from '../folderUpload'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { useDialogs } from '../dialogs'
import { useMarquee } from '../marquee'
import { fingerprintOf } from '../uploader'
import { isEditable, previewKind } from '../preview'
import type { DocInfo } from '../collab/DocEditor'
import { fileFromHandle, isActive, loadInterrupted, pruneStaleHandles, uploads, useUploads, type PendingUpload } from '../uploadManager'
import ProgressRing from './ProgressRing'
import FileViewer from './FileViewer'
import Menu, { type MenuItem } from './Menu'
import Modal from './Modal'
import Tabs from './Tabs'
import ProgressBar from './ProgressBar'
import { fmtDateTime } from '../dates'

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

/** Icono y color por tipo de archivo: documentos azul, hojas verde, presentaciones naranja, PDF rojo… */
const KIND_OF: Record<string, [typeof File, string]> = {}
const reg = (exts: string, icon: typeof File, tone: string) => exts.split(' ').forEach((e) => (KIND_OF[e] = [icon, tone]))
reg('png jpg jpeg gif webp svg heic jxl avif bmp ico', FileImage, 'rose')
reg('mp4 mov mkv webm avi', FileVideo, 'violet')
reg('mp3 wav flac m4a ogg', FileAudio, 'teal')
reg('doc docx odt rtf', FileText, 'blue')
reg('xls xlsx ods csv tsv', Sheet, 'green')
reg('ppt pptx odp', Presentation, 'orange')
reg('pdf', FileText, 'red')
reg('excalidraw', PenTool, 'violet')
reg('txt md log', FileText, 'gray')
reg('zip rar 7z tar gz', FileArchive, 'amber')
reg('js ts tsx json html css py java sh yml xml', FileCode, 'cyan')
const kindOf = (name: string): [typeof File, string] => KIND_OF[name.split('.').pop()?.toLowerCase() ?? ''] ?? [File, 'gray']

const NEW_KINDS = [
  { kind: 'DOC', label: 'Documento de texto', base: 'Documento sin título', icon: FileText },
  { kind: 'SHEET', label: 'Hoja de cálculo', base: 'Hoja de cálculo sin título', icon: Sheet },
  { kind: 'SLIDES', label: 'Presentación', base: 'Presentación sin título', icon: Presentation },
  { kind: 'BOARD', label: 'Pizarra', base: 'Pizarra sin título', icon: PenTool },
] as const

const when = fmtDateTime

export default function FilesTool({ room, onEditDoc }: { room: Room; onEditDoc?: (d: DocInfo) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const [zipping, setZipping] = useState(false) // el navegador está comprimiendo lo elegido (se ve como un .zip)
  const [reading, setReading] = useState(false) // leyendo una carpeta soltada
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
  const [newBusy, setNewBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [dl, setDl] = useState<Record<string, { loaded: number; total: number }>>({})
  const dlHandles = useRef(new Map<string, DownloadHandle>())
  const foldersRef = useRef<FolderItem[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  foldersRef.current = folders

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* preferencia opcional */
    }
  }

  const who = useCallback((id: string) => room.participants.find((p) => p.userId === id)?.displayName ?? '—', [room.participants])
  const isStaff = isStaffIn(room, user)
  const canWrite = canWriteIn(room, user)
  const canTouch = (ownerId: string) => canWrite && (ownerId === user?.id || isStaff)

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

  // Documentos que se pueden ver (imágenes, PDF y texto), en el orden en que se muestran
  const viewable = useMemo(() => shownFiles.filter((f) => previewKind(f.name)), [shownFiles])
  const viewIndex = viewing ? viewable.findIndex((f) => f.id === viewing) : -1

  const countIn = (id: string) => files.filter((f) => f.folderId === id).length + folders.filter((f) => f.parentId === id).length
  const where = (folderId: string | null) =>
    folderId ? [...pathOf(folderId, byId).map((f) => f.name)].join(' / ') : 'Todos los archivos'

  // ── Acciones ──
  async function onPick() {
    setError('')
    // Las subidas viven en un gestor global: cerrar el explorador no las interrumpe.
    const picked = await pickFiles(setZipping)
    for (const { file, handle } of picked) uploads.add(room.code, file, handle, current)
    if (picked.some((x) => /\.zip$/i.test(x.file.name) && x.file.type === 'application/zip')) toast('Los archivos .zip se suben tal cual, comprimidos', 'info')
  }

  async function onPickFolder() {
    setError('')
    const picked = await pickFolder(setZipping)
    if (picked.length > 0) await uploadCollected(collectFromFiles(picked), current)
  }

  /** Crea (o reutiliza) cada carpeta bajo `parent` y devuelve su id. */
  async function ensureFolder(parent: string | null, name: string): Promise<string> {
    const same = (f: FolderItem) => f.parentId === parent && f.name.toLowerCase() === name.toLowerCase()
    const found = foldersRef.current.find(same)
    if (found) return found.id
    try {
      const f = await api<FolderItem>(`/rooms/${room.code}/folders?kind=FILE`, 'POST', { name, parentId: parent })
      foldersRef.current = [...foldersRef.current, f]
      setFolders((all) => (all.some((x) => x.id === f.id) ? all : [...all, f]))
      return f.id
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // otra persona la creó a la vez: se vuelve a leer la lista
        const fresh = await api<FolderItem[]>(`/rooms/${room.code}/folders?kind=FILE`)
        foldersRef.current = fresh
        setFolders(fresh)
        const again = fresh.find(same)
        if (again) return again.id
      }
      throw err
    }
  }

  /** Reproduce la estructura de carpetas en la sala y pone en cola cada archivo en su carpeta. */
  async function uploadCollected(c: Collected, base: string | null) {
    const ids = new Map<string, string | null>([['', base]])
    const resolve = async (dir: string[]) => {
      let parent = base
      for (let i = 1; i <= dir.length; i++) {
        const key = dir.slice(0, i).join('/')
        if (!ids.has(key)) ids.set(key, await ensureFolder(parent, dir[i - 1]!))
        parent = ids.get(key)!
      }
      return parent
    }
    try {
      for (const dir of c.dirs.slice().sort((a, b) => a.length - b.length)) await resolve(dir)
      let queued = 0
      let empty = 0
      for (const { file, dir } of c.files) {
        if (file.size === 0) {
          empty++ // el servidor no admite archivos vacíos
          continue
        }
        uploads.add(room.code, file, undefined, await resolve(dir), fingerprintOf(file, dir.join('/')))
        queued++
      }
      if (queued > 0) toast(`Subiendo ${queued} archivo${queued === 1 ? '' : 's'}${c.dirs.length ? ` en ${c.dirs.length} carpeta${c.dirs.length === 1 ? '' : 's'}` : ''}`, 'info')
      if (empty > 0) toast(`${empty} archivo${empty === 1 ? ' vacío omitido' : 's vacíos omitidos'}`, 'warning')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la estructura de carpetas')
    }
  }

  async function resume(p: PendingUpload) {
    setError('')
    const file = await fileFromHandle(room.code, p, true) // 1 clic: si hace falta, el navegador pide permiso
    if (file) {
      uploads.add(room.code, file, undefined, undefined, p.fingerprint)
      return
    }
    toast(`Elige de nuevo «${p.name}» para continuar`, 'info')
    for (const { file: f, handle } of await pickFiles()) {
      // El mismo archivo continúa la subida a medias (con su carpeta de destino); cualquier otro se sube como nuevo
      const same = f.name === p.name && f.size === p.size
      uploads.add(room.code, f, handle, same ? undefined : current, same ? p.fingerprint : undefined)
    }
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
    if (!await dialogs.confirm({ title: `¿Borrar la carpeta «${f.name}»?`, message: n ? <>Se borrará también todo su contenido (<b>{n} elemento{n === 1 ? '' : 's'}</b>). No se puede deshacer.</> : 'No se puede deshacer.', confirmLabel: 'Borrar carpeta', tone: 'danger' })) return
    await api(`/rooms/${room.code}/folders/${f.id}`, 'DELETE').catch(fail)
  }

  async function removeFile(f: FileItem) {
    if (!await dialogs.confirm({ title: `¿Borrar «${f.name}»?`, message: 'El archivo se eliminará de la sala para todos. No se puede deshacer.', confirmLabel: 'Borrar archivo', tone: 'danger' })) return
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

  // ── Selección múltiple ──
  const selectedFiles = useMemo(() => files.filter((f) => sel.has(f.id)), [files, sel])
  const touchable = selectedFiles.filter((f) => canTouch(f.uploaderId))
  const toggleSel = (id: string) => {
    setSel((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
    setAnchor(id)
  }
  /** Clic en un archivo: con Ctrl/⌘ o Mayús (o con algo ya seleccionado) selecciona; si no, lo abre. */
  function clickFile(f: FileItem, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, open: () => void) {
    if (e.shiftKey && anchor) {
      const ids = shownFiles.map((x) => x.id)
      const a = ids.indexOf(anchor)
      const z = ids.indexOf(f.id)
      if (a >= 0 && z >= 0) return setSel(new Set(ids.slice(Math.min(a, z), Math.max(a, z) + 1)))
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey || sel.size > 0) toggleSel(f.id)
    else open()
  }
  const { box, justDragged } = useMarquee(bodyRef, true, (ids, additive) => setSel((s) => (additive ? new Set([...s, ...ids]) : new Set(ids))))
  const clearSel = () => {
    setSel(new Set())
    setAnchor(null)
  }
  useEffect(() => clearSel(), [current, query])
  useEffect(() => {
    if (!sel.size) return
    // Esc quita primero la selección (en fase de captura, para que no cierre también el explorador)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return
      e.stopImmediatePropagation()
      clearSel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel.size])

  async function moveMany(list: FileItem[], folderId: string | null) {
    const todo = list.filter((f) => canTouch(f.uploaderId) && (f.folderId ?? null) !== folderId)
    if (!todo.length) return toast('No hay nada que mover (ya están ahí o no son tuyos)', 'info')
    const results = await Promise.allSettled(todo.map((f) => api<FileItem>(`/rooms/${room.code}/files/${f.id}`, 'PATCH', { folderId })))
    const moved = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    setFiles((all) => all.map((x) => moved.find((m) => m.id === x.id) ?? x))
    const bad = todo.length - moved.length
    toast(bad ? `Se movieron ${moved.length} y ${bad} no se pudieron mover` : `${moved.length} archivo${moved.length === 1 ? '' : 's'} movido${moved.length === 1 ? '' : 's'} a ${where(folderId)}`, bad ? 'error' : 'success')
    clearSel()
  }

  async function removeMany(list: FileItem[]) {
    const todo = list.filter((f) => canTouch(f.uploaderId))
    if (!todo.length) return
    if (!await dialogs.confirm({ title: todo.length === 1 ? `¿Borrar «${todo[0]!.name}»?` : `¿Borrar ${todo.length} archivos?`, message: 'Se eliminarán de la sala para todos. No se puede deshacer.', confirmLabel: todo.length === 1 ? 'Borrar archivo' : 'Borrar archivos', tone: 'danger' })) return
    await Promise.allSettled(todo.map((f) => api(`/rooms/${room.code}/files/${f.id}`, 'DELETE')))
    clearSel()
  }

  /** «Mover a»: la raíz y todas las carpetas con su ruta. */
  const moveTargets = (list: FileItem[]): MenuItem[] => [
    { label: 'Todos los archivos (raíz)', icon: <House size={16} />, onClick: () => void moveMany(list, null) },
    ...[...folders].map((f) => ({ f, label: where(f.id) })).sort((a, b) => a.label.localeCompare(b.label))
      .map(({ f, label }) => ({ label, icon: <FolderInput size={16} />, onClick: () => void moveMany(list, f.id) })),
  ]

  /** Crea un documento, hoja o presentación nueva: nace como archivo de la sala (en la carpeta actual) y se abre para editar. */
  async function createDoc(k: (typeof NEW_KINDS)[number]) {
    if (newBusy || !onEditDoc) return
    setNewBusy(true)
    setError('')
    try {
      onEditDoc(await api<DocInfo>(`/rooms/${room.code}/docs`, 'POST', { kind: k.kind, name: k.base, folderId: current }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear el documento')
    } finally {
      setNewBusy(false)
    }
  }

  /** Abre un archivo de oficina en el editor colaborativo (la primera vez lo convierte en el servidor). */
  async function editFile(f: FileItem) {
    if (opening || !onEditDoc) return
    setOpening(f.id)
    setError('')
    try {
      onEditDoc(await api<DocInfo>(`/rooms/${room.code}/docs/from-file/${f.id}`, 'POST'))
    } catch (e) {
      setError(`«${f.name}»: ${e instanceof ApiError ? e.message : 'no se pudo abrir para editar'}`)
    } finally {
      setOpening(null)
    }
  }

  /** La descarga solo se inicia desde el botón. Muestra el progreso sobre el icono y se puede cancelar. */
  function downloadFile(f: FileItem) {
    if (dlHandles.current.has(f.id)) return
    setError('')
    setDl((d) => ({ ...d, [f.id]: { loaded: 0, total: f.sizeBytes } }))
    const h = downloadWithProgress(`/rooms/${room.code}/files/${f.id}`, f.name, (loaded, total) =>
      setDl((d) => (d[f.id] ? { ...d, [f.id]: { loaded, total: total || f.sizeBytes } } : d)))
    dlHandles.current.set(f.id, h)
    h.promise
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(`«${f.name}»: ${e instanceof Error ? e.message : 'error al descargar'}`)
      })
      .finally(() => {
        dlHandles.current.delete(f.id)
        setDl(({ [f.id]: _gone, ...rest }) => rest)
      })
  }

  const cancelDownload = (id: string) => dlHandles.current.get(id)?.cancel()
  // Al cerrar el explorador se cancelan las descargas en curso
  useEffect(() => () => dlHandles.current.forEach((h) => h.cancel()), [])

  // ── Arrastrar y soltar ──
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const NORA_MIME = 'application/x-nora-file'

  function dropOn(e: DragEvent, folderId: string | null) {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    setDragOver(false)
    if (!canWrite) return
    const raw = e.dataTransfer.getData(NORA_MIME)
    if (raw) {
      const ids: string[] = JSON.parse(raw)
      void moveMany(files.filter((x) => ids.includes(x.id)), folderId)
      return
    }
    // Las entradas del drop solo son válidas durante el evento: se capturan antes de cualquier espera.
    const entries = entriesFromDrop(e.dataTransfer.items)
    const plain = Array.from(e.dataTransfer.files)
    if (entries.length > 0) {
      setReading(true)
      void collectFromEntries(entries).then((c) => uploadCollected(c, folderId)).catch(() => setError('No se pudo leer la carpeta soltada')).finally(() => setReading(false))
    }
    else for (const file of plain) uploads.add(room.code, file, undefined, folderId)
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
    const items: MenuItem[] = [
      ...(onEditDoc && isEditable(f.name) ? [{ label: canWrite ? 'Abrir para editar' : 'Abrir (solo lectura)', icon: <Pencil size={16} />, onClick: () => void editFile(f) }] : []),
      ...(previewKind(f.name) ? [{ label: 'Vista previa', icon: <Eye size={16} />, onClick: () => setViewing(f.id) }] : []),
      { label: 'Descargar', icon: <Download size={16} />, onClick: () => void downloadFile(f) },
    ]
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
    const [Icon, tone] = kindOf(f.name)
    const d = dl[f.id]
    const canView = !!previewKind(f.name)
    const canOpen = !!onEditDoc && isEditable(f.name)
    const open = () => (canOpen ? void editFile(f) : setViewing(f.id))
    const pct = d && d.total > 0 ? Math.min(100, Math.round((d.loaded / d.total) * 100)) : 0
    rows.push(
      <div key={`f-${f.id}`} data-sel-id={f.id} className={`fitem ${d ? 'busy' : ''} ${canView || canOpen ? 'viewable' : ''} ${sel.has(f.id) ? 'selected' : ''}`}
        {...(canView || canOpen ? { role: 'button', tabIndex: 0, 'aria-label': `${canOpen ? (canWrite ? 'Abrir para editar' : 'Abrir') : 'Ver'} ${f.name}`, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickFile(f, e, open) } } } : {})}
        onClick={(e) => clickFile(f, e, canView || canOpen ? open : () => {})}
        draggable={canTouch(f.uploaderId)}
        onDragStart={(e) => { e.dataTransfer.setData(NORA_MIME, JSON.stringify(sel.has(f.id) ? [...sel] : [f.id])); e.dataTransfer.effectAllowed = 'move' }}>
        <button type="button" className={`fcheck ${sel.has(f.id) ? 'on' : ''}`} aria-label={`${sel.has(f.id) ? 'Quitar de la selección' : 'Seleccionar'} ${f.name}`} aria-pressed={sel.has(f.id)}
          onClick={(e) => { e.stopPropagation(); toggleSel(f.id) }}>{sel.has(f.id) ? <SquareCheck size={20} /> : <Square size={20} />}</button>
        <span className={`ficon tn-${tone}`}>
          <Icon size={22} />
          {d && <ProgressRing percent={d.loaded > 0 ? pct : null} />}
        </span>
        <span className="fbody">
          <span className="fname truncate">{f.name}</span>
          <span className="fmeta truncate">
            {d
              ? d.loaded > 0
                ? `Descargando ${pct}% · ${formatBytes(d.loaded)} / ${formatBytes(d.total)}`
                : 'Preparando descarga…'
              : <>
                  {formatBytes(f.sizeBytes)} · {who(f.uploaderId)}{view === 'list' ? ` · ${when(f.createdAt)}` : ''}
                  {searching && f.folderId ? ` · ${where(f.folderId)}` : ''}
                </>}
          </span>
        </span>
        <span className="factions">
          {canView && !d && (
            <button className="icon-btn sm" title="Ver" aria-label={`Ver ${f.name}`} onClick={(e) => { e.stopPropagation(); setViewing(f.id) }}>
              <Eye size={16} />
            </button>
          )}
          {d ? (
            <button className="icon-btn sm" title="Cancelar descarga" aria-label={`Cancelar descarga de ${f.name}`} onClick={(e) => { e.stopPropagation(); cancelDownload(f.id) }}>
              <X size={16} />
            </button>
          ) : (
            <button className="icon-btn sm" title="Descargar" aria-label={`Descargar ${f.name}`} onClick={(e) => { e.stopPropagation(); downloadFile(f) }}>
              <Download size={16} />
            </button>
          )}
          <Menu items={fileMenu(f)} />
        </span>
      </div>,
    )
  }

  return (
    <div
      className={`explorer ${sel.size > 0 ? 'sel-active' : ''}`}
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => dropOn(e, current)}
    >
      <div className="ex-toolbar">
        {canWrite && (
          <>
            <button className="btn primary sm" onClick={onPick}><Upload size={15} /> Subir</button>
            <button className="btn sm" onClick={onPickFolder}><FolderUp size={15} /> Subir carpeta</button>
            <button className="btn sm" onClick={() => { setCreating((c) => !c); setFolderName('') }}><FolderPlus size={15} /> Nueva carpeta</button>
            {onEditDoc && (
              <Menu label="Crear documento" trigger={<span className="btn sm">{newBusy ? <Loader2 size={15} className="spin-icon" /> : <FilePlus2 size={15} />} Nuevo <ChevronDown size={14} /></span>}
                items={NEW_KINDS.map((k) => ({ label: k.label, icon: <k.icon size={16} />, onClick: () => void createDoc(k) }))} />
            )}
          </>
        )}
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

      {sel.size > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="Archivos seleccionados">
          <button type="button" className="icon-btn sm" aria-label="Quitar la selección" title="Quitar la selección (Esc)" onClick={clearSel}><X size={16} /></button>
          <strong>{sel.size} seleccionado{sel.size === 1 ? '' : 's'}</strong>
          <button type="button" className="btn ghost sm" onClick={() => setSel(sel.size === shownFiles.length ? new Set() : new Set(shownFiles.map((f) => f.id)))}>{sel.size === shownFiles.length ? 'Quitar todos' : 'Seleccionar todos'}</button>
          <span className="grow" />
          <button type="button" className="btn sm" onClick={() => selectedFiles.forEach(downloadFile)}><Download size={15} /> Descargar</button>
          {touchable.length > 0 && (
            <>
              <Menu label="Mover los seleccionados a" items={[{ heading: `Mover ${touchable.length} a` }, ...moveTargets(touchable)]}
                trigger={<span className="btn sm"><FolderInput size={15} /> Mover a… <ChevronDown size={14} /></span>} />
              <button type="button" className="btn sm danger" onClick={() => void removeMany(touchable)}><Trash2 size={15} /> Borrar</button>
            </>
          )}
        </div>
      )}

      <div ref={bodyRef} className={`ex-body ${dragOver ? 'dragging' : ''}`} onClick={(e) => { if (!justDragged.current && sel.size > 0 && !(e.target as Element).closest('[data-sel-id], button, a, .fitem, .menu, input, select')) clearSel() }}>
        {!canWrite && <p className="callout small" style={{ marginBottom: 10 }}>Tu rol en esta sala es de <strong>lector</strong>: puedes ver y descargar, pero no subir ni modificar.</p>}
        {error && <p className="error small" role="alert">{error}</p>}
        {(zipping || reading) && (
          <div className="prep-note" role="status">
            <Loader2 size={20} className="spin-icon" />
            <span>
              <strong>{zipping ? 'Comprimiendo lo que elegiste…' : 'Leyendo la carpeta…'}</strong>
              <small>{zipping
                ? 'Tu navegador está preparando el archivo antes de entregarlo a Nora. Las carpetas y los paquetes (.app, .pages, .key…) y los archivos muy grandes se comprimen en un .zip, y se subirán como .zip. Puede tardar unos segundos; la subida empieza sola al terminar.'
                : 'Estoy recorriendo sus archivos y subcarpetas para subirlos. Con carpetas grandes puede tardar un poco.'}</small>
            </span>
          </div>
        )}

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

        {box && <div className="marquee" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
        {empty ? (
          <div className="empty">
            {searching ? <Search size={36} /> : <Folder size={36} />}
            <strong>{searching ? 'Sin resultados' : current ? 'Esta carpeta está vacía' : 'No hay archivos en esta sala'}</strong>
            <span className="small">
              {searching ? 'Prueba con otro nombre.' : canWrite ? 'Pulsa «Subir» o arrastra archivos y carpetas aquí.' : 'Todavía no hay nada que ver.'}
              {!searching && canWrite && ` Máx. por archivo: ${formatBytes(user?.limits.maxFileSizeBytes)}.`}
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
        <span className="hide-sm">Subida reanudable · arrastra con el ratón para seleccionar varios · arrástralos a una carpeta para moverlos</span>
      </div>

      {viewIndex >= 0 && (
        <FileViewer code={room.code} files={viewable} index={viewIndex} onIndex={(i) => setViewing(viewable[i]!.id)}
          onClose={() => setViewing(null)} onDownload={(f) => { const item = files.find((x) => x.id === f.id); if (item) downloadFile(item) }} />
      )}

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

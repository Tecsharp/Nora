import { useCallback, useEffect, useRef, useState, useSyncExternalStore, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Check, ChevronDown, ChevronUp, Copy, Download, FileText, History, Fullscreen, Loader2, Maximize2, Minimize2, PenTool, Presentation, Save, Sheet, Upload, X } from 'lucide-react'
import { ApiError, api, getAccessToken } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu, { type MenuItem } from '../components/Menu'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { useDialogs } from '../dialogs'
import { useFullscreen } from '../fullscreen'
import { CollabProvider, colorFor } from './provider'
import type { BoardHandle } from './boardIO'
import { readNativeForExport, restoreNonText, restoreText, seedNonText, type Kind, type Native } from './native'

const TextEditor = lazy(() => import('./TextEditor'))
const SheetEditor = lazy(() => import('./SheetEditor'))
const SlidesEditor = lazy(() => import('./SlidesEditor'))
const BoardEditor = lazy(() => import('./BoardEditor'))

export interface DocInfo {
  id: string
  kind: Kind
  name: string
  sourceFileId: string | null
  sourceExt: string | null
  canEdit: boolean
  savedSeq?: number
  savedAt?: string | null
  savedByName?: string | null
  thumbAt?: string | null
  folderId?: string | null
}

interface Props {
  code: string
  doc: DocInfo
  canWrite: boolean
  onClose: () => void
  onSaved?: () => void
}

const FORMATS: Record<Kind, { id: string; label: string }[]> = {
  DOC: [{ id: 'docx', label: 'Word (.docx)' }, { id: 'odt', label: 'OpenDocument (.odt)' }, { id: 'pdf', label: 'PDF (.pdf)' }],
  SHEET: [{ id: 'xlsx', label: 'Excel (.xlsx)' }, { id: 'ods', label: 'OpenDocument (.ods)' }, { id: 'csv', label: 'CSV (primera hoja)' }, { id: 'pdf', label: 'PDF (.pdf)' }],
  SLIDES: [{ id: 'pptx', label: 'PowerPoint (.pptx)' }, { id: 'odp', label: 'OpenDocument (.odp)' }, { id: 'pdf', label: 'PDF (.pdf)' }],
  BOARD: [{ id: 'excalidraw', label: 'Pizarra (.excalidraw)' }, { id: 'png', label: 'Imagen PNG (.png)' }, { id: 'svg', label: 'Imagen vectorial (.svg)' }, { id: 'pdf', label: 'PDF (.pdf)' }],
}
const ICON = { DOC: FileText, SHEET: Sheet, SLIDES: Presentation, BOARD: PenTool }

interface Version { id: string; createdAt: string; createdByName: string; label: string | null; seq: number }

/** Editor colaborativo a pantalla completa: documento de texto, hoja de cálculo o presentación. */
export default function DocEditor(props: Props) {
  const { user } = useAuth()
  const uid = user!.id
  const uname = user!.displayName
  const [provider, setProvider] = useState<CollabProvider | null>(null)
  // El proveedor se crea y se destruye en un efecto (así sobrevive al doble montaje de React en desarrollo)
  useEffect(() => {
    const p = new CollabProvider(props.code, props.doc.id, { id: uid, name: uname, color: colorFor(uid) })
    setProvider(p)
    return () => {
      p.destroy()
      setProvider(null)
    }
  }, [props.code, props.doc.id, uid, uname])
  return provider ? <EditorShell {...props} provider={provider} /> : null
}

function EditorShell({ code, doc, canWrite, onClose, onSaved, provider }: Props & { provider: CollabProvider }) {
  const toast = useToast()
  const fullscreen = useFullscreen()
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem('nora-editor-wide') === '1'
    } catch {
      return false
    }
  })
  const [hideBar, setHideBar] = useState(() => {
    try {
      return localStorage.getItem('nora-editor-bar') === 'hidden'
    } catch {
      return false
    }
  })
  const setBar = (hidden: boolean) => {
    setHideBar(hidden)
    try {
      localStorage.setItem('nora-editor-bar', hidden ? 'hidden' : 'shown')
    } catch { /* sin almacenamiento */ }
  }
  const roomy = wide || fullscreen.active
  const barHidden = roomy && hideBar // la barra solo se oculta con la ventana ampliada o en pantalla completa
  const toggleWide = () => setWide((w) => {
    try {
      localStorage.setItem('nora-editor-wide', w ? '0' : '1')
    } catch { /* sin almacenamiento */ }
    return !w
  })

  const snap = useSyncExternalStore(
    useCallback((l) => provider.subscribe(l), [provider]),
    () => `${provider.state}|${provider.canEdit}|${provider.seedState}|${provider.unsaved}|${provider.error}`,
  )
  const [state, , seedState, unsaved, error] = snap.split('|')
  const editable = provider.canEdit && canWrite
  const [editor, setEditor] = useState<Editor | null>(null)
  const [name, setName] = useState(doc.name)
  const [busy, setBusy] = useState('')
  const [history, setHistory] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [saved, setSaved] = useState({ seq: doc.savedSeq ?? 0, at: doc.savedAt ?? null, by: doc.savedByName ?? null })
  const [closing, setClosing] = useState(false)
  useRealtime('doc.saved', (d: DocInfo) => {
    if (d.id === doc.id) setSaved({ seq: d.savedSeq ?? 0, at: d.savedAt ?? null, by: d.savedByName ?? null })
  })
  useRealtime('doc.renamed', (d: DocInfo) => {
    if (d.id === doc.id) { doc.name = d.name; setName(d.name) }
  })
  // Una vez abierto, el editor no se desmonta por reconexiones o recargas del estado
  const [everReady, setEverReady] = useState(false)
  useEffect(() => {
    if (state === 'ready') setEverReady(true)
  }, [state])
  const [peers, setPeers] = useState<{ id: string; name: string; color: string }[]>([])
  const [board, setBoard] = useState<BoardHandle | null>(null)
  const [importing, setImporting] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { user: me } = useAuth()
  // Si el propietario cambia mi rol, se vuelve a comprobar el permiso sin cerrar el documento
  useRealtime('member.updated', (d: { userId: string }) => d.userId === me?.id && provider.refreshAccess())

  useEffect(() => {
    provider.onDeleted = () => setDeleted(true)
    const read = () => {
      const seen = new Map<string, { id: string; name: string; color: string }>()
      provider.peers().forEach((p) => seen.set(p.user.id, p.user))
      const next = [...seen.values()]
      setPeers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)) // los cursores de la pizarra cambian la presencia muy a menudo
    }
    provider.awareness.on('change', read)
    read()
    return () => provider.awareness.off('change', read)
  }, [provider])

  // ---- siembra del contenido importado: solo la hace un cliente ----
  useEffect(() => {
    if (state !== 'ready' || seedState === 'DONE') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const attempt = async () => {
      if (cancelled) return
      try {
        if (provider.canEdit && (doc.kind !== 'DOC' || editor)) {
          const content = await provider.claimSeed()
          if (content !== null && !cancelled) {
            const native = JSON.parse(content || '{}') as Native
            if (doc.kind === 'DOC') editor!.commands.setContent((native as { html?: string }).html ?? '', true)
            else seedNonText(doc.kind, native, provider.doc)
            await provider.finishSeed()
            return
          }
        }
        await provider.loadState() // otra persona está sembrando: se espera a que termine
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) console.warn('Siembra:', e)
      }
      if (!cancelled) timer = setTimeout(attempt, 2000)
    }
    void attempt()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [provider, state, seedState, editor, doc.kind])

  // ---- nombre ----
  async function rename(next: string) {
    const n = next.trim()
    if (!n || n === doc.name) return setName(doc.name)
    try {
      await api(`/rooms/${code}/docs/${doc.id}`, 'PATCH', { name: n })
      doc.name = n
    } catch (e) {
      setName(doc.name)
      toast(e instanceof ApiError ? e.message : 'No se pudo renombrar', 'error')
    }
  }

  // ---- guardar / descargar ----
  const nativeNow = (): Promise<Native> => readNativeForExport(doc.kind, provider.doc, () => editor?.getHTML() ?? '')

  async function post(format: string | null, save: 'none' | 'new' | 'file') {
    await provider.flushed()
    const seq = provider.seq
    const q = new URLSearchParams({ save, seq: String(seq) })
    if (format) q.set('format', format)
    return { seq, res: await fetch(`/api/rooms/${code}/docs/${doc.id}/export?${q}`, {
      method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(await nativeNow()),
    }) }
  }

  /** Guardar = escribir el contenido actual en el archivo de la sala (el mismo que se ve en Archivos). */
  const saving = useRef(false)
  /**
   * manual: botón Guardar (aviso y versión) · close: al cerrar una pizarra (espera, sin aviso) · auto: autoguardado de la
   * pizarra en segundo plano (no se ve ni bloquea nada).
   */
  async function saveToFile(mode: 'manual' | 'close' | 'auto' = 'manual'): Promise<boolean> {
    if (!editable || saving.current || (mode !== 'auto' && busy)) return false
    saving.current = true
    if (mode !== 'auto') setBusy('Guardando…')
    try {
      const { res } = await post(null, 'file')
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      const f = (await res.json()) as { name: string }
      if (mode === 'manual') {
        toast(`Guardado en «${f.name}»`, 'success')
        void provider.saveVersion('Guardado en el archivo').catch(() => {})
      }
      onSaved?.()
      if (mode !== 'close') uploadThumb(mode === 'auto')
      return true
    } catch (e) {
      if (mode !== 'auto') toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
      return false
    } finally {
      saving.current = false
      if (mode !== 'auto') setBusy('')
    }
  }

  // La pizarra se guarda sola en su archivo tras cada cambio (la persona «líder» lo hace, así no escriben todos a la vez)
  const autosave = doc.kind === 'BOARD' && editable
  const savedRef = useRef(saved)
  savedRef.current = saved
  useEffect(() => {
    if (!autosave) return
    let lastSeq = provider.seq
    let lastChange = Date.now()
    let lastWrite = 0
    const t = setInterval(() => {
      if (provider.seq !== lastSeq) {
        lastSeq = provider.seq
        lastChange = Date.now()
      }
      if (provider.seq <= savedRef.current.seq || provider.state !== 'ready' || provider.seedState !== 'DONE' || !provider.isLeader()) return
      const now = Date.now()
      if (now - lastChange < 1000 && now - lastWrite < 10_000) return // se espera a que pare un momento, pero como mucho 10 s seguidos sin guardar
      lastWrite = now
      void saveRef.current('auto')
    }, 500)
    return () => clearInterval(t)
  }, [autosave, provider])

  /** Miniatura de la pizarra para la galería: se sube al guardar y al cerrar (empieza a dibujarse antes de que el editor desaparezca). */
  const lastThumb = useRef(0)
  function uploadThumb(throttle = false) {
    if (doc.kind !== 'BOARD' || !board || !editable) return
    if (throttle && Date.now() - lastThumb.current < 30_000) return
    lastThumb.current = Date.now()
    void board.thumbnail().then((blob) => blob && fetch(`/api/rooms/${code}/docs/${doc.id}/thumbnail`, {
      method: 'PUT', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, 'Content-Type': blob.type || 'image/jpeg' }, body: blob,
    })).catch(() => {})
  }
  const closeNow = () => {
    uploadThumb()
    onClose()
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function uploadToRoom(blob: Blob, filename: string) {
    const fd = new FormData()
    fd.append('file', new File([blob], filename, { type: blob.type }))
    const r = await fetch(`/api/rooms/${code}/files`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: fd })
    if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => null))?.message ?? `Error ${r.status}`)
    return (await r.json()) as { name: string }
  }

  async function exportAs(format: string, save: 'none' | 'new') {
    setBusy(save === 'none' ? 'Preparando descarga…' : 'Guardando copia…')
    try {
      if (doc.kind === 'BOARD' && format !== 'excalidraw') {
        // las imágenes de la pizarra se dibujan en el navegador (con su escena incrustada en PNG y SVG para poder volver a importarlas)
        if (!board) throw new Error('La pizarra aún se está cargando')
        const blob = await board.exportBlob(format as 'png' | 'svg' | 'pdf')
        if (save === 'none') download(blob, `${doc.name}.${format}`)
        else {
          const f = await uploadToRoom(blob, `${doc.name}.${format}`)
          toast(`Copia guardada como «${f.name}» en Archivos`, 'success')
          onSaved?.()
        }
        return
      }
      const { res } = await post(format, save)
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      if (save === 'none') {
        download(await res.blob(), `${doc.name}.${format}`)
      } else {
        const f = (await res.json()) as { name: string }
        toast(`Copia guardada como «${f.name}» en Archivos`, 'success')
        onSaved?.()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error')
    } finally {
      setBusy('')
    }
  }

  async function runImport(mode: 'merge' | 'replace') {
    const f = importing
    setImporting(null)
    if (!f || !board) return
    setBusy('Importando…')
    try {
      const n = await board.importFile(f, mode)
      toast(n ? `Importado: ${n} elemento${n === 1 ? '' : 's'}` : 'Importado', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar', 'error')
    } finally {
      setBusy('')
    }
  }

  const downloadItems = (): MenuItem[] => [{ heading: 'Descargar al equipo como…' }, ...FORMATS[doc.kind].map((f) => ({ label: f.label, icon: <Download size={16} />, onClick: () => void exportAs(f.id, 'none') }))]
  const moreItems = (): MenuItem[] => [
    ...(doc.kind === 'BOARD' ? [{ heading: 'Importar' } as MenuItem, { label: 'Importar archivo (.excalidraw, imagen)…', icon: <Upload size={16} />, onClick: () => fileInput.current?.click() } as MenuItem, 'separator' as MenuItem] : []),
    { heading: 'Guardar una copia en la sala como…' },
    ...FORMATS[doc.kind].map((f) => ({ label: f.label, icon: <Copy size={16} />, onClick: () => void exportAs(f.id, 'new') })),
  ]

  // Ctrl/Cmd+S guarda en el archivo
  const saveRef = useRef<typeof saveToFile>(saveToFile)
  saveRef.current = saveToFile
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current('manual')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Al cerrar: si el archivo no tiene lo último y nadie más está dentro, se ofrece guardar
  async function requestClose() {
    const dirty = provider.seq > saved.seq
    if (autosave && !deleted) {
      // la pizarra se guarda sola: al cerrar se termina de guardar y no hay nada que descartar (solo si no se puede guardar se avisa)
      if (dirty && !(await saveToFile('close'))) setClosing(true)
      else closeNow()
      return
    }
    if (editable && dirty && peers.length <= 1 && !deleted) setClosing(true)
    else closeNow()
  }

  const Icon = ICON[doc.kind]
  const status = state === 'offline' || state === 'connecting' ? 'Sin conexión: se reanudará solo' : unsaved === 'true' ? 'Sincronizando…' : state === 'syncing' ? 'Sincronizando…' : 'Sincronizado'

  return createPortal(
    <div className={`modal-backdrop docapp-backdrop ${wide ? 'wide' : ''}`}>
      <div className="docapp" role="dialog" aria-modal="true" aria-label={`Editor: ${name}`}>
        <header className={`docapp-head ${barHidden ? 'collapsed' : ''}`}>
          <span className="docapp-ico"><Icon size={20} /></span>
          <input className="docapp-name" value={name} aria-label="Nombre del documento" readOnly={!editable} maxLength={120}
            onChange={(e) => setName(e.target.value)} onBlur={(e) => void rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <span className={`sync ${unsaved === 'true' || state !== 'ready' ? 'busy' : 'ok'}`} role="status" title="Los cambios se comparten con todos en tiempo real">{status}</span>
          <FileState provider={provider} saved={saved} auto={autosave} name={`${doc.name}${doc.sourceExt ? `.${doc.sourceExt}` : ''}`} />
          <span className="grow" />
          <div className="docapp-peers" aria-label="Personas en el documento">
            {peers.slice(0, 6).map((p) => <span key={p.id} title={p.name} className="peer-av" style={{ ['--pc' as string]: p.color }}><Avatar name={p.name} /></span>)}
            {peers.length > 6 && <span className="muted small">+{peers.length - 6}</span>}
          </div>
          {!editable && <span className="badge">Solo lectura</span>}
          <button className="btn sm" onClick={() => setHistory((h) => !h)} aria-pressed={history}><History size={15} /> Historial</button>
          <Menu label="Descargar" items={downloadItems()} trigger={<span className="btn sm"><Download size={15} /> Descargar <ChevronDown size={14} /></span>} />
          {editable && (
            <>
              <button className="btn sm primary" onClick={() => void saveToFile('manual')} disabled={!!busy} title="Guardar en el archivo de la sala (Ctrl+S)">
                {busy === 'Guardando…' ? <Loader2 size={15} className="spin-icon" /> : <Save size={15} />} Guardar
              </button>
              <Menu label="Más opciones de guardado" items={moreItems()} />
            </>
          )}
          <input ref={fileInput} type="file" hidden accept=".excalidraw,.json,application/json,image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label="Importar archivo"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setImporting(f) }} />
          <button className="icon-btn" aria-label={wide ? 'Volver al tamaño normal' : 'Ocupar toda la ventana'} title={wide ? 'Volver al tamaño normal' : 'Ocupar toda la ventana'} aria-pressed={wide} onClick={toggleWide}>
            {wide ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
          </button>
          {roomy && <button className="icon-btn" aria-label="Ocultar la barra superior" title="Ocultar la barra superior (más espacio)" onClick={() => setBar(true)}><ChevronUp size={19} /></button>}
          {fullscreen.supported && (
            <button className="icon-btn" aria-label={fullscreen.active ? 'Salir de pantalla completa' : 'Pantalla completa'} title={fullscreen.active ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa de la pantalla'} aria-pressed={fullscreen.active}
              onClick={() => void fullscreen.toggle().catch(() => toast('Tu navegador no permitió la pantalla completa', 'error'))}>
              <Fullscreen size={19} />
            </button>
          )}
          <button className="icon-btn" aria-label="Cerrar el editor" onClick={requestClose}><X size={20} /></button>
        </header>

        {barHidden && doc.kind !== 'BOARD' && <button className="docapp-handle" aria-label="Mostrar la barra superior" title="Mostrar la barra superior" onClick={() => setBar(false)}><ChevronDown size={16} /></button>}
        <div className="docapp-body">
          <div className="docapp-main">
            {deleted ? (
              <div className="empty"><strong>El documento se ha eliminado</strong><button className="btn" onClick={onClose}>Cerrar</button></div>
            ) : !everReady && state === 'offline' && error ? (
              <div className="empty"><strong>No se pudo abrir</strong><span className="small">{error}</span><button className="btn" onClick={onClose}>Cerrar</button></div>
            ) : (
              <Suspense fallback={<div className="empty"><Loader2 className="spin-icon" /></div>}>
                {everReady && (
                  doc.kind === 'DOC' ? <TextEditor provider={provider} editable={editable} onEditor={setEditor} />
                  : doc.kind === 'SHEET' ? <SheetEditor provider={provider} editable={editable} />
                  : doc.kind === 'BOARD' ? <BoardEditor provider={provider} editable={editable} onHandle={setBoard} onImportRequest={() => fileInput.current?.click()} onSaveCopy={() => void exportAs('excalidraw', 'new')} onShowBar={barHidden ? () => setBar(false) : undefined} roomCode={code} />
                  : <SlidesEditor provider={provider} editable={editable} />
                )}
              </Suspense>
            )}
            {everReady && seedState !== 'DONE' && (
              <div className="seed-overlay"><Loader2 className="spin-icon" size={28} /><strong>Preparando el documento…</strong><span className="small muted">Se está importando el contenido del archivo.</span></div>
            )}
            {busy && <div className="seed-overlay"><Loader2 className="spin-icon" size={28} /><strong>{busy}</strong></div>}
          </div>
          {importing && board && (
            <div className="seed-overlay" role="alertdialog" aria-label="Importar archivo">
              <strong>Importar «{importing.name}»</strong>
              <span className="small muted">¿Añadirlo a lo que ya hay en la pizarra o sustituir todo? Podrás deshacerlo.</span>
              <div className="row">
                <button className="btn primary" autoFocus onClick={() => void runImport('merge')}>Añadir a la pizarra</button>
                <button className="btn" onClick={() => void runImport('replace')}>Reemplazar todo</button>
                <button className="btn ghost" onClick={() => setImporting(null)}>Cancelar</button>
              </div>
            </div>
          )}
          {closing && (
            <div className="seed-overlay" role="alertdialog" aria-label="Cambios sin guardar">
              <strong>Hay cambios que todavía no están en el archivo</strong>
              <span className="small muted">«{doc.name}{doc.sourceExt ? `.${doc.sourceExt}` : ''}» no incluye lo último que se escribió. Si cierras sin guardar, el documento compartido conserva los cambios, pero el archivo de Archivos seguirá como estaba.</span>
              <div className="row">
                <button className="btn primary" autoFocus onClick={async () => { setClosing(false); if (await saveToFile('close')) closeNow() }}>Guardar y cerrar</button>
                <button className="btn" onClick={closeNow}>Cerrar sin guardar</button>
                <button className="btn ghost" onClick={() => setClosing(false)}>Seguir editando</button>
              </div>
            </div>
          )}
          {history && <HistoryPanel code={code} doc={doc} provider={provider} editable={editable} editor={editor} onClose={() => setHistory(false)} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Estado del archivo de la sala respecto al documento: guardado (y cuándo) o con cambios pendientes. */
function FileState({ provider, saved, name, auto }: { provider: CollabProvider; saved: { seq: number; at: string | null; by: string | null }; name: string; auto?: boolean }) {
  const seq = useSyncExternalStore(useCallback((l) => provider.subscribe(l), [provider]), () => provider.seq)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const dirty = seq > saved.seq
  return dirty && auto ? (
    <span className="filestate" title={`«${name}» se guarda solo en cuanto haces una pausa`}><Loader2 size={12} className="spin-icon" /> Guardando en el archivo…</span>
  ) : dirty ? (
    <span className="filestate dirty" title={`Los cambios están compartidos, pero «${name}» en Archivos aún no los incluye. Pulsa Guardar.`}>● Sin guardar en el archivo</span>
  ) : (
    <span className="filestate" title={`«${name}» en Archivos está al día`}><Check size={13} /> Archivo guardado{saved.at ? ` ${ago(saved.at)}` : ''}{saved.by ? ` · ${saved.by}` : ''}</span>
  )
}

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'ahora'
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return new Date(iso).toLocaleDateString()
}

function HistoryPanel({ code, doc, provider, editable, onClose }: { code: string; doc: DocInfo; provider: CollabProvider; editable: boolean; editor: Editor | null; onClose: () => void }) {
  const toast = useToast()
  const dialogs = useDialogs()
  const [versions, setVersions] = useState<Version[] | null>(null)
  const load = useCallback(() => api<Version[]>(`/rooms/${code}/docs/${doc.id}/versions`).then(setVersions).catch(() => setVersions([])), [code, doc.id])
  useEffect(() => void load(), [load])

  async function save() {
    const label = await dialogs.prompt({ title: 'Guardar versión', message: 'Podrás volver a ella desde el historial.', label: 'Nombre de la versión (opcional)', allowEmpty: true, confirmLabel: 'Guardar versión', maxLength: 80 })
    if (label === null) return
    try {
      await provider.saveVersion(label.trim() || null)
      toast('Versión guardada', 'success')
      void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    }
  }

  async function restore(v: Version) {
    if (!await dialogs.confirm({ title: '¿Restaurar esta versión?', message: 'El contenido actual se sustituye. Antes se guarda una copia, y puedes deshacerlo.', confirmLabel: 'Restaurar', tone: 'warning' })) return
    try {
      await provider.saveVersion('Antes de restaurar')
      const res = await fetch(`/api/rooms/${code}/docs/${doc.id}/versions/${v.id}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } })
      if (!res.ok) throw new Error('No se pudo descargar la versión')
      const snapshot = new Uint8Array(await res.arrayBuffer())
      if (!restoreNonText(doc.kind, provider.doc, snapshot)) restoreText(provider.doc, snapshot)
      toast('Versión restaurada', 'success')
      void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo restaurar', 'error')
    }
  }

  return (
    <aside className="history" aria-label="Historial de versiones">
      <div className="row spread"><strong>Historial</strong><button className="icon-btn sm" aria-label="Cerrar historial" onClick={onClose}><X size={16} /></button></div>
      {editable && <button className="btn sm" onClick={save}><Save size={14} /> Guardar versión ahora</button>}
      <p className="muted small">También se guardan versiones automáticas mientras se edita (las últimas 40).</p>
      {versions === null ? <p className="muted small">Cargando…</p> : versions.length === 0 ? <p className="muted small">Todavía no hay versiones.</p> : (
        <ul className="list">
          {versions.map((v) => (
            <li key={v.id} className="version">
              <div className="grow" style={{ minWidth: 0 }}>
                <strong className="small truncate" style={{ display: 'block' }}>{v.label ?? 'Versión automática'}</strong>
                <span className="muted small">{new Date(v.createdAt).toLocaleString()} · {v.createdByName}</span>
              </div>
              {editable && <button className="btn sm" onClick={() => void restore(v)}>Restaurar</button>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

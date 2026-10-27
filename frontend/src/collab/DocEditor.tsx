import { useCallback, useEffect, useRef, useState, useSyncExternalStore, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Check, ChevronDown, Copy, Download, FileText, History, Loader2, Presentation, Save, Sheet, X } from 'lucide-react'
import { ApiError, api, getAccessToken } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu, { type MenuItem } from '../components/Menu'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { CollabProvider, colorFor } from './provider'
import { readNativeForExport, restoreNonText, restoreText, seedNonText, type Kind, type Native } from './native'

const TextEditor = lazy(() => import('./TextEditor'))
const SheetEditor = lazy(() => import('./SheetEditor'))
const SlidesEditor = lazy(() => import('./SlidesEditor'))

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
}
const ICON = { DOC: FileText, SHEET: Sheet, SLIDES: Presentation }

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
  const { user: me } = useAuth()
  // Si el propietario cambia mi rol, se vuelve a comprobar el permiso sin cerrar el documento
  useRealtime('member.updated', (d: { userId: string }) => d.userId === me?.id && provider.refreshAccess())

  useEffect(() => {
    provider.onDeleted = () => setDeleted(true)
    const read = () => {
      const seen = new Map<string, { id: string; name: string; color: string }>()
      provider.peers().forEach((p) => seen.set(p.user.id, p.user))
      setPeers([...seen.values()])
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
  async function saveToFile(): Promise<boolean> {
    if (!editable || busy) return false
    setBusy('Guardando…')
    try {
      const { res } = await post(null, 'file')
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      const f = (await res.json()) as { name: string }
      toast(`Guardado en «${f.name}»`, 'success')
      onSaved?.()
      void provider.saveVersion('Guardado en el archivo').catch(() => {})
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
      return false
    } finally {
      setBusy('')
    }
  }

  async function exportAs(format: string, save: 'none' | 'new') {
    setBusy(save === 'none' ? 'Preparando descarga…' : 'Guardando copia…')
    try {
      const { res } = await post(format, save)
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      if (save === 'none') {
        const url = URL.createObjectURL(await res.blob())
        const a = document.createElement('a')
        a.href = url
        a.download = `${doc.name}.${format}`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
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

  const downloadItems = (): MenuItem[] => [{ heading: 'Descargar al equipo como…' }, ...FORMATS[doc.kind].map((f) => ({ label: f.label, icon: <Download size={16} />, onClick: () => void exportAs(f.id, 'none') }))]
  const moreItems = (): MenuItem[] => [
    { heading: 'Guardar una copia en la sala como…' },
    ...FORMATS[doc.kind].map((f) => ({ label: f.label, icon: <Copy size={16} />, onClick: () => void exportAs(f.id, 'new') })),
  ]

  // Ctrl/Cmd+S guarda en el archivo
  const saveRef = useRef(saveToFile)
  saveRef.current = saveToFile
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Al cerrar: si el archivo no tiene lo último y nadie más está dentro, se ofrece guardar
  function requestClose() {
    const dirty = provider.seq > saved.seq
    if (editable && dirty && peers.length <= 1 && !deleted) setClosing(true)
    else onClose()
  }

  const Icon = ICON[doc.kind]
  const status = state === 'offline' || state === 'connecting' ? 'Sin conexión: se reanudará solo' : unsaved === 'true' ? 'Sincronizando…' : state === 'syncing' ? 'Sincronizando…' : 'Sincronizado'

  return createPortal(
    <div className="modal-backdrop docapp-backdrop">
      <div className="docapp" role="dialog" aria-modal="true" aria-label={`Editor: ${name}`}>
        <header className="docapp-head">
          <span className="docapp-ico"><Icon size={20} /></span>
          <input className="docapp-name" value={name} aria-label="Nombre del documento" readOnly={!editable} maxLength={120}
            onChange={(e) => setName(e.target.value)} onBlur={(e) => void rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <span className={`sync ${unsaved === 'true' || state !== 'ready' ? 'busy' : 'ok'}`} role="status" title="Los cambios se comparten con todos en tiempo real">{status}</span>
          <FileState provider={provider} saved={saved} name={`${doc.name}${doc.sourceExt ? `.${doc.sourceExt}` : ''}`} />
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
              <button className="btn sm primary" onClick={() => void saveToFile()} disabled={!!busy} title="Guardar en el archivo de la sala (Ctrl+S)">
                {busy === 'Guardando…' ? <Loader2 size={15} className="spin-icon" /> : <Save size={15} />} Guardar
              </button>
              <Menu label="Más opciones de guardado" items={moreItems()} />
            </>
          )}
          <button className="icon-btn" aria-label="Cerrar el editor" onClick={requestClose}><X size={20} /></button>
        </header>

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
                  : <SlidesEditor provider={provider} editable={editable} />
                )}
              </Suspense>
            )}
            {everReady && seedState !== 'DONE' && (
              <div className="seed-overlay"><Loader2 className="spin-icon" size={28} /><strong>Preparando el documento…</strong><span className="small muted">Se está importando el contenido del archivo.</span></div>
            )}
            {busy && <div className="seed-overlay"><Loader2 className="spin-icon" size={28} /><strong>{busy}</strong></div>}
          </div>
          {closing && (
            <div className="seed-overlay" role="alertdialog" aria-label="Cambios sin guardar">
              <strong>Hay cambios que todavía no están en el archivo</strong>
              <span className="small muted">«{doc.name}{doc.sourceExt ? `.${doc.sourceExt}` : ''}» no incluye lo último que se escribió. Si cierras sin guardar, el documento compartido conserva los cambios, pero el archivo de Archivos seguirá como estaba.</span>
              <div className="row">
                <button className="btn primary" autoFocus onClick={async () => { setClosing(false); if (await saveToFile()) onClose() }}>Guardar y cerrar</button>
                <button className="btn" onClick={onClose}>Cerrar sin guardar</button>
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
function FileState({ provider, saved, name }: { provider: CollabProvider; saved: { seq: number; at: string | null; by: string | null }; name: string }) {
  const seq = useSyncExternalStore(useCallback((l) => provider.subscribe(l), [provider]), () => provider.seq)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const dirty = seq > saved.seq
  return dirty ? (
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
  const [versions, setVersions] = useState<Version[] | null>(null)
  const load = useCallback(() => api<Version[]>(`/rooms/${code}/docs/${doc.id}/versions`).then(setVersions).catch(() => setVersions([])), [code, doc.id])
  useEffect(() => void load(), [load])

  async function save() {
    const label = window.prompt('Nombre de la versión (opcional)', '')
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
    if (!confirm('¿Restaurar esta versión? El contenido actual se sustituye (antes se guarda una copia, y puedes deshacerlo).')) return
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

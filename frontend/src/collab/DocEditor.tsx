import { useCallback, useEffect, useState, useSyncExternalStore, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { ChevronDown, Download, FileText, History, Loader2, Presentation, Save, Sheet, X } from 'lucide-react'
import { ApiError, api, getAccessToken } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu, { type MenuItem } from '../components/Menu'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { CollabProvider, colorFor } from './provider'
import { readNative, restoreNonText, restoreText, seedNonText, type Kind, type Native } from './native'

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

  // ---- exportar / guardar ----
  const nativeNow = (): Native => readNative(doc.kind, provider.doc, () => editor?.getHTML() ?? '')

  async function exportAs(format: string, save: 'none' | 'new' | 'overwrite') {
    setBusy(save === 'none' ? 'Preparando descarga…' : 'Guardando en la sala…')
    try {
      const res = await fetch(`/api/rooms/${code}/docs/${doc.id}/export?format=${format}&save=${save}`, {
        method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(nativeNow()),
      })
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
        toast(save === 'overwrite' ? `«${f.name}» actualizado en la sala` : `Guardado como «${f.name}» en Archivos`, 'success')
        onSaved?.()
        void provider.saveVersion(save === 'overwrite' ? 'Guardado en el archivo' : null).catch(() => {})
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error')
    } finally {
      setBusy('')
    }
  }

  const saveItems = (): MenuItem[] => {
    const items: MenuItem[] = []
    if (editable && doc.sourceFileId && doc.sourceExt && FORMATS[doc.kind].some((f) => f.id === doc.sourceExt)) {
      items.push({ heading: 'Archivo original' }, { label: `Guardar cambios en «${doc.name}.${doc.sourceExt}»`, icon: <Save size={16} />, onClick: () => void exportAs(doc.sourceExt!, 'overwrite') })
    }
    if (editable) {
      items.push({ heading: 'Guardar en la sala como archivo nuevo' }, ...FORMATS[doc.kind].filter((f) => f.id !== 'pdf' || true).map((f) => ({ label: f.label, icon: <Save size={16} />, onClick: () => void exportAs(f.id, 'new') })))
    }
    items.push({ heading: 'Descargar al equipo' }, ...FORMATS[doc.kind].map((f) => ({ label: f.label, icon: <Download size={16} />, onClick: () => void exportAs(f.id, 'none') })))
    return items
  }

  const Icon = ICON[doc.kind]
  const status = state === 'offline' || state === 'connecting' ? 'Sin conexión: se reanudará solo' : unsaved === 'true' ? 'Guardando…' : state === 'syncing' ? 'Sincronizando…' : 'Todos los cambios guardados'

  return createPortal(
    <div className="modal-backdrop docapp-backdrop">
      <div className="docapp" role="dialog" aria-modal="true" aria-label={`Editor: ${name}`}>
        <header className="docapp-head">
          <span className="docapp-ico"><Icon size={20} /></span>
          <input className="docapp-name" value={name} aria-label="Nombre del documento" readOnly={!editable} maxLength={120}
            onChange={(e) => setName(e.target.value)} onBlur={(e) => void rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <span className={`sync ${unsaved === 'true' || state !== 'ready' ? 'busy' : 'ok'}`} role="status">{status}</span>
          <span className="grow" />
          <div className="docapp-peers" aria-label="Personas en el documento">
            {peers.slice(0, 6).map((p) => <span key={p.id} title={p.name} className="peer-av" style={{ ['--pc' as string]: p.color }}><Avatar name={p.name} /></span>)}
            {peers.length > 6 && <span className="muted small">+{peers.length - 6}</span>}
          </div>
          {!editable && <span className="badge">Solo lectura</span>}
          <button className="btn sm" onClick={() => setHistory((h) => !h)} aria-pressed={history}><History size={15} /> Historial</button>
          <Menu label="Guardar y descargar" items={saveItems()} trigger={<span className="btn sm primary">{busy ? <Loader2 size={15} className="spin-icon" /> : <Save size={15} />} {busy || 'Guardar'} <ChevronDown size={14} /></span>} />
          <button className="icon-btn" aria-label="Cerrar el editor" onClick={onClose}><X size={20} /></button>
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
          {history && <HistoryPanel code={code} doc={doc} provider={provider} editable={editable} editor={editor} onClose={() => setHistory(false)} />}
        </div>
      </div>
    </div>,
    document.body,
  )
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

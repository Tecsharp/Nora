import { useCallback, useEffect, useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { api, ApiError, download, formatBytes, type Room } from '../api'
import { useAuth } from '../auth'
import { pickFiles } from '../fileHandles'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { fileFromHandle, isActive, loadInterrupted, pruneStaleHandles, uploads, useUploads, type PendingUpload } from '../uploadManager'
import ProgressBar from './ProgressBar'

interface FileItem {
  id: string
  name: string
  sizeBytes: number
  uploaderId: string
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

export default function FilesTool({ room }: { room: Room }) {
  const { user } = useAuth()
  const toast = useToast()
  const mine = useUploads().filter((i) => i.code === room.code)
  const [files, setFiles] = useState<FileItem[]>([])
  const [remotes, setRemotes] = useState<Record<string, Remote>>({})
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [error, setError] = useState('')

  const who = useCallback((id: string) => room.participants.find((p) => p.userId === id)?.displayName ?? '—', [room.participants])

  const load = useCallback(() => {
    api<FileItem[]>(`/rooms/${room.code}/files`).then(setFiles).catch(() => {})
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
  useRealtime('file.deleted', (d: { id: string }) => setFiles((all) => all.filter((x) => x.id !== d.id)))
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

  async function onPick() {
    setError('')
    // Las subidas viven en un gestor global: cerrar este modal no las interrumpe.
    for (const { file, handle } of await pickFiles()) uploads.add(room.code, file, handle)
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

  return (
    <div className="stack">
      <div className="row">
        <button className="btn primary" onClick={onPick}>
          <Upload size={16} /> Subir archivos
        </button>
        <span className="muted small">Máx. por archivo: {formatBytes(user?.limits.maxFileSizeBytes)} · subida reanudable</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {mine.length > 0 && (
        <div className="stack">
          {mine.map((i) => (
            <div key={i.key} className="upload-item">
              <div className="row spread">
                <strong className="break">{i.file.name}</strong>
                {isActive(i) ? (
                  <button className="btn ghost" onClick={() => uploads.cancel(i.key)}>Cancelar</button>
                ) : (
                  <button className="btn ghost" onClick={() => uploads.dismiss(i.key)}>Quitar</button>
                )}
              </div>
              <ProgressBar p={i.progress} />
            </div>
          ))}
          {activeCount > 0 && <p className="muted small">Puedes cerrar esta ventana: las subidas continúan en segundo plano.</p>}
        </div>
      )}

      {Object.values(remotes).map((r) => (
        <div key={r.uploadId} className="upload-item remote">
          <span className="small">
            <strong>{who(r.userId)}</strong> está subiendo «{r.name}»
          </span>
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
              <button className="btn" onClick={() => resume(p)}>Reanudar</button>
              <button className="btn ghost"
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

      {files.length === 0 && <p className="muted">No hay archivos en esta sala.</p>}
      <ul className="list">
        {files.map((f) => (
          <li key={f.id} className="row spread">
            <div>
              <strong className="break">{f.name}</strong>
              <span className="muted small"> {formatBytes(f.sizeBytes)} · {who(f.uploaderId)}</span>
            </div>
            <div className="row">
              <button className="icon-btn" title="Descargar" aria-label={`Descargar ${f.name}`}
                onClick={() => download(`/rooms/${room.code}/files/${f.id}`, f.name).catch((e) => setError(e instanceof ApiError ? e.message : 'Error al descargar'))}>
                <Download size={18} />
              </button>
              {(f.uploaderId === user?.id || room.isOwner || user?.role === 'ADMIN') && (
                <button className="icon-btn danger" title="Borrar" aria-label={`Borrar ${f.name}`}
                  onClick={async () => {
                    await api(`/rooms/${room.code}/files/${f.id}`, 'DELETE').catch((e) => setError(e.message))
                  }}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

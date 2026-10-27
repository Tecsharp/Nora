import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Trash2, Upload, X } from 'lucide-react'
import { api, ApiError, download, formatBytes, type Room } from '../api'
import { useAuth } from '../auth'
import { rt, useRealtime } from '../realtime'
import { useToast } from '../toast'
import { startUpload, type UploadProgress, type UploadTask } from '../uploader'
import ProgressBar from './ProgressBar'

interface FileItem {
  id: string
  name: string
  sizeBytes: number
  uploaderId: string
  createdAt: string
}

interface Local {
  key: number
  name: string
  progress: UploadProgress
  task?: UploadTask
}

/** Subida de otra persona, reportada por el servidor por WebSocket. */
interface Remote {
  uploadId: string
  userId: string
  name: string
  received: number
  total: number
}

interface Pending {
  id: string
  name: string
  size: number
  receivedBytes: number
}

let keySeq = 1

export default function FilesTool({ room }: { room: Room }) {
  const { user } = useAuth()
  const toast = useToast()
  const [files, setFiles] = useState<FileItem[]>([])
  const [locals, setLocals] = useState<Local[]>([])
  const [remotes, setRemotes] = useState<Record<string, Remote>>({})
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const who = useCallback((id: string) => room.participants.find((p) => p.userId === id)?.displayName ?? '—', [room.participants])

  const load = useCallback(() => {
    api<FileItem[]>(`/rooms/${room.code}/files`).then(setFiles).catch(() => {})
    api<Pending[]>(`/rooms/${room.code}/uploads`).then(setPending).catch(() => {})
  }, [room.code])

  useEffect(load, [load])
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

  // Progreso en vivo para el resto de la sala: como mucho una vez por segundo por subida.
  const lastSent = useRef(0)
  const report = (p: UploadProgress) => {
    const now = Date.now()
    if (p.uploadId && p.state === 'uploading' && now - lastSent.current >= 1000) {
      lastSent.current = now
      rt.notify({ type: 'upload.progress', uploadId: p.uploadId, loaded: p.loaded })
    }
  }

  const patch = (key: number, p: Partial<Local>) => setLocals((all) => all.map((l) => (l.key === key ? { ...l, ...p } : l)))

  async function onPick(list: FileList | null) {
    if (!list?.length) return
    setError('')
    const items: { local: Local; file: File }[] = Array.from(list).map((file) => ({
      file,
      local: { key: keySeq++, name: file.name, progress: { state: 'preparing', loaded: 0, total: file.size, speed: 0, eta: null } },
    }))
    setLocals((all) => [...all, ...items.map((i) => i.local)])
    if (input.current) input.current.value = ''
    try {
      // Los archivos se suben de uno en uno; los trozos de cada uno van en paralelo.
      for (const { local, file } of items) {
        const task = startUpload(room.code, file, (progress) => {
          patch(local.key, { progress })
          report(progress)
        })
        patch(local.key, { task })
        await task.promise
      }
    } finally {
      load()
    }
  }

  const dismiss = (key: number) => setLocals((all) => all.filter((l) => l.key !== key))

  // Solo se eligen archivos nuevos cuando no hay una subida en curso (la cola se procesa de una vez).
  const uploading = locals.some((l) => ['preparing', 'uploading', 'waiting', 'finishing'].includes(l.progress.state))

  return (
    <div className="stack">
      <div className="row">
        <input ref={input} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
        <button className="btn primary" disabled={uploading} onClick={() => input.current?.click()}>
          <Upload size={16} /> Subir archivos
        </button>
        <span className="muted small">Máx. por archivo: {formatBytes(user?.limits.maxFileSizeBytes)} · subida reanudable</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {locals.map((l) => (
        <div key={l.key} className="upload-item">
          <div className="row spread">
            <strong className="break">{l.name}</strong>
            {['done', 'error', 'canceled'].includes(l.progress.state) ? (
              <button className="icon-btn" aria-label="Quitar" onClick={() => dismiss(l.key)}><X size={16} /></button>
            ) : (
              <button className="btn ghost" onClick={() => l.task?.cancel()}>Cancelar</button>
            )}
          </div>
          <ProgressBar p={l.progress} />
        </div>
      ))}

      {Object.values(remotes).map((r) => (
        <div key={r.uploadId} className="upload-item remote">
          <span className="small">
            <strong>{who(r.userId)}</strong> está subiendo «{r.name}»
          </span>
          <ProgressBar p={{ state: 'uploading', loaded: r.received, total: r.total, speed: 0, eta: null }} />
        </div>
      ))}

      {pending
        .filter((p) => !locals.some((l) => ['preparing', 'uploading', 'waiting', 'finishing'].includes(l.progress.state) && l.name === p.name))
        .map((p) => (
          <div key={p.id} className="upload-item pending">
            <div className="row spread">
              <span className="small">
                Subida interrumpida: <strong className="break">{p.name}</strong> ({Math.round((p.receivedBytes / p.size) * 100)}% enviado).
                Vuelve a seleccionar el mismo archivo para continuar.
              </span>
              <button className="btn ghost"
                onClick={async () => {
                  await api(`/rooms/${room.code}/uploads/${p.id}`, 'DELETE').catch((e) => setError(e.message))
                  load()
                }}>
                Descartar
              </button>
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

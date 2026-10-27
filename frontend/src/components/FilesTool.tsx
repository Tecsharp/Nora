import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { api, ApiError, download, formatBytes, upload, type Room } from '../api'
import { useAuth } from '../auth'

interface FileItem {
  id: string
  name: string
  sizeBytes: number
  uploaderId: string
  createdAt: string
}

export default function FilesTool({ room }: { room: Room }) {
  const { user } = useAuth()
  const [files, setFiles] = useState<FileItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api<FileItem[]>(`/rooms/${room.code}/files`).then(setFiles).catch(() => {}), [room.code])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  const who = (id: string) => room.participants.find((p) => p.userId === id)?.displayName ?? '—'

  async function onPick(list: FileList | null) {
    if (!list?.length) return
    setError('')
    setBusy(true)
    try {
      for (const f of Array.from(list)) await upload(`/rooms/${room.code}/files`, f)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al subir el archivo')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <input ref={input} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
        <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={16} /> {busy ? 'Subiendo…' : 'Subir archivos'}
        </button>
        <span className="muted small">Máx. por archivo: {formatBytes(user?.limits.maxFileSizeBytes)}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
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
                onClick={() => download(`/rooms/${room.code}/files/${f.id}`, f.name).catch((e) => setError(e.message))}>
                <Download size={18} />
              </button>
              {(f.uploaderId === user?.id || room.isOwner || user?.role === 'ADMIN') && (
                <button className="icon-btn danger" title="Borrar" aria-label={`Borrar ${f.name}`}
                  onClick={async () => {
                    await api(`/rooms/${room.code}/files/${f.id}`, 'DELETE').catch((e) => setError(e.message))
                    load()
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

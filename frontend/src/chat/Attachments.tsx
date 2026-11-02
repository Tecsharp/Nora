import { useCallback, useRef, useState } from 'react'
import { File as FileIcon, FileImage, FileText, Loader2, Video, X } from 'lucide-react'
import { ApiError, download, getAccessToken } from '../api'
import { useToast } from '../toast'

export interface MsgFile { id: string; name: string; size: number; type: string | null }
export interface MsgCall { code: string; title: string }
export interface MsgMeta { files?: MsgFile[]; call?: MsgCall }

/** Lo que se ve de un mensaje en las listas cuando no tiene texto (solo archivos o una llamada). */
export function previewOf(m: { text: string; meta?: MsgMeta }): string {
  if (m.text.trim()) return m.text
  const f = m.meta?.files
  if (f?.length) return `📎 ${f[0]!.name}${f.length > 1 ? ` y ${f.length - 1} más` : ''}`
  if (m.meta?.call) return `📞 ${m.meta.call.title || 'Llamada'}`
  return ''
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const iconFor = (f: { name: string; type: string | null }) => {
  const t = f.type ?? ''
  if (t.startsWith('image/')) return FileImage
  if (t === 'application/pdf' || t.startsWith('text/') || /\.(docx?|xlsx?|pptx?|odt|ods|odp|txt|md|csv)$/i.test(f.name)) return FileText
  return FileIcon
}

/** Sube un archivo a la sala (queda en Archivos) y devuelve lo que hace falta para adjuntarlo a un mensaje. */
async function uploadRoomFile(code: string, file: File): Promise<MsgFile> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/files`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: fd })
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? (res.status === 413 ? 'El archivo es demasiado grande' : `Error ${res.status}`))
  const f = (await res.json()) as { id: string; name?: string; originalName?: string; sizeBytes?: number; contentType?: string | null }
  return { id: f.id, name: f.name ?? f.originalName ?? file.name, size: f.sizeBytes ?? file.size, type: f.contentType ?? (file.type || null) }
}

/** Archivos que se van a adjuntar a un mensaje: se suben al elegirlos y se mandan con el texto. */
export function useAttachments(code: string) {
  const toast = useToast()
  const [files, setFiles] = useState<MsgFile[]>([])
  const [uploading, setUploading] = useState(0)
  const live = useRef(true)
  const add = useCallback(async (list: FileList | File[]) => {
    const picked = Array.from(list)
    if (!picked.length) return
    setUploading((n) => n + picked.length)
    for (const f of picked) {
      try {
        const up = await uploadRoomFile(code, f)
        if (live.current) setFiles((cur) => (cur.length >= 10 ? cur : [...cur, up]))
      } catch (e) {
        toast(`«${f.name}»: ${e instanceof Error ? e.message : 'no se pudo subir'}`, 'error')
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }, [code, toast])
  const remove = useCallback((id: string) => setFiles((cur) => cur.filter((f) => f.id !== id)), [])
  const clear = useCallback(() => setFiles([]), [])
  return { files, uploading, add, remove, clear }
}

/** Los archivos elegidos, antes de enviar. */
export function AttachChips({ files, uploading, onRemove }: { files: MsgFile[]; uploading: number; onRemove: (id: string) => void }) {
  if (!files.length && !uploading) return null
  return (
    <div className="chat-attach">
      {files.map((f) => {
        const Icon = iconFor(f)
        return (
          <span key={f.id} className="chat-achip" title={f.name}><Icon size={14} /><span className="truncate">{f.name}</span><small>{fmtSize(f.size)}</small>
            <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => onRemove(f.id)}><X size={12} /></button></span>
        )
      })}
      {uploading > 0 && <span className="chat-achip busy"><Loader2 size={14} className="spin-icon" /> Subiendo {uploading === 1 ? 'un archivo' : `${uploading} archivos`}…</span>}
    </div>
  )
}

/** Lo que lleva un mensaje además del texto: archivos para descargar y la tarjeta de una llamada. */
export function MessageMeta({ code, meta }: { code: string; meta?: MsgMeta | null }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (!meta || (!meta.files?.length && !meta.call)) return null
  const get = async (f: MsgFile) => {
    setBusy(f.id)
    try { await download(`/rooms/${encodeURIComponent(code)}/files/${f.id}`, f.name) } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo descargar', 'error') } finally { setBusy(null) }
  }
  return (
    <div className="chat-meta-box">
      {meta.files?.map((f) => {
        const Icon = iconFor(f)
        return (
          <button key={f.id} type="button" className="chat-file" onClick={(e) => { e.stopPropagation(); void get(f) }} title={`Descargar ${f.name}`} disabled={busy === f.id}>
            <span className="chat-file-ico">{busy === f.id ? <Loader2 size={18} className="spin-icon" /> : <Icon size={18} />}</span>
            <span className="chat-file-name"><b className="truncate">{f.name}</b><small>{fmtSize(f.size)}</small></span>
          </button>
        )
      })}
      {meta.call && (
        <a className="chat-call" href={`/call/${meta.call.code}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <span className="chat-file-ico call"><Video size={18} /></span>
          <span className="chat-file-name"><b className="truncate">{meta.call.title || 'Llamada'}</b><small>Toca para unirte</small></span>
          <span className="chat-call-go">Unirse</span>
        </a>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../api'
import { useRealtime } from '../realtime'

export type MediaKind = 'video' | 'audio' | 'image'

const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv'])
const AUDIO = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'])

/** Qué reproductor corresponde al archivo (solo lo que el navegador sabe mostrar). */
export function mediaKind(name: string): MediaKind | null {
  const e = name.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO.has(e) ? 'video' : AUDIO.has(e) ? 'audio' : IMAGE.has(e) ? 'image' : null
}

export interface RoomFileLite {
  id: string
  name: string
  sizeBytes: number
  uploaderId: string
  createdAt: string
  folderId: string | null
}

/** Archivos de la sala en vivo (se añaden y quitan solos). */
export function useRoomFiles(code: string) {
  const [files, setFiles] = useState<RoomFileLite[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    api<RoomFileLite[]>(`/rooms/${encodeURIComponent(code)}/files`).then((l) => alive && setFiles(l)).catch(() => undefined).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [code])
  useRealtime('file.added', (f: RoomFileLite) => setFiles((l) => (l.some((x) => x.id === f.id) ? l : [f, ...l])))
  useRealtime('file.deleted', (d: { id: string }) => setFiles((l) => l.filter((x) => x.id !== d.id)))
  return { files, loading }
}

/** Dirección firmada y temporal para reproducir un archivo de la sala (el reproductor no puede enviar el token de sesión). */
export async function streamUrl(code: string, fileId: string) {
  return api<{ url: string; contentType: string; name: string; size: number }>(`/rooms/${encodeURIComponent(code)}/files/${fileId}/stream`, 'POST')
}

/** 75 → 1:15 · 3725 → 1:02:05 */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

import { useEffect, useRef } from 'react'
import { Hand, MicOff, Pin, PinOff, Presentation } from 'lucide-react'
import Avatar from '../components/Avatar'

export interface TileProps {
  name: string
  userId?: string
  stream: MediaStream | null
  /** Hay imagen que enseñar (cámara encendida o pantalla); si no, se ve la inicial. */
  video: boolean
  mic?: boolean
  local?: boolean
  speaking?: boolean
  hand?: boolean
  host?: boolean
  companion?: boolean
  /** No reproducir su audio (modo complementario, o es mi propia imagen). */
  silent?: boolean
  speakerId?: string
  presentation?: boolean
  pinned?: boolean
  onPin?: () => void
  className?: string
  fit?: 'cover' | 'contain'
}

/** Una persona (o una pantalla presentada) en el mosaico. El elemento de vídeo existe siempre, aunque no se vea: es el que reproduce el audio. */
export default function Tile(p: TileProps) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== p.stream) el.srcObject = p.stream
    if (p.stream) el.play().catch(() => {})
  }, [p.stream])
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el?.setSinkId && p.speakerId) el.setSinkId(p.speakerId).catch(() => {})
  }, [p.speakerId])

  const showVideo = p.video && !!p.stream
  return (
    <div className={`ct ${p.speaking ? 'speaking' : ''} ${p.presentation ? 'presentation' : ''} ${p.className ?? ''}`} data-name={p.name}>
      <video ref={ref} className={`${showVideo ? '' : 'off'} ${p.local && !p.presentation ? 'mirror' : ''} ${p.fit === 'contain' || p.presentation ? 'contain' : ''}`}
        autoPlay playsInline muted={p.silent || p.local} />
      {!showVideo && (
        <div className="ct-avatar"><Avatar name={p.name} userId={p.userId ?? ''} version={0} size={88} /></div>
      )}
      {p.hand && <span className="ct-hand" title="Mano levantada"><Hand size={18} /></span>}
      <div className="ct-bar">
        {p.presentation && <Presentation size={14} />}
        {!p.mic && !p.presentation && <MicOff size={14} className="ct-off" />}
        <span className="ct-name">{p.presentation ? `Presentación de ${p.name}` : p.local ? `${p.name} (tú)` : p.name}</span>
        {p.host && !p.presentation && <span className="ct-tag">Anfitrión</span>}
        {p.companion && !p.presentation && <span className="ct-tag">Complemento</span>}
      </div>
      {p.onPin && (
        <button className="ct-pin" onClick={p.onPin} aria-label={p.pinned ? 'Dejar de fijar' : 'Fijar'} title={p.pinned ? 'Dejar de fijar' : 'Fijar'}>
          {p.pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, Headphones, Lock, Mic, MicOff, ShieldCheck, Video, VideoOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { User } from '../api'
import type { CallApi } from './useCall'
import type { LocalMedia } from './useLocalMedia'
import { callUrl } from './api'
import Avatar from '../components/Avatar'

/** Antes de entrar: ver cómo te ven, elegir dispositivos y decidir si entras de complemento. */
export default function PreJoin({ call, media, user }: { call: CallApi; media: LocalMedia; user: User }) {
  const navigate = useNavigate()
  const info = call.info
  const [companion, setCompanion] = useState(false)
  const [busy, setBusy] = useState(false)
  const isHost = !!info && info.hostId === user.id
  const direct = isHost || info?.access === 'OPEN'

  // se piden cámara y micrófono al llegar, como Meet, para que se vea la vista previa
  useEffect(() => {
    void media.setMic(true)
    void media.setCam(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const preview = useMemo(() => (media.videoTrack ? new MediaStream([media.videoTrack]) : null), [media.videoTrack])
  const people = info?.people ?? []
  const here = people.length === 0 ? 'Todavía no hay nadie más' : people.length === 1 ? `${people[0]} está aquí` : `${people[0]} y ${people.length - 1} más están aquí`

  const go = async () => {
    setBusy(true)
    await call.join({ companion })
    setBusy(false)
  }

  return (
    <div className="cj">
      <header className="cj-top">
        <button className="cj-back" onClick={() => (info?.roomCode ? navigate(`/room/${info.roomCode}`) : navigate('/'))}><ArrowLeft size={18} /> {info?.roomName ?? 'Volver'}</button>
      </header>
      <div className="cj-body">
        <section className="cj-preview">
          <div className="cj-video">
            {preview && !companion ? <PreviewVideo stream={preview} /> : (
              <div className="cj-novideo">
                <Avatar name={user.displayName} userId={user.id} version={user.avatarVersion} size={96} />
                <span>{companion ? 'Modo complementario: sin audio ni video' : media.camError || 'La cámara está apagada'}</span>
              </div>
            )}
            <div className="cj-ctl">
              <button className={`cbtn ${media.mic && !companion ? '' : 'off'}`} disabled={companion} onClick={() => void media.setMic(!media.mic)} aria-label={media.mic ? 'Silenciar' : 'Activar micrófono'}>
                {media.mic && !companion ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
              <button className={`cbtn ${media.cam ? '' : 'off'}`} onClick={() => void media.setCam(!media.cam)} aria-label={media.cam ? 'Apagar cámara' : 'Encender cámara'}>
                {media.cam ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            </div>
          </div>
          {(media.micError || media.camError) && <p className="cj-warn">{[media.micError, media.camError].filter(Boolean).join(' · ')}. Puedes entrar igualmente.</p>}
          <div className="cj-devices">
            <label><Mic size={15} />
              <select value={media.micId} onChange={(e) => void media.pickMic(e.target.value)} aria-label="Micrófono">
                <option value="">Micrófono predeterminado</option>
                {media.devices.mics.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micrófono'}</option>)}
              </select>
            </label>
            <label><Camera size={15} />
              <select value={media.camId} onChange={(e) => void media.pickCam(e.target.value)} aria-label="Cámara">
                <option value="">Cámara predeterminada</option>
                {media.devices.cams.filter((d) => d.deviceId).map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Cámara'}</option>)}
              </select>
            </label>
            {media.devices.speakers.length > 0 && (
              <label><Headphones size={15} />
                <select value={media.speakerId} onChange={(e) => media.pickSpeaker(e.target.value)} aria-label="Altavoz">
                  <option value="">Altavoz predeterminado</option>
                  {media.devices.speakers.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Altavoz'}</option>)}
                </select>
              </label>
            )}
          </div>
        </section>

        <section className="cj-side">
          <h1>{info?.title || 'Llamada'}</h1>
          <p className="cj-code">{info?.code} <button className="cj-link" onClick={() => info && navigator.clipboard?.writeText(callUrl(info.code))}>Copiar enlace</button></p>
          <p className="cj-here">{here}</p>
          <p className="cj-note">{direct ? <><ShieldCheck size={15} /> {isHost ? 'Eres el anfitrión: entras directamente.' : 'Las personas de la sala entran directamente.'}</> : <><Lock size={15} /> El anfitrión ({info?.hostName}) tiene que dejarte entrar.</>}</p>
          <label className="cj-check">
            <input type="checkbox" checked={companion} onChange={(e) => { setCompanion(e.target.checked); if (e.target.checked) void media.setMic(false) }} />
            <span><strong>Usar como complemento</strong><small>Para cuando ya estás en una sala con otras personas (o en otro dispositivo): sin micrófono ni altavoz para evitar el eco, pero con chat, pantalla, reacciones y mano levantada.</small></span>
          </label>
          <button className="cj-join" disabled={!info || busy || call.phase === 'joining'} onClick={() => void go()}>
            {call.phase === 'joining' ? 'Entrando…' : direct ? 'Unirse ahora' : 'Pedir unirse'}
          </button>
          <p className="cj-who">Entras como <strong>{user.displayName}</strong></p>
        </section>
      </div>
    </div>
  )
}

function PreviewVideo({ stream }: { stream: MediaStream }) {
  return <video className="mirror" autoPlay muted playsInline ref={(el) => { if (el && el.srcObject !== stream) { el.srcObject = stream; el.play().catch(() => {}) } }} />
}

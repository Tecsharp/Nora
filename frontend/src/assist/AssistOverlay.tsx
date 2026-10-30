import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hand, Maximize2, Minimize2, MonitorOff, MonitorUp, MousePointer2, ShieldAlert, X } from 'lucide-react'
import { useAssist, type AssistSession } from './AssistProvider'

/** Todo lo que aparece sobre la sala mientras hay asistencia: peticiones, la pantalla que veo y los avisos de lo que comparto. */
export default function AssistOverlay() {
  const { sessions, incoming, accept, decline, end, revokeControl } = useAssist()
  const [busy, setBusy] = useState<string | null>(null)
  const viewing = sessions.filter((s) => s.role === 'viewer')
  const sharing = sessions.filter((s) => s.role === 'sharer')
  if (!sessions.length && !incoming.length) return null

  return createPortal(
    <>
      {incoming.length > 0 && (
        <div className="assist-incoming" role="alertdialog" aria-label="Peticiones de asistencia">
          {incoming.map((i) => (
            <div key={i.id + i.kind} className={`assist-ask ${i.kind === 'control' ? 'warn' : ''}`}>
              <div className="assist-ask-ico">{i.kind === 'control' ? <ShieldAlert size={20} /> : <MonitorUp size={20} />}</div>
              <div className="assist-ask-body">
                {i.kind === 'request' && <><strong>{i.from.name}</strong> quiere {i.mode === 'control' ? 'ver y controlar' : 'ver'} tu pantalla.<small>Después elegirás qué pantalla compartir{i.mode === 'control' ? ' (completa, para poder controlarla)' : ''}. Puedes terminarlo cuando quieras.</small></>}
                {i.kind === 'invite' && <><strong>{i.from.name}</strong> quiere compartir su pantalla contigo.</>}
                {i.kind === 'control' && <><strong>{i.from.name}</strong> pide controlar tu equipo con el ratón y el teclado.<small>Verá lo que hagas y podrá hacer clic y escribir como si fuera tú. Solo mientras lo permitas.</small></>}
                <div className="assist-ask-actions">
                  <button className={`btn sm ${i.kind === 'control' ? 'danger' : 'primary'}`} disabled={busy === i.id}
                    onClick={async () => { setBusy(i.id); await accept(i); setBusy(null) }}>
                    {i.kind === 'request' ? 'Compartir mi pantalla' : i.kind === 'invite' ? 'Ver su pantalla' : 'Permitir control'}
                  </button>
                  <button className="btn sm ghost" onClick={() => decline(i)}>Rechazar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sharing.length > 0 && (
        <div className="assist-sharing" role="status">
          {sharing.map((s) => (
            <div key={s.id} className={`assist-pill ${s.control === 'granted' ? 'red' : ''}`}>
              {s.control === 'granted' ? <Hand size={15} /> : <MonitorUp size={15} />}
              <span>{s.control === 'granted' ? <><strong>{s.peer.name}</strong> está controlando tu equipo</> : <>Compartes tu pantalla con <strong>{s.peer.name}</strong></>}</span>
              {s.control === 'granted' && <button className="btn sm danger" onClick={() => revokeControl(s.id)}>Detener control</button>}
              <button className="btn sm ghost" onClick={() => end(s.id)}><MonitorOff size={14} /> Dejar de compartir</button>
            </div>
          ))}
        </div>
      )}

      {viewing.map((s, i) => <ViewerPanel key={s.id} s={s} index={i} />)}
    </>,
    document.body,
  )
}

const THROTTLE_MS = 16

function ViewerPanel({ s, index }: { s: AssistSession; index: number }) {
  const { end, requestControl, revokeControl, input, agents } = useAssist()
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [big, setBig] = useState(false)
  const lastMove = useRef(0)
  const controlling = s.control === 'granted'

  useEffect(() => {
    if (video.current) video.current.srcObject = s.stream
  }, [s.stream])

  /** Posición del puntero dentro de la imagen de la pantalla (0–1), descontando las franjas que deja el ajuste del vídeo. */
  const norm = (e: { clientX: number; clientY: number }) => {
    const v = video.current
    if (!v || !v.videoWidth) return null
    const r = v.getBoundingClientRect()
    const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
    const w = v.videoWidth * scale
    const h = v.videoHeight * scale
    const x = (e.clientX - (r.left + (r.width - w) / 2)) / w
    const y = (e.clientY - (r.top + (r.height - h) / 2)) / h
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
  }

  useEffect(() => {
    const el = box.current
    if (!el || !controlling) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      input(s.id, { t: 'wh', dx: e.deltaX, dy: e.deltaY })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [controlling, input, s.id])

  const onMove = (e: React.PointerEvent) => {
    if (!controlling || e.timeStamp - lastMove.current < THROTTLE_MS) return
    const p = norm(e)
    if (!p) return
    lastMove.current = e.timeStamp
    input(s.id, { t: 'mm', ...p })
  }
  const onButton = (down: boolean) => (e: React.PointerEvent) => {
    if (!controlling) return
    const p = norm(e)
    if (down) {
      box.current?.focus()
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (p) input(s.id, { t: down ? 'md' : 'mu', b: e.button === 1 ? 1 : e.button === 2 ? 2 : 0, ...p })
  }
  const onKey = (down: boolean) => (e: React.KeyboardEvent) => {
    if (!controlling) return
    e.preventDefault()
    input(s.id, { t: down ? 'kd' : 'ku', k: e.key, c: e.code })
  }

  return (
    <div className={`assist-panel ${big ? 'big' : ''}`} style={big ? undefined : { bottom: 16 + index * 12, right: 16 + index * 12 }} role="dialog" aria-label={`Pantalla de ${s.peer.name}`}>
      <div className="assist-bar">
        <strong className="truncate">Pantalla de {s.peer.name}</strong>
        <span className={`badge ${controlling ? 'red' : s.state === 'live' ? 'green' : ''}`}>
          {controlling ? 'Controlando' : s.control === 'asked' ? 'Pidiendo control…' : s.state === 'live' ? 'En vivo' : 'Conectando…'}
        </span>
        <span className="spacer" />
        {controlling
          ? <button className="btn sm danger" onClick={() => revokeControl(s.id)}>Dejar de controlar</button>
          : <button className="btn sm" disabled={s.control === 'asked' || !agents.has(s.peer.id)} onClick={() => requestControl(s.id)} title={agents.has(s.peer.id) ? 'Pide permiso para usar su ratón y teclado' : `${s.peer.name} no tiene el agente de Nora conectado: sin él solo se puede ver su pantalla`}><MousePointer2 size={14} /> Controlar</button>}
        <button className="icon-btn" onClick={() => setBig((b) => !b)} aria-label={big ? 'Reducir' : 'Ampliar'} title={big ? 'Reducir' : 'Ampliar'}>{big ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button className="icon-btn" onClick={() => end(s.id)} aria-label="Terminar" title="Terminar la asistencia"><X size={16} /></button>
      </div>
      <div
        ref={box}
        className={`assist-screen ${controlling ? 'controlling' : ''}`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerDown={onButton(true)}
        onPointerUp={onButton(false)}
        onContextMenu={(e) => controlling && e.preventDefault()}
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
      >
        <video ref={video} autoPlay playsInline muted />
        {!s.stream && <span className="assist-wait">Esperando la pantalla…</span>}
        {controlling && <span className="assist-hint">Haz clic aquí para usar el ratón y el teclado en su equipo</span>}
      </div>
    </div>
  )
}

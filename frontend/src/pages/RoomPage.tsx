import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ClipboardList, Clipboard, Copy, Check, FolderOpen, Monitor, PenTool, Plus, ShieldCheck, Trash2, Zap, Clapperboard, SquareCheckBig,
  type LucideProps,
} from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { rt, useRealtime, useRtStatus } from '../realtime'
import { useToast } from '../toast'
import Brand from '../components/Brand'
import FilesTool from '../components/FilesTool'
import NotesTool from '../components/NotesTool'
import { remaining } from '../time'
import { resumeInterrupted } from '../uploadManager'

type Icon = ComponentType<LucideProps>

interface Tool {
  id: string
  label: string
  icon: Icon
  ready: boolean
}

const TOOLS: Tool[] = [
  { id: 'files', label: 'Archivos', icon: FolderOpen, ready: true },
  { id: 'board', label: 'Pizarra', icon: PenTool, ready: false },
  { id: 'clipboard', label: 'Portapapeles', icon: Clipboard, ready: true },
  { id: 'notes', label: 'Notas', icon: ClipboardList, ready: true },
  { id: 'media', label: 'Media Review', icon: Clapperboard, ready: false },
  { id: 'attendance', label: 'Asistencia', icon: Monitor, ready: false },
  { id: 'polls', label: 'Votaciones', icon: SquareCheckBig, ready: false },
  { id: 'actions', label: 'Acciones', icon: Zap, ready: false },
  { id: 'more', label: 'Más herramientas', icon: Plus, ready: false },
]

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'

export default function RoomPage() {
  const { code = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [online, setOnline] = useState<Set<string>>(new Set())
  const toast = useToast()
  const status = useRtStatus()
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    try {
      const r = await api<Room>(`/rooms/${code}`)
      setRoom(r)
      // Sin WebSocket la presencia viene de la API; con WebSocket la mantienen los eventos.
      if (rt.status !== 'open') setOnline(new Set(r.participants.filter((p) => p.online).map((p) => p.userId)))
      setError('')
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410 || err.status === 403)) {
        setRoom(null)
        setError(err.status === 410 ? 'Esta sala ha expirado.' : err.status === 403 ? 'No participas en esta sala.' : 'La sala no existe.')
      }
    }
  }, [code])

  // La sala se recibe por REST una vez; después los cambios llegan por WebSocket.
  // Si no hay conexión en vivo se refresca cada 15 s como respaldo.
  useEffect(() => {
    load()
    rt.join(code)
    void resumeInterrupted(code) // reanuda solas las subidas cortadas cuyo archivo sigue accesible
    return () => rt.leave()
  }, [code, load])

  useEffect(() => {
    if (status === 'open') rt.join(code) // al (re)conectar se vuelve a entrar en la sala
    else {
      const poll = setInterval(load, 15_000)
      return () => clearInterval(poll)
    }
  }, [status, code, load])

  useEffect(() => {
    const clock = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(clock)
  }, [])

  useRealtime('joined', (d: { online: string[] }) => setOnline(new Set(d.online)))
  useRealtime('reconnected', load)
  useRealtime('presence', (d: { userId: string; displayName: string; online: boolean }) => {
    setOnline((s) => {
      const next = new Set(s)
      if (d.online) next.add(d.userId)
      else next.delete(d.userId)
      return next
    })
    if (d.userId !== user?.id) toast(`${d.displayName} ${d.online ? 'se ha conectado' : 'se ha desconectado'}`, 'info')
  })
  useRealtime('member.joined', (d: { displayName: string }) => {
    toast(`${d.displayName} se ha unido a la sala`, 'success')
    load()
  })
  useRealtime('room.expiring', (d: { minutesLeft: number }) =>
    toast(d.minutesLeft <= 1 ? 'La sala expira en menos de 1 minuto' : `La sala expira en ${d.minutesLeft} minutos`, 'warning'))
  useRealtime('room.closed', (d: { reason: string }) => {
    toast(d.reason === 'expired' ? 'La sala ha expirado y se han borrado sus archivos' : 'La sala ha sido cerrada', 'warning')
    navigate('/')
  })
  useRealtime('error', (d: { status?: number; message: string }) => {
    if (d.status) setError(d.message)
  })

  async function copy() {
    await navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function closeRoom() {
    if (!confirm('¿Cerrar la sala? Se borrarán todos sus archivos y contenido.')) return
    await api(`/rooms/${code}`, 'DELETE')
    navigate('/')
  }

  if (!room) {
    return (
      <div className="card stack center-text">
        <p>{error || 'Cargando sala…'}</p>
        {error && <button className="btn" onClick={() => navigate('/')}>Volver</button>}
      </div>
    )
  }

  const onlineCount = room.participants.filter((p) => online.has(p.userId)).length
  const expired = room.expiresAt !== null && new Date(room.expiresAt).getTime() <= Date.now()
  const tool = TOOLS.find((t) => t.id === active)
  const secure = window.location.protocol === 'https:'

  return (
    <div className="room card">
      <header className="room-head">
        <Brand />
        <span className={`pill ${expired ? 'off' : ''}`}>
          <i /> {expired ? 'Room expired' : 'Room active'}
        </span>
      </header>

      <section className="room-info">
        <div>
          <h2>{room.name}</h2>
          <p className="muted">Código: {room.code} · {remaining(room.expiresAt)}</p>
          <div className="avatars">
            {room.participants.slice(0, 8).map((p) => (
              <span key={p.userId} className={`avatar ${online.has(p.userId) ? 'on' : ''}`} title={`${p.displayName}${online.has(p.userId) ? '' : ' (desconectado)'}`}>
                {initials(p.displayName)}
              </span>
            ))}
            <span className="muted">
              {onlineCount} {onlineCount === 1 ? 'participante conectado' : 'participantes conectados'}
            </span>
          </div>
        </div>
        <div className="row">
          <button className="icon-btn" onClick={copy} aria-label="Copiar código" title="Copiar código">
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </button>
          {(room.isOwner || user?.role === 'ADMIN') && (
            <button className="icon-btn danger" onClick={closeRoom} aria-label="Cerrar sala" title="Cerrar sala">
              <Trash2 size={20} />
            </button>
          )}
        </div>
      </section>

      <h3>Herramientas disponibles</h3>
      <div className="tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${t.ready ? '' : 'soon'}`} onClick={() => setActive(t.id)}>
            <t.icon size={26} />
            <span>{t.label}</span>
            {!t.ready && <small>Próximamente</small>}
          </button>
        ))}
      </div>

      <footer className="room-foot">
        <span className={secure ? 'ok' : 'muted'}>
          <ShieldCheck size={18} /> {secure ? 'Conexión cifrada' : 'Conexión local (HTTP)'}
        </span>
        <span className={status === 'open' ? 'ok' : 'muted'}>
          <i className={`live ${status}`} /> {status === 'open' ? 'En vivo' : status === 'connecting' ? 'Conectando…' : 'Sin conexión en vivo'} · {room.participants.length} en la sala
        </span>
      </footer>

      {tool && (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="modal card" role="dialog" aria-label={tool.label} onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <h2>{tool.label}</h2>
              <button className="btn ghost" onClick={() => setActive(null)}>Cerrar</button>
            </div>
            {tool.id === 'files' && <FilesTool room={room} />}
            {tool.id === 'notes' && <NotesTool code={room.code} kind="NOTE" placeholder="Escribe una nota para la sala…" />}
            {tool.id === 'clipboard' && <NotesTool code={room.code} kind="CLIPBOARD" placeholder="Pega aquí el texto que quieres compartir…" copyable />}
            {!tool.ready && <p className="muted">Esta herramienta llegará en una próxima versión.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ClipboardList, Clipboard, Copy, Check, FolderOpen, Monitor, PenTool, Plus, ShieldCheck, Trash2, Zap, Clapperboard, SquareCheckBig,
  type LucideProps,
} from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import Brand from '../components/Brand'
import FilesTool from '../components/FilesTool'
import NotesTool from '../components/NotesTool'
import { remaining } from '../time'

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
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    try {
      setRoom(await api<Room>(`/rooms/${code}`))
      setError('')
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410 || err.status === 403)) {
        setRoom(null)
        setError(err.status === 410 ? 'Esta sala ha expirado.' : err.status === 403 ? 'No participas en esta sala.' : 'La sala no existe.')
      }
    }
  }, [code])

  // Cada petición actúa como latido de presencia; la cuenta atrás se refresca cada segundo.
  useEffect(() => {
    load()
    const poll = setInterval(load, 10_000)
    const clock = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(clock)
    }
  }, [load])

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

  const online = room.participants.filter((p) => p.online)
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
              <span key={p.userId} className={`avatar ${p.online ? 'on' : ''}`} title={`${p.displayName}${p.online ? '' : ' (desconectado)'}`}>
                {initials(p.displayName)}
              </span>
            ))}
            <span className="muted">
              {online.length} {online.length === 1 ? 'participante conectado' : 'participantes conectados'}
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
        <span className="muted">{room.participants.length} en la sala</span>
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

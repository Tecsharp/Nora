import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Check, Clapperboard, Clipboard, ClipboardList, Clock, Copy, FolderOpen, Hash, Monitor, PenTool, Plus, ShieldCheck,
  SquareCheckBig, Trash2, Zap, type LucideProps,
} from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { rt, useRealtime, useRtStatus } from '../realtime'
import { useToast } from '../toast'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import FilesTool from '../components/FilesTool'
import NotesTool from '../components/NotesTool'
import { remaining } from '../time'
import { setFilesOpen } from '../ui'
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

  // Mientras el explorador de archivos está abierto el panel flotante de subidas se oculta
  useEffect(() => {
    setFilesOpen(active === 'files')
    return () => setFilesOpen(false)
  }, [active])

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
    <div className="room">
      <header className="room-top">
        <Link to="/" className="btn ghost sm"><ArrowLeft size={15} /> Mis salas</Link>
        <div className="row">
          <span className={`badge ${expired ? 'red' : 'green'}`}><i /> {expired ? 'Sala expirada' : 'Sala activa'}</span>
          {(room.isOwner || user?.role === 'ADMIN') && (
            <button className="icon-btn danger" onClick={closeRoom} aria-label="Cerrar sala" title="Cerrar sala">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="room-hero stagger">
        <section className="card" style={{ ['--i' as string]: 0 }} aria-label="Sala">
          <span className="eyebrow">Sala</span>
          <h2 className="room-title">{room.name}</h2>
          <div className="meta-row">
            <span className="meta-pill">
              <Hash size={16} /> <b>{room.code}</b>
              <button className="icon-btn sm" onClick={copy} aria-label="Copiar código" title="Copiar código">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </span>
            <span className="meta-pill"><Clock size={16} /> {remaining(room.expiresAt)}</span>
          </div>
        </section>

        <section className="card" style={{ ['--i' as string]: 1 }} aria-label="Participantes">
          <div className="people-head">
            <span className="eyebrow">Participantes</span>
            <span className="badge green"><i /> {onlineCount} {onlineCount === 1 ? 'conectado' : 'conectados'}</span>
          </div>
          <div className="avatars">
            {room.participants.slice(0, 10).map((p) => (
              <span key={p.userId} className={`person ${online.has(p.userId) ? '' : 'off'}`}
                title={`${p.displayName}${online.has(p.userId) ? '' : ' (desconectado)'}`}>
                <Avatar name={p.displayName} online={online.has(p.userId)} />
                <span className="truncate">{p.displayName}</span>
              </span>
            ))}
            {room.participants.length > 10 && <span className="person muted">+{room.participants.length - 10} más</span>}
          </div>
        </section>
      </div>

      <div className="tools-wrap">
        <div className="section-title"><h3>Herramientas</h3></div>
        <div className="tools stagger">
          {TOOLS.map((t, i) => (
            <button key={t.id} className={`tool t-${t.id} ${t.ready ? '' : 'soon'}`} style={{ ['--i' as string]: i + 2 }} onClick={() => setActive(t.id)}>
              <span className="ico"><t.icon size={22} /></span>
              <span className="tl">
                <span>{t.label}</span>
                {!t.ready && <small>Próximamente</small>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <footer className="room-foot">
        <span className={secure ? 'ok' : 'muted'}>
          <ShieldCheck size={16} /> {secure ? 'Conexión cifrada' : 'Conexión local (HTTP)'}
        </span>
        <span className={status === 'open' ? 'ok' : 'muted'}>
          <i className={`live ${status}`} /> {status === 'open' ? 'En vivo' : status === 'connecting' ? 'Conectando…' : 'Sin conexión en vivo'} · {room.participants.length} en la sala
        </span>
      </footer>

      {tool && (
        <Modal title={tool.label} icon={<tool.icon size={20} />} wide={tool.ready} flush={tool.ready} onClose={() => setActive(null)}>
          {tool.id === 'files' && <FilesTool room={room} />}
          {tool.id === 'notes' && <NotesTool room={room} kind="NOTE" placeholder="Escribe una nota para la sala…" />}
          {tool.id === 'clipboard' && <NotesTool room={room} kind="CLIPBOARD" placeholder="Pega aquí el texto que quieres compartir…" copyable />}
          {!tool.ready && (
            <div className="empty">
              <tool.icon size={36} />
              <strong>Próximamente</strong>
              <span className="small">Esta herramienta llegará en una próxima versión.</span>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

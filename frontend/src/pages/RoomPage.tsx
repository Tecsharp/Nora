import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Check, Pencil, Settings, UserCheck, X, Clapperboard, Clipboard, ClipboardList, Clock, Copy, FolderOpen, Hash, Monitor, PenTool, Plus, ShieldCheck,
  SquareCheckBig, Trash2, Zap, type LucideProps,
} from 'lucide-react'
import { api, ApiError, type JoinRequest, type Room } from '../api'
import { useAuth } from '../auth'
import { rt, useRealtime, useRtStatus } from '../realtime'
import { useToast } from '../toast'
import Avatar from '../components/Avatar'
import ExpiryDialog from '../components/ExpiryDialog'
import RoomSettingsDialog from '../components/RoomSettingsDialog'
import Menu from '../components/Menu'
import Modal from '../components/Modal'
import FilesTool from '../components/FilesTool'
import BoardsTool from '../components/BoardsTool'
import type { DocInfo } from '../collab/DocEditor'
import { canWrite as canWriteIn } from '../roles'
import NotesTool from '../components/NotesTool'
import { ASSIGNABLE, ROLE_HINT, ROLE_LABEL, type RoomRole } from '../roles'
import { remaining } from '../time'
import { setFilesOpen } from '../ui'
import { resumeInterrupted } from '../uploadManager'

type Icon = ComponentType<LucideProps>

interface Tool {
  id: string
  label: string
  icon: Icon
  ready: boolean
  tone?: string
}

const TOOLS: Tool[] = [
  { id: 'files', label: 'Archivos', icon: FolderOpen, ready: true, tone: 'blue' },
  { id: 'board', label: 'Pizarra', icon: PenTool, ready: true, tone: 'violet' },
  { id: 'clipboard', label: 'Portapapeles', icon: Clipboard, ready: true, tone: 'amber' },
  { id: 'notes', label: 'Notas', icon: ClipboardList, ready: true, tone: 'rose' },
  { id: 'media', label: 'Media Review', icon: Clapperboard, ready: false },
  { id: 'attendance', label: 'Asistencia', icon: Monitor, ready: false },
  { id: 'polls', label: 'Votaciones', icon: SquareCheckBig, ready: false },
  { id: 'actions', label: 'Acciones', icon: Zap, ready: false },
  { id: 'more', label: 'Más herramientas', icon: Plus, ready: false },
]

const DocEditor = lazy(() => import('../collab/DocEditor'))

export default function RoomPage() {
  const { code = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [editingDoc, setEditingDoc] = useState<DocInfo | null>(null)
  const [params, setParams] = useSearchParams()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [requests, setRequests] = useState<JoinRequest[]>([])
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
  useRealtime('room.updated', (d: { expiresAt: string | null; settings?: Room['settings'] }) =>
    setRoom((r) => (r ? { ...r, expiresAt: d.expiresAt, settings: d.settings ?? r.settings } : r)))
  useRealtime('join.requested', (d: { code: string }) => d.code === code && loadRequests())
  useRealtime('join.cancelled', (d: { code: string }) => d.code === code && loadRequests())
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
  useRealtime('member.updated', (d: { userId: string; displayName: string; role: RoomRole }) => {
    setRoom((r) => r && {
      ...r,
      role: d.userId === user?.id ? d.role : r.role,
      participants: r.participants.map((x) => (x.userId === d.userId ? { ...x, role: d.role } : x)),
    })
    if (d.userId === user?.id) toast(`Tu rol en la sala ahora es: ${ROLE_LABEL[d.role]} (${ROLE_HINT[d.role].toLowerCase()})`, 'info')
  })
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

  const isOwnerLike = !!room && (room.isOwner || user?.role === 'ADMIN')
  const loadRequests = useCallback(() => {
    api<JoinRequest[]>(`/rooms/${code}/join-requests`).then(setRequests).catch(() => setRequests([]))
  }, [code])
  useEffect(() => {
    if (isOwnerLike) loadRequests()
  }, [isOwnerLike, loadRequests])

  async function decide(userId: string, approve: boolean) {
    try {
      await api(`/rooms/${code}/join-requests/${userId}`, 'POST', { approve })
      setRequests((all) => all.filter((r) => r.userId !== userId))
      if (approve) load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'No se pudo responder', 'error')
      loadRequests()
    }
  }

  const openDoc = useCallback((d: DocInfo) => {
    setEditingDoc(d) // el editor se abre encima: al cerrarlo se vuelve a Archivos
    setParams((p) => { p.set('doc', d.id); return p }, { replace: true })
  }, [setParams])
  const closeDoc = useCallback(() => {
    setEditingDoc(null)
    setParams((p) => { p.delete('doc'); return p }, { replace: true })
  }, [setParams])
  // Enlace directo a un documento (?doc=…)
  const wantedDoc = params.get('doc')
  useEffect(() => {
    if (!wantedDoc || editingDoc?.id === wantedDoc) return
    api<DocInfo>(`/rooms/${code}/docs/${wantedDoc}`).then(setEditingDoc).catch(() => closeDoc())
  }, [wantedDoc, code, editingDoc?.id, closeDoc])

  async function assignRole(userId: string, role: RoomRole) {
    try {
      await api(`/rooms/${code}/members/${userId}`, 'PATCH', { role })
      setRoom((r) => (r ? { ...r, participants: r.participants.map((x) => (x.userId === userId ? { ...x, role } : x)) } : r))
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'No se pudo cambiar el rol', 'error')
    }
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
  const canAssign = room.isOwner || user?.role === 'ADMIN'

  return (
    <div className="room">
      <header className="room-top">
        <Link to="/" className="btn ghost sm"><ArrowLeft size={15} /> Mis salas</Link>
        <div className="row">
          <span className={`badge ${expired ? 'red' : 'green'}`}><i /> {expired ? 'Sala expirada' : 'Sala activa'}</span>
          {canAssign && (
            <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Opciones de la sala" title="Opciones de la sala">
              <Settings size={18} />
            </button>
          )}
          {(room.isOwner || user?.role === 'ADMIN') && (
            <button className="icon-btn danger" onClick={closeRoom} aria-label="Cerrar sala" title="Cerrar sala">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="room-hero stagger">
        <section style={{ ['--i' as string]: 0 }} aria-label="Sala">
          <span className="eyebrow">Sala</span>
          <h2 className="room-title">{room.name}</h2>
          <div className="meta-row">
            <span className="meta-pill">
              <Hash size={16} /> <b>{room.code}</b>
              <button className="icon-btn sm" onClick={copy} aria-label="Copiar código" title="Copiar código">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </span>
            <span className="meta-pill">
              <Clock size={16} /> {remaining(room.expiresAt)}
              {(room.isOwner || user?.role === 'ADMIN') && (
                <button className="icon-btn sm" onClick={() => setAdjusting(true)} aria-label="Cambiar la duración" title="Extender o reducir la sala">
                  <Pencil size={14} />
                </button>
              )}
            </span>
          </div>
        </section>

        <section style={{ ['--i' as string]: 1 }} aria-label="Participantes">
          <div className="people-head">
            <span className="eyebrow">Participantes</span>
            <span className="badge green"><i /> {onlineCount} {onlineCount === 1 ? 'conectado' : 'conectados'}</span>
          </div>
          <div className="avatars">
            {room.participants.slice(0, 24).map((p) => (
              <span key={p.userId} className={`person ${online.has(p.userId) ? '' : 'off'}`}
                title={`${p.displayName}${online.has(p.userId) ? '' : ' (desconectado)'}`}>
                <Avatar name={p.displayName} online={online.has(p.userId)} />
                <span className="who">
                  <span className="truncate">{p.displayName}</span>
                  <span className={`role-tag ${p.role === 'OWNER' || p.role === 'MODERATOR' ? 'strong' : ''}`}>{ROLE_LABEL[p.role]}</span>
                </span>
                {canAssign && p.role !== 'OWNER' && (
                  <Menu label={`Cambiar el rol de ${p.displayName}`} items={[
                    { heading: 'Rol en la sala' },
                    ...ASSIGNABLE.map((r) => ({
                      label: `${ROLE_LABEL[r]} · ${ROLE_HINT[r]}`,
                      icon: r === p.role ? <Check size={16} /> : <span style={{ width: 16 }} />,
                      onClick: () => void assignRole(p.userId, r),
                    })),
                  ]} />
                )}
              </span>
            ))}
            {room.participants.length > 24 && <span className="person muted">+{room.participants.length - 24} más</span>}
          </div>
        </section>
      </div>

      {requests.length > 0 && (
        <section className="card stack tight swap" style={{ marginTop: 16 }} aria-label="Solicitudes de entrada">
          <div className="people-head">
            <span className="eyebrow">Solicitudes de entrada</span>
            <span className="badge blue">{requests.length}</span>
          </div>
          {requests.map((r) => (
            <div key={r.userId} className="join-req">
              <span className="row nowrap"><Avatar name={r.displayName} /><span className="truncate">{r.displayName}</span></span>
              <span className="row nowrap">
                <button className="btn primary sm" onClick={() => void decide(r.userId, true)}><UserCheck size={15} /> Aceptar</button>
                <button className="btn ghost sm" onClick={() => void decide(r.userId, false)}><X size={15} /> Rechazar</button>
              </span>
            </div>
          ))}
        </section>
      )}

      <div className="tools-wrap">
        <div className="section-title"><h3>Herramientas</h3></div>
        <div className="tools stagger">
          {TOOLS.map((t, i) => (
            <button key={t.id} className={`tool t-${t.id} ${t.ready ? '' : 'soon'}`} style={{ ['--i' as string]: i + 2 }} onClick={() => setActive(t.id)}>
              <span className={`ico ${t.tone ? `tinted tn-${t.tone}` : ''}`}><t.icon size={22} /></span>
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

      {editingDoc && (
        <Suspense fallback={null}>
          <DocEditor code={room.code} doc={editingDoc} canWrite={canWriteIn(room, user)} onClose={closeDoc} />
        </Suspense>
      )}

      {settingsOpen && <RoomSettingsDialog room={room} onClose={() => setSettingsOpen(false)} onSaved={(r) => setRoom(r)} />}

      {adjusting && (
        <ExpiryDialog code={room.code} name={room.name} expiresAt={room.expiresAt} onClose={() => setAdjusting(false)}
          onChanged={(expiresAt) => setRoom((r) => (r ? { ...r, expiresAt } : r))} />
      )}

      {tool && (
        <Modal title={tool.label} icon={<tool.icon size={20} />} wide={tool.ready} flush={tool.ready} onClose={() => setActive(null)}>
          {tool.id === 'files' && <FilesTool room={room} onEditDoc={openDoc} />}
          {tool.id === 'board' && <BoardsTool room={room} onOpen={openDoc} />}
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

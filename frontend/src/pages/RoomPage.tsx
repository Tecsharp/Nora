import type { FocusTarget } from '../tools/focus'
import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Check, Pencil, UserX, Settings, UserCheck, X, Clapperboard, ClipboardList, Clock, Copy, FolderOpen, Hash, Monitor, PenTool, Pin, PinOff, ShieldCheck,
  SquareCheckBig, Trash2, MessageSquare, KanbanSquare, CalendarDays, Link2, Timer, Tv, type LucideProps,
} from 'lucide-react'
import { api, ApiError, type JoinRequest, type Room, type RoomStatus } from '../api'
import ReactivateDialog from '../components/ReactivateDialog'
import { useAuth } from '../auth'
import { rt, useRealtime, useRtStatus } from '../realtime'
import { useToast } from '../toast'
import { useDialogs } from '../dialogs'
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
import { AssistProvider } from '../assist/AssistProvider'
import AssistOverlay from '../assist/AssistOverlay'
import AssistTool from '../assist/AssistTool'
import ChatTool from '../tools/ChatTool'
import { ChatProvider, useChat } from '../chat/ChatProvider'
import ChatDock from '../chat/ChatDock'
import TasksTool from '../tools/TasksTool'
import PollsTool from '../tools/PollsTool'
import MediaReviewTool from '../tools/MediaReviewTool'
import CalendarTool, { useCalendarWatch } from '../tools/CalendarTool'
import LinksTool from '../tools/LinksTool'
import FocusTool from '../tools/FocusTool'
import PlayerTool from '../tools/PlayerTool'
import { fmt as fmtFocus, useFocus } from '../tools/useFocus'
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
  { id: 'notes', label: 'Notas', icon: ClipboardList, ready: true, tone: 'rose' },
  { id: 'chat', label: 'Chat', icon: MessageSquare, ready: true, tone: 'cyan' },
  { id: 'media', label: 'Media Review', icon: Clapperboard, ready: true, tone: 'rose' },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays, ready: true, tone: 'green' },
  { id: 'links', label: 'Enlaces', icon: Link2, ready: true, tone: 'cyan' },
  { id: 'focus', label: 'Foco', icon: Timer, ready: true, tone: 'violet' },
  { id: 'player', label: 'Reproductor', icon: Tv, ready: true, tone: 'red' },
  { id: 'attendance', label: 'Asistencia', icon: Monitor, ready: true, tone: 'amber' },
  { id: 'polls', label: 'Votaciones', icon: SquareCheckBig, ready: true, tone: 'teal' },
  { id: 'actions', label: 'Tablero', icon: KanbanSquare, ready: true, tone: 'orange' },
]

/** Herramientas que piden más ancho (tableros, calendario…). */
const XL_TOOLS = new Set(['actions', 'calendar', 'media', 'player', 'chat'])

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
  const [inactive, setInactive] = useState<RoomStatus | null>(null)
  const [reactivating, setReactivating] = useState(false)
  const pinKey = `nora-pinned-tools:${user?.id ?? ''}`
  const [pinned, setPinned] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`nora-pinned-tools:${user?.id ?? ''}`) ?? '[]') as string[] } catch { return [] } })
  const togglePin = (id: string) => setPinned((l) => {
    const next = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]
    try { localStorage.setItem(pinKey, JSON.stringify(next)) } catch { /* sin almacenamiento */ }
    return next
  })
  const [playerOn, setPlayerOn] = useState(false) // el Reproductor, una vez abierto, sigue montado para que no se corte el sonido
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (active === 'player') setPlayerOn(true) }, [active])
  const calendar = useCalendarWatch(code, user?.id)
  const focus = useFocus(code)
  const toast = useToast()
  const dialogs = useDialogs()
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
      setInactive(null)
      // Sin WebSocket la presencia viene de la API; con WebSocket la mantienen los eventos.
      if (rt.status !== 'open') setOnline(new Set(r.participants.filter((p) => p.online).map((p) => p.userId)))
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        // ¿expiró sin más o se conserva como sala inactiva?
        const st = await api<RoomStatus>(`/rooms/${code}/status`).catch(() => null)
        if (st?.inactive) { setRoom(null); setInactive(st); setError(''); return }
      }
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
  useRealtime('member.removed', (d: { userId: string; displayName: string }) => {
    setRoom((r) => r && { ...r, participants: r.participants.filter((x) => x.userId !== d.userId) })
    if (d.userId !== user?.id) toast(`${d.displayName} ya no está en la sala`, 'info')
  })
  useRealtime('member.kicked', (d: { code: string; roomName: string }) => {
    if (d.code !== code) return
    navigate('/')
    void dialogs.notify({ title: 'Te han expulsado de la sala', message: <>El propietario te ha quitado de <b>{d.roomName}</b>. Si crees que es un error, pídele el código para volver a entrar.</>, tone: 'warning', icon: 'user-x' })
  })
  useRealtime('room.inactive', (d: { code: string }) => { if (d.code === code) { toast('La sala ha expirado y queda inactiva: no se ha borrado nada', 'warning'); void load() } })
  useRealtime('room.reactivated', (d: { code: string }) => { if (d.code === code) void load() })
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
  // Destino de una notificación (?tool=…&item=…): abre la herramienta y la deja apuntando exactamente al sitio
  const [target, setTarget] = useState<FocusTarget | null>(null)
  const wantedTool = params.get('tool')
  useEffect(() => {
    if (!wantedTool || !room) return
    const f: FocusTarget = { tool: wantedTool, item: params.get('item') ?? undefined, file: params.get('file') ?? undefined, conv: params.get('conv') ?? undefined, msg: params.get('msg') ?? undefined, nonce: Date.now() }
    setParams((p) => { for (const k of ['tool', 'item', 'file', 'conv', 'msg']) p.delete(k); return p }, { replace: true })
    if (wantedTool === 'settings' || wantedTool === 'members') { setSettingsOpen(true); return }
    if (!TOOLS.some((t) => t.id === wantedTool)) return
    setTarget(f)
    setActive(wantedTool)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedTool, !!room])
  useEffect(() => { if (target && active !== target.tool) setTarget(null) }, [active, target])
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

  async function expel(userId: string, name: string) {
    if (!await dialogs.confirm({ title: `¿Expulsar a ${name}?`, message: <>Dejará de ver la sala y su contenido al instante. Lo que haya subido o escrito se queda en la sala. Podrá volver a entrar si tiene el código{room?.settings.requireApproval ? ' y tú lo apruebas' : ''}.</>, confirmLabel: 'Expulsar', tone: 'danger', icon: 'user-x' })) return
    try {
      await api(`/rooms/${code}/members/${userId}`, 'DELETE')
      setRoom((r) => r && { ...r, participants: r.participants.filter((x) => x.userId !== userId) })
      toast(`${name} ha sido expulsado de la sala`, 'success')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'No se pudo expulsar', 'error')
    }
  }

  async function closeRoom() {
    if (!await dialogs.confirm({ title: '¿Cerrar la sala?', message: <>Se borrarán todos sus archivos y contenido para <b>todos los participantes</b>. No se puede deshacer.</>, confirmLabel: 'Cerrar sala', tone: 'danger', typeToConfirm: room?.name ?? undefined })) return
    await api(`/rooms/${code}`, 'DELETE')
    navigate('/')
  }

  if (!room && inactive) {
    return (
      <div className="card stack center-text inactive-room">
        <span className="badge">Sala inactiva</span>
        <h2>«{inactive.name}» está inactiva</h2>
        <p className="muted">La sala expiró, pero se conservó: no se ha borrado nada. Mientras está inactiva no tiene conexiones en vivo (chat, tableros, reproductor…), así que no gasta recursos.</p>
        {inactive.isOwner
          ? <div className="row" style={{ justifyContent: 'center' }}><button className="btn primary" onClick={() => setReactivating(true)}>Reactivar la sala</button><button className="btn" onClick={() => navigate('/')}>Volver</button></div>
          : <><p className="small">El propietario puede reactivarla cuando quiera.</p><button className="btn" onClick={() => navigate('/')}>Volver</button></>}
        {reactivating && <ReactivateDialog code={inactive.code} name={inactive.name} onClose={() => setReactivating(false)} onDone={() => void load()} />}
      </div>
    )
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

  const openChat = (convId?: string) => { setTarget({ tool: 'chat', conv: convId, nonce: Date.now() }); setActive('chat') }

  return (
    <AssistProvider code={room.code}>
    <ChatProvider room={room} online={online} fullOpen={active === 'chat'} onOpenFull={openChat}>
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
                <Avatar name={p.displayName} online={online.has(p.userId)} userId={p.userId} version={p.avatarVersion} />
                <span className="who">
                  <span className="truncate">{p.displayName}</span>
                  <span className={`role-tag ${p.role === 'OWNER' || p.role === 'MODERATOR' ? 'strong' : ''}`}>{ROLE_LABEL[p.role]}</span>
                </span>
                {canAssign && p.role !== 'OWNER' && (
                  <Menu label={`Opciones de ${p.displayName}`} items={[
                    { heading: 'Rol en la sala' },
                    ...ASSIGNABLE.map((r) => ({
                      label: `${ROLE_LABEL[r]} · ${ROLE_HINT[r]}`,
                      icon: r === p.role ? <Check size={16} /> : <span style={{ width: 16 }} />,
                      onClick: () => void assignRole(p.userId, r),
                    })),
                    'separator',
                    { label: 'Expulsar de la sala', icon: <UserX size={16} />, danger: true, onClick: () => void expel(p.userId, p.displayName) },
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
          {[...TOOLS].sort((a, b) => (pinned.includes(a.id) ? pinned.indexOf(a.id) : 999) - (pinned.includes(b.id) ? pinned.indexOf(b.id) : 999)).map((t, i) => (
            <button key={t.id} className={`tool t-${t.id} ${t.ready ? '' : 'soon'} ${pinned.includes(t.id) ? 'pinned' : ''}`} style={{ ['--i' as string]: i + 2 }} onClick={() => setActive(t.id)}>
              <span className={`ico ${t.tone ? `tinted tn-${t.tone}` : ''}`}><t.icon size={22} /></span>
              <span className="tl">
                <span>{t.label}</span>
                {!t.ready && <small>Próximamente</small>}
              </span>
              <span className="tool-pin" role="button" tabIndex={0} aria-pressed={pinned.includes(t.id)} aria-label={pinned.includes(t.id) ? `Desfijar ${t.label}` : `Fijar ${t.label} arriba`} title={pinned.includes(t.id) ? 'Quitar de fijadas' : 'Fijar arriba'}
                onClick={(e) => { e.stopPropagation(); togglePin(t.id) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePin(t.id) } }}>
                {pinned.includes(t.id) ? <PinOff size={14} /> : <Pin size={14} />}
              </span>
              {t.id === 'player' && playing && <span className="tool-badge info" title="Sonando"><span className="pl-eq"><i /><i /><i /></span></span>}
              {t.id === 'focus' && focus.state.status === 'running' && <span className="tool-badge info mono" title="Temporizador en marcha">{fmtFocus(focus.remaining)}</span>}
              {t.id === 'calendar' && calendar.today > 0 && <span className="tool-badge info" aria-label={`${calendar.today} eventos hoy`} title="Eventos de hoy">{calendar.today}</span>}
              {t.id === 'chat' && <ChatBadge />}
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

      {playerOn && (
        <Modal title="Reproductor" icon={<Tv size={20} />} wide xl flush hidden={active !== 'player'} onClose={() => setActive(null)}>
          <PlayerTool room={room} onPlaying={setPlaying} />
        </Modal>
      )}

      {tool && tool.id !== 'player' && (
        <Modal title={tool.label} icon={<tool.icon size={20} />} wide={tool.ready} xl={XL_TOOLS.has(tool.id)} flush={tool.ready} onClose={() => setActive(null)}>
          {tool.id === 'files' && <FilesTool room={room} onEditDoc={openDoc} focus={target} />}
          {tool.id === 'board' && <BoardsTool room={room} onOpen={openDoc} />}
          {tool.id === 'attendance' && <AssistTool room={room} online={online} />}
          {tool.id === 'focus' && <FocusTool room={room} focus={focus} />}
          {tool.id === 'links' && <LinksTool room={room} focus={target} />}
          {tool.id === 'calendar' && <CalendarTool room={room} focus={target} />}
          {tool.id === 'media' && <MediaReviewTool room={room} focus={target} />}
          {tool.id === 'polls' && <PollsTool room={room} focus={target} />}
          {tool.id === 'actions' && <TasksTool room={room} focus={target} />}
          {tool.id === 'chat' && <ChatTool focus={target} />}
          {tool.id === 'notes' && <NotesTool room={room} kind="NOTE" placeholder="Escribe una nota para la sala…" />}
          {!tool.ready && (
            <div className="empty">
              <tool.icon size={36} />
              <strong>Próximamente</strong>
              <span className="small">Esta herramienta llegará en una próxima versión.</span>
            </div>
          )}
        </Modal>
      )}
      <AssistOverlay />
      <ChatDock />
    </div>
    </ChatProvider>
    </AssistProvider>
  )
}

/** Insignia de mensajes sin leer sobre la tarjeta del Chat. */
function ChatBadge() {
  const { unread } = useChat()
  if (unread <= 0) return null
  return <span className="tool-badge" aria-label={`${unread} mensajes sin leer`}>{unread > 99 ? '99+' : unread}</span>
}

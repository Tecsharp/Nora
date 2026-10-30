import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RoomOptions, KeepRoomOption } from '../components/RoomSettingsDialog'
import ReactivateDialog from '../components/ReactivateDialog'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import Modal from '../components/Modal'
import { useRealtime } from '../realtime'
import { ArrowRight, ChevronDown, ClipboardList, Hourglass, Clock, Pencil, DoorOpen, FileUp, FolderOpen, Hash, HardDrive, PenTool, Plus, Settings, ShieldCheck, Sparkles, Timer, Users } from 'lucide-react'
import { api, ApiError, formatBytes, type Room, type RoomSummary, type User } from '../api'
import { useAuth } from '../auth'
import ExpiryDialog from '../components/ExpiryDialog'
import { remaining } from '../time'

interface Me {
  user: User
  storageUsedBytes: number
}

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(120)
  const [keep, setKeep] = useState(false)
  const [reactivate, setReactivate] = useState<RoomSummary | null>(null)
  const dialogs = useDialogs()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [adjust, setAdjust] = useState<RoomSummary | null>(null)
  const [opts, setOpts] = useState(false)
  const [approval, setApproval] = useState(false)
  const [defRole, setDefRole] = useState<'MEMBER' | 'VIEWER'>('MEMBER')
  const [maxP, setMaxP] = useState('')
  const [waiting, setWaiting] = useState<{ code: string; roomName: string } | null>(null)

  // El resultado llega en vivo; si se pierde el aviso, se consulta cada 6 s
  useRealtime('join.approved', () => setWaiting(null))
  useRealtime('join.denied', () => setWaiting(null))
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(async () => {
      const r = await api<{ status: string }>(`/rooms/${waiting.code}/join-status`).catch(() => null)
      if (r?.status === 'MEMBER') navigate(`/room/${waiting.code}`)
      else if (r?.status === 'NONE') {
        setWaiting(null)
        setError('No te han aceptado en esa sala.')
      }
    }, 6000)
    return () => clearInterval(t)
  }, [waiting, navigate])

  useEffect(() => {
    api<RoomSummary[]>('/rooms').then(setRooms).catch(() => setRooms([]))
    api<Me>('/me').then(setMe).catch(() => {})
  }, [])

  const reload = () => { api<RoomSummary[]>('/rooms').then(setRooms).catch(() => setRooms([])) }
  const limits = me?.user.limits ?? user?.limits
  const maxMinutes = limits?.maxRoomMinutes
  const unlimitedTime = maxMinutes === null
  const used = me?.storageUsedBytes ?? 0
  const quota = limits?.storageQuotaBytes ?? null
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0

  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const room = await api<Room>('/rooms', 'POST', {
        name, minutes, requireApproval: approval, defaultRole: defRole, maxParticipants: maxP.trim() ? Number(maxP) : undefined, keepWhenExpired: keep,
      })
      navigate(`/room/${room.code}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al crear la sala')
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const res = await api<Room | { pending: true; roomName: string; code: string }>('/rooms/join', 'POST', { code: code.trim() })
      if ('pending' in res) setWaiting({ code: res.code, roomName: res.roomName })
      else navigate(`/room/${res.code}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al unirse a la sala')
    }
  }

  const first = user?.displayName?.split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'
  const activeRooms = rooms?.filter((r) => !r.inactive) ?? null
  const inactiveRooms = rooms?.filter((r) => r.inactive) ?? []
  const mine = activeRooms?.filter((r) => r.isOwner).length ?? 0
  const soonest = activeRooms?.filter((r) => r.expiresAt).sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())[0]

  return (
    <div className="home">
      <section className="home-hero">
        <div className="stack tight">
          <span className="eyebrow">{greeting}</span>
          <h1>{first}, ¿con quién colaboras hoy?</h1>
          <p className="muted">Salas temporales para compartir archivos, escribir documentos, dibujar en pizarras y tomar notas en tiempo real. Todo se borra solo cuando termina la sala.</p>
        </div>
        <div className="home-kpis">
          <div><b>{activeRooms?.length ?? '–'}</b><span>salas activas</span></div>
          <div><b>{mine}</b><span>son tuyas</span></div>
          <div><b className="kpi-time">{soonest ? remaining(soonest.expiresAt).replace(/^Expira en /, '') : '∞'}</b><span>{soonest ? `hasta que expire «${soonest.name}»` : 'sin salas por expirar'}</span></div>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="home-grid">
        <div className="home-main">
          <section className="card">
            <div className="section-title">
              <h2>Mis salas activas</h2>
              {activeRooms && activeRooms.length > 0 && <span className="badge">{activeRooms.length}</span>}
            </div>
            {rooms === null && <p className="muted">Cargando…</p>}
            {activeRooms?.length === 0 && (
              <div className="empty">
                <Users size={32} />
                <strong>Todavía no participas en ninguna sala</strong>
                <span className="small">Crea una desde el panel de la derecha o únete con un código.</span>
              </div>
            )}
            <ul className="room-list stagger">
              {activeRooms?.map((r, i) => (
                <li key={r.code} style={{ ['--i' as string]: i }} className="room-card-wrap">
                  <Link to={`/room/${r.code}`} className="room-card">
                    <div className="row spread nowrap">
                      <strong className="truncate">{r.name}</strong>
                      {r.isOwner && <span className="badge blue">Propietario</span>}
                    </div>
                    <span className="code">{r.code}</span>
                    <span className="muted small row" style={{ gap: 6 }}><Clock size={14} /> {remaining(r.expiresAt)}{r.keepWhenExpired && <span className="badge" title="Al expirar no se borra: queda inactiva">Se conserva</span>}</span>
                  </Link>
                  {r.isOwner && (
                    <button className="icon-btn sm room-card-act" aria-label={`Cambiar la duración de ${r.name}`} title="Extender o reducir"
                      onClick={() => setAdjust(r)}><Pencil size={14} /></button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {inactiveRooms.length > 0 && (
            <section className="card">
              <div className="section-title"><h2>Salas inactivas</h2><span className="badge">{inactiveRooms.length}</span></div>
              <p className="muted small">Expiraron pero se conservaron: no consumen conexiones en vivo y mantienen sus archivos y contenido.</p>
              <ul className="room-list">
                {inactiveRooms.map((r) => (
                  <li key={r.code} className="room-card-wrap inactive">
                    <div className="room-card">
                      <div className="row spread nowrap"><strong className="truncate">{r.name}</strong><span className="badge">Inactiva</span></div>
                      <span className="code">{r.code}</span>
                      {r.isOwner ? (
                        <span className="row">
                          <button className="btn primary sm" onClick={() => setReactivate(r)}>Reactivar</button>
                          <button className="btn danger sm" onClick={async () => {
                            if (!(await dialogs.confirm({ title: '¿Eliminar la sala?', message: <>«{r.name}» se borrará con todos sus archivos y contenido. No se puede deshacer.</>, confirmLabel: 'Eliminar', tone: 'danger', icon: 'trash', typeToConfirm: 'ELIMINAR' }))) return
                            try { await api(`/rooms/${r.code}`, 'DELETE'); reload() } catch { toast('No se pudo eliminar la sala', 'error') }
                          }}>Eliminar</button>
                        </span>
                      ) : <span className="muted small">El propietario puede reactivarla.</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {limits && (
            <section>
              <div className="section-title"><h2>Tu cuenta</h2><Link to="/settings" className="btn ghost sm"><Settings size={15} /> Ajustes</Link></div>
              <div className="stat-grid stagger">
                <div className="stat" style={{ ['--i' as string]: 0 }}>
                  <span className="ico tinted tn-blue"><HardDrive size={22} /></span>
                  <b>{formatBytes(used)} <small>/ {formatBytes(quota)}</small></b>
                  <span className="muted small">Almacenamiento</span>
                  {quota !== null && <div className="meter"><i style={{ width: `${pct}%` }} /></div>}
                </div>
                <div className="stat" style={{ ['--i' as string]: 1 }}><span className="ico tinted tn-amber"><FileUp size={22} /></span><b>{formatBytes(limits.maxFileSizeBytes)}</b><span className="muted small">Archivo máximo</span></div>
                <div className="stat" style={{ ['--i' as string]: 2 }}><span className="ico tinted tn-violet"><DoorOpen size={22} /></span><b>{mine} <small>/ {limits.maxActiveRooms ?? '∞'}</small></b><span className="muted small">Salas tuyas activas</span></div>
                <div className="stat" style={{ ['--i' as string]: 3 }}><span className="ico tinted tn-rose"><Timer size={22} /></span><b>{limits.maxRoomMinutes == null ? '∞' : `${limits.maxRoomMinutes} min`}</b><span className="muted small">Duración máxima</span></div>
              </div>
            </section>
          )}

          <section className="card home-tips">
            <h2 className="row"><Sparkles size={20} /> Qué puedes hacer en una sala</h2>
            <ul className="tip-grid">
              <li><span className="ico tinted tn-blue"><FolderOpen size={20} /></span><b>Archivos</b><span className="muted small">Sube carpetas enteras, ordénalas y edita documentos, hojas y presentaciones entre varios.</span></li>
              <li><span className="ico tinted tn-violet"><PenTool size={20} /></span><b>Pizarra</b><span className="muted small">Dibuja en equipo con cursores en vivo, bibliotecas y carpetas de pizarras.</span></li>
              <li><span className="ico tinted tn-rose"><ClipboardList size={20} /></span><b>Notas</b><span className="muted small">Notas compartidas por categorías para que nadie pierda lo importante.</span></li>
              <li><span className="ico tinted tn-teal"><ShieldCheck size={20} /></span><b>Control</b><span className="muted small">Roles, aprobación de entradas y expulsión; la sala se borra sola al expirar.</span></li>
            </ul>
          </section>
        </div>

        <aside className="home-side" aria-label="Crear o unirse">
          <form className="card stack" onSubmit={join}>
            <h2 className="row"><DoorOpen size={20} /> Unirse con código</h2>
            <div className="input-icon">
              <Hash size={16} />
              <input required maxLength={12} placeholder="NX-ABC123" aria-label="Código de la sala" autoCapitalize="characters" autoComplete="off"
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
            <button className="btn block">Unirse <ArrowRight size={16} /></button>
          </form>
          <form className="card stack" onSubmit={create}>
            <h2 className="row"><Plus size={20} /> Crear sala</h2>
            <label>
              Nombre
              <input required maxLength={80} placeholder="Sala de colaboración" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Duración
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[30, 60, 120, 240, 720, 1440]
                  .filter((m) => maxMinutes == null || m <= maxMinutes)
                  .map((m) => (
                    <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>
                  ))}
                {unlimitedTime && <option value={0}>Sin expiración</option>}
              </select>
            </label>
            <KeepRoomOption keep={keep} setKeep={setKeep} />
            <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} aria-expanded={opts} onClick={() => setOpts((o) => !o)}>
              <ChevronDown size={15} style={{ transform: opts ? 'rotate(180deg)' : undefined, transition: 'transform .25s' }} /> Opciones de la sala
            </button>
            {opts && (
              <div className="swap">
                <RoomOptions approval={approval} setApproval={setApproval} role={defRole} setRole={setDefRole} max={maxP} setMax={setMaxP} cap={limits?.maxParticipants} />
              </div>
            )}
            <button className="btn primary block">Crear sala</button>
          </form>
        </aside>
      </div>

      {waiting && (
        <Modal title="Esperando confirmación" icon={<Hourglass size={20} />} onClose={() => setWaiting(null)}
          footer={<button className="btn" onClick={async () => { await api(`/rooms/${waiting.code}/join-request`, 'DELETE').catch(() => {}); setWaiting(null) }}>Cancelar solicitud</button>}>
          <div className="empty">
            <Hourglass size={36} />
            <strong>«{waiting.roomName}» pide aprobación</strong>
            <span className="small">Avisamos al propietario. Entrarás en cuanto te acepte; puedes dejar esta ventana abierta.</span>
          </div>
        </Modal>
      )}

      {reactivate && <ReactivateDialog code={reactivate.code} name={reactivate.name} onClose={() => setReactivate(null)} onDone={reload} />}

      {adjust && (
        <ExpiryDialog code={adjust.code} name={adjust.name} expiresAt={adjust.expiresAt} onClose={() => setAdjust(null)}
          onChanged={(expiresAt) => setRooms((all) => all && all.map((x) => (x.code === adjust.code ? { ...x, expiresAt } : x)))} />
      )}

    </div>
  )
}

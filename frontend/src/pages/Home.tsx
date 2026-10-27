import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RoomOptions } from '../components/RoomSettingsDialog'
import Modal from '../components/Modal'
import { useRealtime } from '../realtime'
import { ArrowRight, ChevronDown, Hourglass, Clock, Pencil, DoorOpen, FileUp, Hash, HardDrive, Plus, Timer, Users } from 'lucide-react'
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
        name, minutes, requireApproval: approval, defaultRole: defRole, maxParticipants: maxP.trim() ? Number(maxP) : undefined,
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

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="hero">
        <h1>Hola, {user?.displayName?.split(' ')[0]}</h1>
        <p>Crea una sala temporal o únete con un código para colaborar.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="grid-2">
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
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} aria-expanded={opts} onClick={() => setOpts((o) => !o)}>
            <ChevronDown size={15} style={{ transform: opts ? 'rotate(180deg)' : undefined, transition: 'transform .25s' }} /> Opciones de la sala
          </button>
          {opts && (
            <div className="swap">
              <RoomOptions approval={approval} setApproval={setApproval} role={defRole} setRole={setDefRole} max={maxP} setMax={setMaxP} cap={limits?.maxParticipants} />
            </div>
          )}
          <button className="btn primary">Crear sala</button>
        </form>
        <form className="card stack" onSubmit={join}>
          <h2 className="row"><DoorOpen size={20} /> Unirse con código</h2>
          <label>
            Código de la sala
            <div className="input-icon">
              <Hash size={16} />
              <input required maxLength={12} placeholder="NX-ABC123" autoCapitalize="characters" autoComplete="off"
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
          </label>
          <p className="muted small">Pídele el código a quien creó la sala. Verás su contenido mientras siga activa.</p>
          <button className="btn" style={{ marginTop: 'auto' }}>Unirse <ArrowRight size={16} /></button>
        </form>
      </div>

      <section className="card">
        <div className="section-title">
          <h2>Mis salas activas</h2>
          {rooms && rooms.length > 0 && <span className="badge">{rooms.length}</span>}
        </div>
        {rooms === null && <p className="muted">Cargando…</p>}
        {rooms?.length === 0 && (
          <div className="empty">
            <Users size={32} />
            <strong>Todavía no participas en ninguna sala</strong>
            <span className="small">Crea una arriba o únete con un código.</span>
          </div>
        )}
        <ul className="room-list stagger">
          {rooms?.map((r, i) => (
            <li key={r.code} style={{ ['--i' as string]: i }} className="room-card-wrap">
              <Link to={`/room/${r.code}`} className="room-card">
                <div className="row spread nowrap">
                  <strong className="truncate">{r.name}</strong>
                  {r.isOwner && <span className="badge blue">Propietario</span>}
                </div>
                <span className="code">{r.code}</span>
                <span className="muted small row" style={{ gap: 6 }}><Clock size={14} /> {remaining(r.expiresAt)}</span>
              </Link>
              {r.isOwner && (
                <button className="icon-btn sm room-card-act" aria-label={`Cambiar la duración de ${r.name}`} title="Extender o reducir"
                  onClick={() => setAdjust(r)}><Pencil size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      </section>

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

      {adjust && (
        <ExpiryDialog code={adjust.code} name={adjust.name} expiresAt={adjust.expiresAt} onClose={() => setAdjust(null)}
          onChanged={(expiresAt) => setRooms((all) => all && all.map((x) => (x.code === adjust.code ? { ...x, expiresAt } : x)))} />
      )}

      {limits && (
        <section>
          <div className="section-title"><h2>Tu cuenta</h2></div>
          <div className="stat-grid stagger">
            <div className="stat" style={{ ['--i' as string]: 0 }}>
              <span className="ico tinted tn-blue"><HardDrive size={22} /></span>
              <b>{formatBytes(used)} <small>/ {formatBytes(quota)}</small></b>
              <span className="muted small">Almacenamiento</span>
              {quota !== null && <div className="meter"><i style={{ width: `${pct}%` }} /></div>}
            </div>
            <div className="stat" style={{ ['--i' as string]: 1 }}><span className="ico tinted tn-amber"><FileUp size={22} /></span><b>{formatBytes(limits.maxFileSizeBytes)}</b><span className="muted small">Archivo máximo</span></div>
            <div className="stat" style={{ ['--i' as string]: 2 }}><span className="ico tinted tn-violet"><DoorOpen size={22} /></span><b>{limits.maxActiveRooms ?? '∞'}</b><span className="muted small">Salas activas</span></div>
            <div className="stat" style={{ ['--i' as string]: 3 }}><span className="ico tinted tn-rose"><Timer size={22} /></span><b>{limits.maxRoomMinutes == null ? '∞' : `${limits.maxRoomMinutes} min`}</b><span className="muted small">Duración máxima</span></div>
          </div>
        </section>
      )}
    </div>
  )
}

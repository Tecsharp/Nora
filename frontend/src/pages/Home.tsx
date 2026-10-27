import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Clock, DoorOpen, Hash, Plus, Users } from 'lucide-react'
import { api, ApiError, formatBytes, type Room, type RoomSummary, type User } from '../api'
import { useAuth } from '../auth'
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
      const room = await api<Room>('/rooms', 'POST', { name, minutes })
      navigate(`/room/${room.code}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al crear la sala')
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const room = await api<Room>('/rooms/join', 'POST', { code: code.trim() })
      navigate(`/room/${room.code}`)
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
        <ul className="room-list">
          {rooms?.map((r) => (
            <li key={r.code}>
              <Link to={`/room/${r.code}`} className="room-card">
                <div className="row spread nowrap">
                  <strong className="truncate">{r.name}</strong>
                  {r.isOwner && <span className="badge blue">Propietario</span>}
                </div>
                <span className="code">{r.code}</span>
                <span className="muted small row" style={{ gap: 6 }}><Clock size={14} /> {remaining(r.expiresAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {limits && (
        <section className="card">
          <div className="section-title"><h2>Tu cuenta</h2></div>
          <div className="stat-grid">
            <div className="stat">
              <span className="muted small">Almacenamiento</span>
              <b>{formatBytes(used)} <span className="muted small">/ {formatBytes(quota)}</span></b>
              {quota !== null && <div className="meter"><i style={{ width: `${pct}%` }} /></div>}
            </div>
            <div className="stat"><span className="muted small">Archivo máximo</span><b>{formatBytes(limits.maxFileSizeBytes)}</b></div>
            <div className="stat"><span className="muted small">Salas activas</span><b>{limits.maxActiveRooms ?? '∞'}</b></div>
            <div className="stat"><span className="muted small">Duración máxima</span><b>{limits.maxRoomMinutes == null ? '∞' : `${limits.maxRoomMinutes} min`}</b></div>
          </div>
        </section>
      )}
    </div>
  )
}

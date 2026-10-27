import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(120)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api<RoomSummary[]>('/rooms').then(setRooms).catch(() => {})
    api<Me>('/me').then(setMe).catch(() => {})
  }, [])

  const limits = me?.user.limits ?? user?.limits
  const maxMinutes = limits?.maxRoomMinutes
  const unlimitedTime = maxMinutes === null

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
    <div className="stack">
      {error && <p className="error" role="alert">{error}</p>}
      <div className="grid-2">
        <form className="card stack" onSubmit={create}>
          <h2>Crear sala</h2>
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
          <h2>Unirse con código</h2>
          <label>
            Código
            <input required maxLength={12} placeholder="NX-ABC123" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          <button className="btn">Unirse</button>
        </form>
      </div>

      <section className="card stack">
        <h2>Mis salas activas</h2>
        {rooms.length === 0 && <p className="muted">Todavía no participas en ninguna sala.</p>}
        <ul className="list">
          {rooms.map((r) => (
            <li key={r.code}>
              <Link to={`/room/${r.code}`}>
                <strong>{r.name}</strong>
                <span className="muted small">{r.code} · {remaining(r.expiresAt)}{r.isOwner ? ' · propietario' : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {limits && (
        <section className="card">
          <h2>Tu cuenta</h2>
          <p className="muted small">
            Almacenamiento: {formatBytes(me?.storageUsedBytes ?? 0)} de {formatBytes(limits.storageQuotaBytes)} · Archivo máx.:{' '}
            {formatBytes(limits.maxFileSizeBytes)} · Salas activas: {limits.maxActiveRooms ?? '∞'} · Duración máx.:{' '}
            {limits.maxRoomMinutes == null ? '∞' : `${limits.maxRoomMinutes} min`}
          </p>
        </section>
      )}
    </div>
  )
}

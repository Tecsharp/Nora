import { useState } from 'react'
import { Clock, Infinity as InfinityIcon, Minus, Plus } from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { remaining } from '../time'
import Modal from './Modal'
import { fmtDateTime } from '../dates'

const QUICK = [-60, -30, -10, 10, 30, 60, 120, 360]
const label = (m: number) => `${m > 0 ? '+' : '−'}${Math.abs(m) >= 60 ? `${Math.abs(m) / 60} h` : `${Math.abs(m)} min`}`

interface Props {
  code: string
  name: string
  expiresAt: string | null
  onClose: () => void
  onChanged: (expiresAt: string | null) => void
}

/** Extiende o reduce la duración de una sala. */
export default function ExpiryDialog({ code, name, expiresAt, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const [current, setCurrent] = useState(expiresAt)
  const [custom, setCustom] = useState(45)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canUnlimited = user?.role === 'ADMIN' || user?.limits.maxRoomMinutes == null

  async function apply(body: { deltaMinutes?: number; unlimited?: boolean }) {
    setBusy(true)
    setError('')
    try {
      const room = await api<Room>(`/rooms/${code}/expiry`, 'PATCH', body)
      setCurrent(room.expiresAt)
      onChanged(room.expiresAt)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la duración')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Duración de la sala" icon={<Clock size={20} />} onClose={onClose}
      footer={<button className="btn primary" onClick={onClose}>Listo</button>}>
      <div>
        <p className="muted small">{name}</p>
        <p className="room-title" style={{ fontSize: '1.5rem', marginTop: 4 }}>{remaining(current)}</p>
        {current && <p className="muted small">Termina el {fmtDateTime(current)}</p>}
      </div>

      <div className="stack tight">
        <span className="eyebrow">Ajuste rápido</span>
        <div className="quick-grid">
          {QUICK.map((m) => (
            <button key={m} className={`btn sm ${m < 0 ? 'danger-soft' : ''}`} disabled={busy} onClick={() => void apply({ deltaMinutes: m })}>
              {label(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="stack tight">
        <span className="eyebrow">Minutos a medida</span>
        <div className="row nowrap">
          <input type="number" min={1} max={10080} value={custom} aria-label="Minutos" style={{ maxWidth: 120 }}
            onChange={(e) => setCustom(Math.max(1, Math.min(10080, Number(e.target.value) || 1)))} />
          <button className="btn" disabled={busy} onClick={() => void apply({ deltaMinutes: custom })}><Plus size={15} /> Extender</button>
          <button className="btn" disabled={busy} onClick={() => void apply({ deltaMinutes: -custom })}><Minus size={15} /> Reducir</button>
        </div>
      </div>

      {canUnlimited && current && (
        <button className="btn" disabled={busy} onClick={() => void apply({ unlimited: true })}><InfinityIcon size={16} /> Quitar la expiración</button>
      )}
      {!canUnlimited && user?.limits.maxRoomMinutes != null && (
        <p className="muted small">Tu cuenta permite salas de hasta {user.limits.maxRoomMinutes} minutos en total.</p>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
    </Modal>
  )
}

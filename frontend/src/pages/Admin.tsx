import { useEffect, useState } from 'react'
import { api, ApiError, formatBytes, type Limits, type User } from '../api'
import { useAuth } from '../auth'

interface Row {
  user: User
  storageUsedBytes: number
}

const MB = 1024 * 1024

/** Campo numérico con casilla "∞": vacío/∞ = sin límite (null). */
function LimitField({ label, value, onChange, unit }: { label: string; value: number | null; onChange: (v: number | null) => void; unit: string }) {
  return (
    <div className="limit">
      <span>{label}</span>
      <div className="row">
        <input type="number" min={0} disabled={value === null} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="muted small">{unit}</span>
        <label className="check">
          <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : 1)} /> ∞
        </label>
      </div>
    </div>
  )
}

function UserEditor({ row, self, onSaved }: { row: Row; self: boolean; onSaved: (r: Row) => void }) {
  const [role, setRole] = useState(row.user.role)
  const [enabled, setEnabled] = useState(row.user.enabled)
  const [storageMb, setStorageMb] = useState<number | null>(toMb(row.user.limits.storageQuotaBytes))
  const [fileMb, setFileMb] = useState<number | null>(toMb(row.user.limits.maxFileSizeBytes))
  const [minutes, setMinutes] = useState<number | null>(row.user.limits.maxRoomMinutes)
  const [rooms, setRooms] = useState<number | null>(row.user.limits.maxActiveRooms)
  const [participants, setParticipants] = useState<number | null>(row.user.limits.maxParticipants)
  const [msg, setMsg] = useState('')

  async function save() {
    setMsg('')
    const body: Limits & { role: string; enabled: boolean } = {
      role,
      enabled,
      storageQuotaBytes: storageMb === null ? null : storageMb * MB,
      maxFileSizeBytes: fileMb === null ? null : fileMb * MB,
      maxRoomMinutes: minutes,
      maxActiveRooms: rooms,
      maxParticipants: participants,
    }
    try {
      onSaved(await api<Row>(`/admin/users/${row.user.id}`, 'PUT', body))
      setMsg('Guardado')
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al guardar')
    }
  }

  return (
    <div className="card stack">
      <div className="row spread">
        <div>
          <strong>{row.user.displayName}</strong> <span className="muted small">{row.user.email}</span>
        </div>
        <span className="muted small">Usado: {formatBytes(row.storageUsedBytes)}</span>
      </div>
      <div className="limits">
        <LimitField label="Espacio total" unit="MB" value={storageMb} onChange={setStorageMb} />
        <LimitField label="Tamaño máx. de archivo" unit="MB" value={fileMb} onChange={setFileMb} />
        <LimitField label="Duración máx. de sala" unit="min" value={minutes} onChange={setMinutes} />
        <LimitField label="Salas activas" unit="" value={rooms} onChange={setRooms} />
        <LimitField label="Participantes por sala" unit="" value={participants} onChange={setParticipants} />
      </div>
      <div className="row">
        <label className="check">
          Rol{' '}
          <select value={role} disabled={self} onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}>
            <option value="USER">Usuario</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={enabled} disabled={self} onChange={(e) => setEnabled(e.target.checked)} /> Cuenta activa
        </label>
        <button className="btn primary" onClick={save}>Guardar</button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </div>
  )
}

const toMb = (b: number | null) => (b === null ? null : Math.round(b / MB))

export default function Admin() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<Row[]>('/admin/users').then(setRows).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="stack">
      <h2>Usuarios</h2>
      <p className="muted small">Marca ∞ para dar espacio, tiempo o salas ilimitadas a un usuario.</p>
      {error && <p className="error">{error}</p>}
      {rows.map((r) => (
        <UserEditor key={r.user.id} row={r} self={r.user.id === user?.id}
          onSaved={(n) => setRows((all) => all.map((x) => (x.user.id === n.user.id ? n : x)))} />
      ))}
    </div>
  )
}

import { useState } from 'react'
import { Settings } from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import Modal from './Modal'

/** Opciones de la sala que puede cambiar su propietario. */
export default function RoomSettingsDialog({ room, onClose, onSaved }: { room: Room; onClose: () => void; onSaved: (r: Room) => void }) {
  const { user } = useAuth()
  const [approval, setApproval] = useState(room.settings.requireApproval)
  const [role, setRole] = useState(room.settings.defaultRole)
  const [max, setMax] = useState(room.settings.maxParticipants ? String(room.settings.maxParticipants) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cap = user?.limits.maxParticipants

  async function save() {
    setBusy(true)
    setError('')
    try {
      const updated = await api<Room>(`/rooms/${room.code}/settings`, 'PATCH', {
        requireApproval: approval,
        defaultRole: role,
        maxParticipants: max.trim() === '' ? 0 : Number(max),
      })
      onSaved(updated)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar las opciones')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Opciones de la sala" icon={<Settings size={20} />} onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      }>
      <RoomOptions approval={approval} setApproval={setApproval} role={role} setRole={setRole} max={max} setMax={setMax} cap={cap} />
      {error && <p className="error small" role="alert">{error}</p>}
    </Modal>
  )
}

interface OptionsProps {
  approval: boolean
  setApproval: (v: boolean) => void
  role: string
  setRole: (v: 'MEMBER' | 'VIEWER') => void
  max: string
  setMax: (v: string) => void
  cap?: number | null
}

/** Campos de opciones, compartidos entre «Crear sala» y los ajustes de una sala existente. */
export function RoomOptions({ approval, setApproval, role, setRole, max, setMax, cap }: OptionsProps) {
  return (
    <div className="stack">
      <label className="check opt">
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
        <span>
          <strong>Pedir confirmación para entrar</strong>
          <span className="muted small block">Quien use el código queda en espera hasta que tú lo aceptes.</span>
        </span>
      </label>
      <label>
        Rol de quienes entran
        <select value={role} onChange={(e) => setRole(e.target.value as 'MEMBER' | 'VIEWER')}>
          <option value="MEMBER">Colaborador: puede subir y escribir</option>
          <option value="VIEWER">Lector: solo ve y descarga</option>
        </select>
      </label>
      <label>
        Límite de participantes
        <input type="number" min={2} max={cap ?? undefined} placeholder={cap ? `Hasta ${cap}` : 'Sin límite'} value={max}
          onChange={(e) => setMax(e.target.value)} />
      </label>
    </div>
  )
}

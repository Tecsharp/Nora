import { useState } from 'react'
import { Power } from 'lucide-react'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import Modal from './Modal'

/** Reactiva una sala conservada (inactiva) con una nueva duración. */
export default function ReactivateDialog({ code, name, onClose, onDone }: { code: string; name: string; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const max = user?.limits.maxRoomMinutes
  const [minutes, setMinutes] = useState(120)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await api(`/rooms/${code}/reactivate`, 'POST', { minutes })
      toast(`«${name}» vuelve a estar activa`, 'success')
      onDone()
      onClose()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo reactivar la sala', 'error')
      setBusy(false)
    }
  }
  return (
    <Modal title="Reactivar la sala" icon={<Power size={20} />} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? 'Reactivando…' : 'Reactivar'}</button></>}>
      <div className="stack">
        <p>«{name}» conserva todos sus archivos y contenido. Al reactivarla volverá a tener conexiones en vivo durante el tiempo que elijas.</p>
        <label>Duración
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[30, 60, 120, 240, 720, 1440].filter((m) => max == null || m <= max).map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}
            {max == null && <option value={0}>Sin expiración</option>}
          </select>
        </label>
      </div>
    </Modal>
  )
}

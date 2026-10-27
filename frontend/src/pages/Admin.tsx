import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Shield } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, ApiError, formatBytes, type Limits, type User } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'

interface Row {
  user: User
  storageUsedBytes: number
}

interface Page {
  items: Row[]
  total: number
  page: number
  size: number
}

const MB = 1024 * 1024
const toMb = (b: number | null) => (b === null ? null : Math.round(b / MB))
const fmt = (n: number | null, unit = '') => (n === null ? '∞' : `${n}${unit}`)

/** Campo numérico con casilla "∞": ∞ = sin límite (null). */
function LimitField({ label, value, onChange, unit, min = 0 }: { label: string; value: number | null; onChange: (v: number | null) => void; unit: string; min?: number }) {
  return (
    <div className="limit">
      <span>{label}</span>
      <div className="row">
        <input type="number" min={min} aria-label={label} disabled={value === null} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="unit">{unit}</span>
        <label className="check">
          <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : Math.max(min, 1))} /> ∞
        </label>
      </div>
    </div>
  )
}

function UserEditor({ row, self, onSaved, onClose }: { row: Row; self: boolean; onSaved: (r: Row) => void; onClose: () => void }) {
  const [role, setRole] = useState(row.user.role)
  const [enabled, setEnabled] = useState(row.user.enabled)
  const [storageMb, setStorageMb] = useState<number | null>(toMb(row.user.limits.storageQuotaBytes))
  const [fileMb, setFileMb] = useState<number | null>(toMb(row.user.limits.maxFileSizeBytes))
  const [minutes, setMinutes] = useState<number | null>(row.user.limits.maxRoomMinutes)
  const [rooms, setRooms] = useState<number | null>(row.user.limits.maxActiveRooms)
  const [participants, setParticipants] = useState<number | null>(row.user.limits.maxParticipants)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setMsg('')
    setBusy(true)
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
      onClose()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={row.user.displayName} onClose={onClose} footer={
      <>
        {msg && <span className="error small grow">{msg}</span>}
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </>
    }>
      <div className="row">
        <Avatar name={row.user.displayName} />
        <div>
          <div className="small">{row.user.email}</div>
          <div className="muted small">Usado: {formatBytes(row.storageUsedBytes)} · Alta: {new Date(row.user.createdAt).toLocaleDateString()}</div>
        </div>
      </div>
      <p className="muted small">Marca ∞ para dar espacio, tiempo o salas ilimitadas.</p>
      <div className="limits">
        <LimitField label="Espacio total" unit="MB" value={storageMb} onChange={setStorageMb} />
        <LimitField label="Tamaño máx. de archivo" unit="MB" value={fileMb} onChange={setFileMb} />
        <LimitField label="Duración máx. de sala" unit="min" value={minutes} onChange={setMinutes} min={1} />
        <LimitField label="Salas activas" unit="" value={rooms} onChange={setRooms} />
        <LimitField label="Participantes por sala" unit="" value={participants} onChange={setParticipants} min={1} />
      </div>
      <div className="grid-2">
        <label>
          Rol
          <select value={role} disabled={self} onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}>
            <option value="USER">Usuario</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>
        <label className="check" style={{ alignSelf: 'end', minHeight: 44 }}>
          <input type="checkbox" checked={enabled} disabled={self} onChange={(e) => setEnabled(e.target.checked)} /> Cuenta activa
        </label>
      </div>
      {self && <p className="muted small">No puedes cambiar tu propio rol ni desactivarte.</p>}
    </Modal>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const [data, setData] = useState<Page>({ items: [], total: 0, page: 0, size: 20 })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)

  // Búsqueda con retardo para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(query)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), size: String(size), q: term })
    if (role) params.set('role', role)
    api<Page>(`/admin/users?${params}`)
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar'))
      .finally(() => setLoading(false))
  }, [page, size, term, role])
  useEffect(load, [load])

  const pages = Math.max(1, Math.ceil(data.total / size))
  const from = data.total === 0 ? 0 : page * size + 1
  const to = Math.min(data.total, (page + 1) * size)

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div>
        <Link to="/" className="btn ghost sm"><ArrowLeft size={15} /> Volver al inicio</Link>
      </div>
      <div className="hero">
        <h1 className="row"><Shield size={26} /> Usuarios</h1>
        <p>{data.total} {data.total === 1 ? 'cuenta' : 'cuentas'} · toca una fila para editar sus límites.</p>
      </div>

      <div className="row">
        <div className="input-icon grow" style={{ maxWidth: 360 }}>
          <Search size={15} />
          <input type="search" placeholder="Buscar por nombre o correo…" aria-label="Buscar usuarios" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="page-size" aria-label="Filtrar por rol" value={role} onChange={(e) => { setRole(e.target.value); setPage(0) }}>
          <option value="">Todos los roles</option>
          <option value="USER">Usuarios</option>
          <option value="ADMIN">Administradores</option>
        </select>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="table-wrap" aria-busy={loading}>
        <table className="table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th className="hide-md">Rol</th>
              <th className="hide-md">Estado</th>
              <th className="num">Uso</th>
              <th className="num hide-md">Espacio</th>
              <th className="num hide-md">Salas</th>
              <th className="num hide-md">Duración</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.user.id} tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === 'Enter' && setEditing(r)}>
                <td>
                  <div className="user-cell">
                    <Avatar name={r.user.displayName} />
                    <div className="who">
                      <strong className="truncate">{r.user.displayName}{r.user.id === user?.id && <span className="muted small"> (tú)</span>}</strong>
                      <span className="muted small truncate">{r.user.email}</span>
                      <span className="show-md row" style={{ gap: 6, marginTop: 4 }}>
                        <span className={`badge ${r.user.role === 'ADMIN' ? 'blue' : ''}`}>{r.user.role === 'ADMIN' ? 'Admin' : 'Usuario'}</span>
                        {!r.user.enabled && <span className="badge red">Desactivada</span>}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="hide-md"><span className={`badge ${r.user.role === 'ADMIN' ? 'blue' : ''}`}>{r.user.role === 'ADMIN' ? 'Admin' : 'Usuario'}</span></td>
                <td className="hide-md"><span className={`badge ${r.user.enabled ? 'green' : 'red'}`}><i /> {r.user.enabled ? 'Activa' : 'Desactivada'}</span></td>
                <td className="num">{formatBytes(r.storageUsedBytes)}</td>
                <td className="num hide-md">{formatBytes(r.user.limits.storageQuotaBytes)}</td>
                <td className="num hide-md">{fmt(r.user.limits.maxActiveRooms)}</td>
                <td className="num hide-md">{fmt(r.user.limits.maxRoomMinutes, ' min')}</td>
              </tr>
            ))}
            {!loading && data.items.length === 0 && (
              <tr style={{ cursor: 'default' }}><td colSpan={7} className="muted center-text" style={{ padding: 32 }}>No se encontraron usuarios.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>{from}–{to} de {data.total}</span>
        <div className="row">
          <select className="page-size" aria-label="Filas por página" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
          </select>
          <button className="icon-btn" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={18} /></button>
          <span>Página {page + 1} de {pages}</span>
          <button className="icon-btn" aria-label="Página siguiente" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={18} /></button>
        </div>
      </div>

      {editing && (
        <UserEditor row={editing} self={editing.user.id === user?.id} onClose={() => setEditing(null)}
          onSaved={(n) => setData((d) => ({ ...d, items: d.items.map((x) => (x.user.id === n.user.id ? n : x)) }))} />
      )}
    </div>
  )
}

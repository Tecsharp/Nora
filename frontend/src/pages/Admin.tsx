import { useCallback, useEffect, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, Copy, Cog, HardDrive, KeyRound, Library, LogOut, Plus, RefreshCw, Search, Shield, Trash2, Users } from 'lucide-react'
import { api, ApiError, formatBytes, type Limits, type User } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import BackButton from '../components/BackButton'
import Tabs from '../components/Tabs'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import AdminLibraries from '../components/AdminLibraries'

interface Row {
  user: User
  storageUsedBytes: number
}

interface StorageStats {
  available: boolean
  objects: number
  bytes: number
  dbFiles: number
  pendingDeletions: number
  error: string | null
}

/** Estado de Garage y limpieza manual de objetos huérfanos. */
function StorageCard() {
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    api<StorageStats>('/admin/storage').then(setStats).catch(() => setStats(null))
  }, [])
  useEffect(load, [load])

  async function sweep() {
    setBusy(true)
    setMsg('')
    try {
      const r = await api<{ scanned: number; orphans: number; deleted: number; failed: number }>('/admin/storage/sweep', 'POST')
      setMsg(r.orphans === 0 ? `Todo en orden: ${r.scanned} objetos revisados, ninguno huérfano.` : `${r.deleted} de ${r.orphans} objetos huérfanos eliminados${r.failed ? ` (${r.failed} fallaron)` : ''}.`)
      load()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'No se pudo completar la limpieza')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack tight">
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h3 className="row"><HardDrive size={18} /> Almacenamiento (Garage)</h3>
        <div className="row">
          <button className="icon-btn" aria-label="Actualizar" onClick={load}><RefreshCw size={16} /></button>
          <button className="btn sm" disabled={busy} onClick={sweep}>{busy ? 'Limpiando…' : 'Revisar y limpiar huérfanos'}</button>
        </div>
      </div>
      {!stats ? (
        <p className="muted small">Cargando…</p>
      ) : !stats.available ? (
        <p className="error small">Garage no responde: {stats.error}. Los borrados quedan pendientes ({stats.pendingDeletions}) y se reintentan solos.</p>
      ) : (
        <div className="stat-grid">
          <div className="stat"><b>{stats.objects}</b><span className="muted small">Objetos en Garage</span></div>
          <div className="stat"><b>{formatBytes(stats.bytes)}</b><span className="muted small">Ocupado</span></div>
          <div className="stat"><b>{stats.dbFiles}</b><span className="muted small">Archivos en la base de datos</span></div>
          <div className="stat"><b>{stats.pendingDeletions}</b><span className="muted small">Borrados pendientes</span></div>
        </div>
      )}
      {msg && <p className="small muted" role="status">{msg}</p>}
      <p className="muted small">Al borrar un archivo, una carpeta o una sala, el objeto se elimina de Garage; si Garage no responde, queda pendiente y se reintenta cada 2 minutos. Cada 6 horas se concilia el almacén con la base de datos y se borran los huérfanos de más de 1 hora.</p>
    </section>
  )
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

function UserEditor({ row, self, onSaved, onDeleted, onClose }: { row: Row; self: boolean; onSaved: (r: Row) => void; onDeleted: (id: string) => void; onClose: () => void }) {
  const toast = useToast()
  const dialogs = useDialogs()
  const [role, setRole] = useState(row.user.role)
  const [enabled, setEnabled] = useState(row.user.enabled)
  const [storageMb, setStorageMb] = useState<number | null>(toMb(row.user.limits.storageQuotaBytes))
  const [fileMb, setFileMb] = useState<number | null>(toMb(row.user.limits.maxFileSizeBytes))
  const [minutes, setMinutes] = useState<number | null>(row.user.limits.maxRoomMinutes)
  const [rooms, setRooms] = useState<number | null>(row.user.limits.maxActiveRooms)
  const [participants, setParticipants] = useState<number | null>(row.user.limits.maxParticipants)
  const [name, setName] = useState(row.user.displayName)
  const [email, setEmail] = useState(row.user.email)
  const [link, setLink] = useState<string | null>(null)
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
      let saved = await api<Row>(`/admin/users/${row.user.id}`, 'PUT', body)
      if (name.trim() !== row.user.displayName || email.trim().toLowerCase() !== row.user.email) {
        saved = await api<Row>(`/admin/users/${row.user.id}/profile`, 'PATCH', { displayName: name.trim(), email: email.trim() })
      }
      onSaved(saved)
      onClose()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  async function resetLink() {
    try {
      const l = await api<{ token: string; expiresAt: string }>(`/admin/users/${row.user.id}/reset-link`, 'POST')
      setLink(`${window.location.origin}/reset-password?token=${l.token}`)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'No se pudo crear el enlace', 'error')
    }
  }

  async function revoke() {
    if (!await dialogs.confirm({ title: `¿Cerrar las sesiones de ${row.user.displayName}?`, message: 'Se le sacará de Nora en todos sus dispositivos y tendrá que volver a iniciar sesión.', confirmLabel: 'Cerrar sesiones', tone: 'warning', icon: 'info' })) return
    await api(`/admin/users/${row.user.id}/revoke-sessions`, 'POST').catch((e) => toast(e.message, 'error'))
    toast('Sesiones cerradas', 'success')
  }

  async function remove() {
    if (!await dialogs.confirm({ title: `¿Borrar la cuenta de ${row.user.displayName}?`, message: <>Se eliminarán <b>sus salas con todo su contenido</b> y todo lo que haya subido o creado, de forma definitiva.</>, confirmLabel: 'Borrar cuenta', tone: 'danger', icon: 'user-x', typeToConfirm: 'BORRAR' })) return
    try {
      await api(`/admin/users/${row.user.id}`, 'DELETE')
      toast('Cuenta eliminada', 'success')
      onDeleted(row.user.id)
      onClose()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'No se pudo borrar', 'error')
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
        <Avatar name={row.user.displayName} userId={row.user.id} version={row.user.avatarVersion} size={44} />
        <div>
          <div className="small">{row.user.email}</div>
          <div className="muted small">Usado: {formatBytes(row.storageUsedBytes)} · Alta: {new Date(row.user.createdAt).toLocaleDateString()} · Último acceso: {row.user.lastLoginAt ? new Date(row.user.lastLoginAt).toLocaleString() : 'nunca'}</div>
        </div>
      </div>
      <div className="grid-2">
        <label>Nombre<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <label>Correo<input type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></label>
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
          <input type="checkbox" checked={enabled} disabled={self} onChange={(e) => setEnabled(e.target.checked)} /> Cuenta activa (revocar el acceso = desmarcar)
        </label>
      </div>
      {self && <p className="muted small">No puedes cambiar tu propio rol ni desactivarte.</p>}
      <div className="admin-actions">
        <button className="btn sm" onClick={() => void resetLink()}><KeyRound size={15} /> Enlace para cambiar la contraseña</button>
        {!self && <button className="btn sm" onClick={() => void revoke()}><LogOut size={15} /> Cerrar sus sesiones</button>}
        {!self && <button className="btn sm danger" onClick={() => void remove()}><Trash2 size={15} /> Borrar cuenta</button>}
      </div>
      {link && (
        <div className="callout small stack tight">
          <span>Enlace de un solo uso, válido 24 h. Pásaselo a la persona por un canal seguro:</span>
          <div className="row nowrap"><input readOnly value={link} aria-label="Enlace" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(link); toast('Enlace copiado', 'success') }}><Copy size={15} /> Copiar</button></div>
        </div>
      )}
    </Modal>
  )
}

function NewUser({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Row) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await api<Row>('/admin/users', 'POST', { email, displayName: name, password: pw, role }))
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Nuevo usuario" icon={<Plus size={18} />} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Nombre<input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Correo<input required type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña inicial<input required type="text" autoComplete="off" minLength={10} maxLength={72} value={pw} onChange={(e) => setPw(e.target.value)} />
          <span className="muted small">La persona puede cambiarla en Ajustes. Mínimo 10 caracteres con mayúscula, minúscula y número.</span></label>
        <label>Rol<select value={role} onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}><option value="USER">Usuario</option><option value="ADMIN">Administrador</option></select></label>
        {error && <p className="error small" role="alert">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear usuario'}</button></div>
      </form>
    </Modal>
  )
}

interface Stats { users: number; admins: number; disabled: number; newUsers7d: number; active24h: number; activeRooms: number; files: number; storageBytes: number; documents: number; sessions: number; systemLibraries: number }

function Overview() {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => void api<Stats>('/admin/stats').then(setS).catch(() => undefined), [])
  if (!s) return <p className="muted">Cargando…</p>
  const cards: [string, string | number, string][] = [
    ['Cuentas', s.users, `${s.admins} administrador${s.admins === 1 ? '' : 'es'} · ${s.disabled} desactivada${s.disabled === 1 ? '' : 's'}`],
    ['Altas esta semana', s.newUsers7d, 'últimos 7 días'],
    ['Activas hoy', s.active24h, 'han iniciado sesión en 24 h'],
    ['Sesiones abiertas', s.sessions, 'dispositivos con sesión'],
    ['Salas activas', s.activeRooms, 'sin expirar'],
    ['Archivos', s.files, formatBytes(s.storageBytes)],
    ['Documentos y pizarras', s.documents, 'creados en las salas'],
    ['Bibliotecas SISTEMA', s.systemLibraries, 'visibles en todas las pizarras'],
  ]
  return <div className="stat-grid">{cards.map(([k, v, sub]) => <div key={k} className="stat"><b>{v}</b><span className="small">{k}</span><span className="muted small">{sub}</span></div>)}</div>
}

function SystemSettings() {
  const toast = useToast()
  const [cfg, setCfg] = useState<Record<string, number | boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void api<Record<string, number | boolean>>('/admin/settings').then(setCfg).catch(() => undefined), [])
  if (!cfg) return <p className="muted">Cargando…</p>
  const num = (k: string, label: string, unit: string, min = 0) => (
    <label key={k}>{label} <span className="muted small">({unit})</span>
      <input type="number" min={min} value={Number(cfg[k])} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} /></label>
  )
  async function save() {
    setBusy(true)
    try {
      setCfg(await api('/admin/settings', 'PUT', cfg))
      toast('Ajustes guardados', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card stack">
      <h3>Registro</h3>
      <label className="check"><input type="checkbox" checked={!!cfg.registrationEnabled} onChange={(e) => setCfg({ ...cfg, registrationEnabled: e.target.checked })} /> Permitir que cualquiera cree una cuenta (si no, solo las crea un administrador)</label>
      <h3>Límites de las cuentas nuevas</h3>
      <p className="muted small">Solo afectan a las cuentas que se creen a partir de ahora; las existentes se editan en su ficha.</p>
      <div className="grid-2">
        {num('storageQuotaMb', 'Espacio total', 'MB', 1)}
        {num('maxFileMb', 'Tamaño máximo de archivo', 'MB', 1)}
        {num('maxRoomMinutes', 'Duración máxima de sala', 'min', 1)}
        {num('maxActiveRooms', 'Salas activas', 'salas')}
        {num('maxParticipants', 'Participantes por sala', 'personas', 2)}
      </div>
      <div><button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar ajustes'}</button></div>
    </section>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState<Page>({ items: [], total: 0, page: 0, size: 20 })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)
  const [creating, setCreating] = useState(false)

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
      <div><BackButton /></div>
      <div className="hero">
        <h1 className="row"><Shield size={26} /> Administración</h1>
        <p>Cuentas, límites, seguridad y ajustes de todo el sistema.</p>
      </div>
      <Tabs label="Secciones de administración" value={tab} onChange={setTab}
        items={[
          { id: 'overview', label: <><Activity size={15} /> Resumen</> },
          { id: 'users', label: <><Users size={15} /> Usuarios</>, count: data.total },
          { id: 'system', label: <><Cog size={15} /> Sistema</> },
          { id: 'libraries', label: <><Library size={15} /> Bibliotecas</> },
          { id: 'storage', label: <><HardDrive size={15} /> Almacenamiento</> },
        ]} />

      {tab === 'overview' && <Overview />}
      {tab === 'system' && <SystemSettings />}
      {tab === 'libraries' && <AdminLibraries />}
      {tab === 'storage' && <StorageCard />}

      {tab === 'users' && (
        <>
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
            <span className="grow" />
            <button className="btn primary sm" onClick={() => setCreating(true)}><Plus size={15} /> Nuevo usuario</button>
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
                  <th className="num hide-md">Último acceso</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.user.id} tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === 'Enter' && setEditing(r)}>
                    <td>
                      <div className="user-cell">
                        <Avatar name={r.user.displayName} userId={r.user.id} version={r.user.avatarVersion} />
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
                    <td className="num hide-md">{r.user.lastLoginAt ? new Date(r.user.lastLoginAt).toLocaleDateString() : '—'}</td>
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
        </>
      )}

      {editing && (
        <UserEditor row={editing} self={editing.user.id === user?.id} onClose={() => setEditing(null)}
          onSaved={(n) => setData((d) => ({ ...d, items: d.items.map((x) => (x.user.id === n.user.id ? n : x)) }))}
          onDeleted={(id) => setData((d) => ({ ...d, items: d.items.filter((x) => x.user.id !== id), total: d.total - 1 }))} />
      )}
      {creating && <NewUser onClose={() => setCreating(false)} onCreated={(r) => { setData((d) => ({ ...d, items: [r, ...d.items], total: d.total + 1 })); setTab('users') }} />}
    </div>
  )
}

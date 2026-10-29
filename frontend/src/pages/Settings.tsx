import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Globe, KeyRound, Laptop, LogOut, Settings as Cog, ShieldAlert, Smartphone, Trash2, User as UserIcon } from 'lucide-react'
import { api, ApiError, formatBytes, getAccessToken, type User } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import BackButton from '../components/BackButton'
import Tabs from '../components/Tabs'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { uploads } from '../uploadManager'
import { useNavigate } from 'react-router-dom'
import { fmtDate, fmtDateTime } from '../dates'

interface SessionInfo {
  id: string
  startedAt: string
  lastUsedAt: string | null
  device: string | null
  remember: boolean
  current: boolean
}

const setUser = (u: User) => window.dispatchEvent(new CustomEvent('nora:session', { detail: u }))

/** Resume el user-agent en algo legible («Safari en macOS»). */
function deviceName(ua: string | null) {
  if (!ua) return { label: 'Dispositivo desconocido', mobile: false }
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return { label: `${browser}${os ? ` en ${os}` : ''}`, mobile: /iPhone|Android|Mobile/.test(ua) }
}

/** Recorta al centro y reduce la foto a 256×256 antes de subirla (pesa unos pocos KB). */
async function squareAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = 256
  c.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256)
  bmp.close()
  return new Promise((ok, err) => c.toBlob((b) => (b ? ok(b) : err(new Error('No se pudo procesar la imagen'))), 'image/webp', 0.85))
}

function Profile({ user }: { user: User }) {
  const toast = useToast()
  const pick = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const emailChanged = email.trim().toLowerCase() !== user.email

  async function photo(f: File) {
    setBusy('photo')
    try {
      const blob = await squareAvatar(f)
      const fd = new FormData()
      fd.append('file', new File([blob], 'foto.webp', { type: 'image/webp' }))
      const res = await fetch('/api/me/avatar', { method: 'PUT', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: fd })
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? 'No se pudo subir la foto')
      setUser(await res.json())
      toast('Foto actualizada', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo subir la foto', 'error')
    } finally {
      setBusy('')
    }
  }

  async function removePhoto() {
    setBusy('photo')
    try {
      setUser(await api<User>('/me/avatar', 'DELETE'))
    } finally {
      setBusy('')
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy('save')
    try {
      const body: Record<string, string> = {}
      if (name.trim() !== user.displayName) body.displayName = name.trim()
      if (emailChanged) { body.email = email.trim(); body.currentPassword = password }
      if (!Object.keys(body).length) return
      setUser(await api<User>('/me', 'PATCH', body))
      setPassword('')
      toast('Perfil actualizado', 'success')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card stack">
        <h3>Foto de perfil</h3>
        <div className="row" style={{ gap: 18 }}>
          <Avatar name={user.displayName} userId={user.id} version={user.avatarVersion} size={84} />
          <div className="stack tight">
            <div className="row">
              <button className="btn sm primary" disabled={busy === 'photo'} onClick={() => pick.current?.click()}><Camera size={15} /> {user.avatarVersion ? 'Cambiar foto' : 'Subir foto'}</button>
              {user.avatarVersion > 0 && <button className="btn sm ghost" disabled={busy === 'photo'} onClick={() => void removePhoto()}><Trash2 size={15} /> Quitar</button>}
            </div>
            <span className="muted small">PNG, JPEG o WebP. Se recorta en cuadrado. Se ve en las salas en las que participas.</span>
          </div>
          <input ref={pick} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Elegir foto" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void photo(f) }} />
        </div>
      </section>
      <form className="card stack" onSubmit={save}>
        <h3>Datos de la cuenta</h3>
        <label>Nombre<input value={name} minLength={2} maxLength={60} required onChange={(e) => setName(e.target.value)} /></label>
        <label>Correo electrónico<input type="email" value={email} maxLength={254} required onChange={(e) => setEmail(e.target.value)} /></label>
        {emailChanged && (
          <label>Contraseña actual<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="muted small">El correo es tu usuario de acceso: para cambiarlo hay que confirmar tu contraseña.</span></label>
        )}
        {error && <p className="error small" role="alert">{error}</p>}
        <div><button className="btn primary" disabled={busy === 'save' || (name.trim() === user.displayName && !emailChanged)}>{busy === 'save' ? 'Guardando…' : 'Guardar cambios'}</button></div>
      </form>
    </div>
  )
}

function Security() {
  const toast = useToast()
  const dialogs = useDialogs()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const load = () => api<SessionInfo[]>('/me/sessions').then(setSessions).catch(() => setSessions([]))
  useEffect(() => void load(), [])

  async function change(e: FormEvent) {
    e.preventDefault()
    if (next !== next2) return setError('Las contraseñas nuevas no coinciden')
    setError('')
    setBusy(true)
    try {
      await api('/me/password', 'PUT', { currentPassword: cur, newPassword: next })
      setCur(''); setNext(''); setNext2('')
      toast('Contraseña cambiada. Las demás sesiones se han cerrado.', 'success')
      void load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar')
    } finally {
      setBusy(false)
    }
  }

  async function closeOne(s: SessionInfo) {
    if (!await dialogs.confirm({ title: '¿Cerrar esta sesión?', message: `«${deviceName(s.device).label}» tendrá que volver a iniciar sesión.`, confirmLabel: 'Cerrar sesión', tone: 'warning', icon: 'info' })) return
    await api(`/me/sessions/${s.id}`, 'DELETE').catch(() => undefined)
    void load()
  }

  async function closeOthers() {
    if (!await dialogs.confirm({ title: '¿Cerrar las demás sesiones?', message: 'Todos los otros dispositivos tendrán que volver a iniciar sesión. Esta sesión sigue abierta.', confirmLabel: 'Cerrar las demás', tone: 'warning', icon: 'info' })) return
    await api('/me/sessions', 'DELETE').catch(() => undefined)
    void load()
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <form className="card stack" onSubmit={change}>
        <h3 className="row"><KeyRound size={18} /> Cambiar la contraseña</h3>
        <label>Contraseña actual<input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <div className="grid-2">
          <label>Contraseña nueva<input type="password" autoComplete="new-password" required minLength={10} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <label>Repite la nueva<input type="password" autoComplete="new-password" required value={next2} onChange={(e) => setNext2(e.target.value)} /></label>
        </div>
        <p className="muted small">De 10 a 72 caracteres, con mayúscula, minúscula y número. Al cambiarla se cierran tus demás sesiones.</p>
        {error && <p className="error small" role="alert">{error}</p>}
        <div><button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button></div>
      </form>
      <section className="card stack">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <h3 className="row"><Globe size={18} /> Sesiones abiertas</h3>
          {sessions && sessions.length > 1 && <button className="btn sm" onClick={() => void closeOthers()}><LogOut size={15} /> Cerrar las demás</button>}
        </div>
        {sessions === null ? <p className="muted small">Cargando…</p> : sessions.map((s) => {
          const d = deviceName(s.device)
          const Icon = d.mobile ? Smartphone : Laptop
          return (
            <div key={s.id} className="join-req">
              <span className="row nowrap"><Icon size={20} /><span className="stack tight" style={{ gap: 0 }}>
                <strong>{d.label}{s.current && <span className="badge green" style={{ marginLeft: 8 }}>Esta sesión</span>}</strong>
                <span className="muted small">Desde {fmtDate(s.startedAt)} · último uso {s.lastUsedAt ? fmtDateTime(s.lastUsedAt) : '—'} · {s.remember ? 'durante un mes' : 'hasta cerrar el navegador'}</span>
              </span></span>
              {!s.current && <button className="btn ghost sm" onClick={() => void closeOne(s)}>Cerrar</button>}
            </div>
          )
        })}
      </section>
    </div>
  )
}

function Account({ user, storageUsed }: { user: User; storageUsed: number }) {
  const dialogs = useDialogs()
  const navigate = useNavigate()
  const toast = useToast()
  const { logout } = useAuth()
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const l = user.limits
  const rows: [string, string][] = [
    ['Espacio', `${formatBytes(storageUsed)} de ${l.storageQuotaBytes === null ? '∞' : formatBytes(l.storageQuotaBytes)}`],
    ['Tamaño máximo de archivo', l.maxFileSizeBytes === null ? '∞' : formatBytes(l.maxFileSizeBytes)],
    ['Salas activas', l.maxActiveRooms === null ? '∞' : String(l.maxActiveRooms)],
    ['Duración máxima de sala', l.maxRoomMinutes === null ? '∞' : `${l.maxRoomMinutes} min`],
    ['Participantes por sala', l.maxParticipants === null ? '∞' : String(l.maxParticipants)],
  ]

  async function remove(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!await dialogs.confirm({ title: '¿Borrar tu cuenta para siempre?', message: <>Se eliminarán <b>tus salas con todo su contenido</b>, los archivos, notas y pizarras que hayas creado en otras salas y tu perfil. <b>No se puede deshacer.</b></>, confirmLabel: 'Borrar mi cuenta', tone: 'danger', typeToConfirm: 'BORRAR' })) return
    setBusy(true)
    try {
      await uploads.cancelAll()
      await api('/me', 'DELETE', { password: pw })
      await logout().catch(() => undefined)
      toast('Tu cuenta y tus datos se han eliminado', 'success')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo borrar la cuenta')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card stack tight">
        <h3>Tu cuenta</h3>
        <p className="muted small">Alta: {fmtDate(user.createdAt)} · Rol: {user.role === 'ADMIN' ? 'Administrador' : 'Usuario'}. Estos límites los fija el administrador.</p>
        <div className="stat-grid">{rows.map(([k, v]) => <div key={k} className="stat"><b>{v}</b><span className="muted small">{k}</span></div>)}</div>
      </section>
      <form className="card stack danger-zone" onSubmit={remove}>
        <h3 className="row"><ShieldAlert size={18} /> Borrar mi cuenta</h3>
        <p className="small">Elimina <b>todos tus datos</b> de Nora de forma definitiva: tus salas (con sus archivos, notas y pizarras), lo que hayas subido o creado en otras salas, tu foto, tus sesiones y tus bibliotecas. Los archivos se borran también del almacenamiento. Es lo que recoge la <a href="/data">política de datos</a>.</p>
        <label>Tu contraseña<input type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {error && <p className="error small" role="alert">{error}</p>}
        <div><button className="btn danger-solid" disabled={busy || !pw}><Trash2 size={15} /> {busy ? 'Borrando…' : 'Borrar mi cuenta y mis datos'}</button></div>
      </form>
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [tab, setTab] = useState('profile')
  const [used, setUsed] = useState(0)
  useEffect(() => {
    api<{ storageUsedBytes: number }>('/me').then((m) => setUsed(m.storageUsedBytes)).catch(() => undefined)
  }, [])
  if (!user) return null
  return (
    <div className="stack" style={{ gap: 18, maxWidth: 760, margin: '0 auto' }}>
      <div><BackButton /></div>
      <div className="hero">
        <h1 className="row"><Cog size={26} /> Ajustes</h1>
        <p>Tu perfil, tu seguridad y tu cuenta.</p>
      </div>
      <Tabs label="Secciones de ajustes" value={tab} onChange={setTab}
        items={[{ id: 'profile', label: <><UserIcon size={15} /> Perfil</> }, { id: 'security', label: <><KeyRound size={15} /> Seguridad</> }, { id: 'account', label: <><ShieldAlert size={15} /> Cuenta</> }]} />
      {tab === 'profile' && <Profile user={user} />}
      {tab === 'security' && <Security />}
      {tab === 'account' && <Account user={user} storageUsed={used} />}
    </div>
  )
}

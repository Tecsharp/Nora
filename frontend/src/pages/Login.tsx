import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import Brand from '../components/Brand'
import LegalLinks from '../components/LegalLinks'
import { ThemeToggle } from '../theme'

const EMAIL_KEY = 'nora-login-email'
const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const saved = read(EMAIL_KEY)
  const [email, setEmail] = useState(saved ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true) // mantiene la sesión un mes
  const [rememberEmail, setRememberEmail] = useState(saved !== null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [registration, setRegistration] = useState(true)

  useEffect(() => {
    api<{ registrationEnabled: boolean }>('/auth/config').then((c) => setRegistration(c.registrationEnabled)).catch(() => {})
  }, [])

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (user) return <Navigate to={from} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password, remember)
      try {
        if (rememberEmail) localStorage.setItem(EMAIL_KEY, email.trim())
        else localStorage.removeItem(EMAIL_KEY)
      } catch { /* sin almacenamiento */ }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-corner"><ThemeToggle /></div>
      <Brand large subtitle="Tu espacio. Tus reglas." />
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-head">
          <h2>Iniciar sesión</h2>
          <p className="muted small">Accede para crear o unirte a salas de colaboración.</p>
        </div>
        <label>
          Correo electrónico
          <input type="email" autoComplete="email" required placeholder="tu@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="stack tight" style={{ gap: 6 }}>
          <label className="check"><input type="checkbox" checked={rememberEmail} onChange={(e) => setRememberEmail(e.target.checked)} /> Recordar mi correo en este equipo</label>
          <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Mantener la sesión iniciada durante un mes</label>
          {!remember && <span className="muted small">La sesión se cerrará al cerrar el navegador (o tras unos días sin usar Nora).</span>}
        </div>
        {error && <p className="error small" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="muted small center-text">¿Olvidaste tu contraseña? Pide a un administrador un enlace para cambiarla.</p>
        {registration && (
          <p className="muted small center-text">
            ¿No tienes cuenta? <Link to="/register">Regístrate</Link>
          </p>
        )}
      </form>
      <div className="auth-foot"><LegalLinks /></div>
    </div>
  )
}

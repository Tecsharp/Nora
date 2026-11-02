import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuthConfig } from '../authConfig'
import GoogleButton from '../components/GoogleButton'
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

/** Lo que pasó al volver de Google (el servidor manda un código, nunca un texto). */
const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Cancelaste el acceso con Google.',
  state: 'La sesión de acceso venció. Inténtalo de nuevo.',
  failed: 'No se pudo entrar con Google. Inténtalo de nuevo.',
  unverified: 'Google no tiene verificado ese correo.',
  registration_disabled: 'No hay una cuenta con ese correo y el registro está cerrado. Pide a un administrador que la cree.',
  account_disabled: 'Tu cuenta está desactivada.',
  conflict: 'Ese correo ya está enlazado a otra cuenta de Google.',
  disabled_mode: 'En este sitio no se puede entrar con Google.',
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
  const cfg = useAuthConfig()
  const [params] = useSearchParams()
  const googleError = params.get('error')
  const registration = cfg?.registrationEnabled ?? true

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
      {!cfg ? (
        <div className="card auth-card"><p className="muted small center-text">Cargando…</p></div>
      ) : (
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-head">
          <h2>Iniciar sesión</h2>
          <p className="muted small">Accede para crear o unirte a salas de colaboración.</p>
        </div>
        {googleError && <p className="error small" role="alert">{GOOGLE_ERRORS[googleError] ?? GOOGLE_ERRORS.failed}</p>}
        {cfg.googleLogin && <GoogleButton remember={remember} />}
        {cfg.googleLogin && cfg.passwordLogin && <div className="auth-or">o con tu correo</div>}
        {cfg.passwordLogin && <>
        <label>
          Correo electrónico
          <input type="email" autoComplete="email" required placeholder="tu@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="stack tight" style={{ gap: 6 }}>
          <label className="check"><input type="checkbox" checked={rememberEmail} onChange={(e) => setRememberEmail(e.target.checked)} /> Recordar mi correo en este dispositivo</label>
          <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Mantener la sesión iniciada durante un mes</label>
          {!remember && <span className="muted small">La sesión se cerrará al cerrar el navegador (o tras unos días sin usar Nora).</span>}
        </div>
        {error && <p className="error small" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="muted small center-text">{cfg.googleLogin ? '¿Olvidaste tu contraseña? Entra con Google.' : '¿Olvidaste tu contraseña? Pide a un administrador un enlace para cambiarla.'}</p>
        </>}
        {!cfg.passwordLogin && (
          <div className="stack tight" style={{ gap: 6 }}>
            <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Mantener la sesión iniciada durante un mes</label>
          </div>
        )}
        {registration && !cfg.passwordLogin && <p className="muted small center-text">Si aún no tienes cuenta, se crea al entrar con Google.</p>}
        {registration && cfg.passwordLogin && (
          <p className="muted small center-text">
            ¿No tienes cuenta? <Link to="/register">Regístrate</Link>
          </p>
        )}
      </form>
      )}
      <div className="auth-foot"><LegalLinks /></div>
    </div>
  )
}

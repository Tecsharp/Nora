import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import Brand from '../components/Brand'
import LegalLinks from '../components/LegalLinks'
import { ThemeToggle } from '../theme'

const rules = [
  { ok: (p: string) => p.length >= 10, text: 'Al menos 10 caracteres' },
  { ok: (p: string) => /\p{Lu}/u.test(p), text: 'Una mayúscula' },
  { ok: (p: string) => /\p{Ll}/u.test(p), text: 'Una minúscula' },
  { ok: (p: string) => /\d/.test(p), text: 'Un número' },
]

export default function Register() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)

  if (user) return <Navigate to="/" replace />

  const valid = rules.every((r) => r.ok(password)) && password === confirm && accepted

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setFields({})
    setBusy(true)
    try {
      await api('/auth/register', 'POST', { email, displayName, password })
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('No se pudo conectar con el servidor')
      }
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
          <h2>Crear cuenta</h2>
          <p className="muted small">Solo necesitas un nombre, un correo y una contraseña.</p>
        </div>
        <label>
          Nombre
          <input required minLength={2} maxLength={60} autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          {fields.displayName && <span className="error small">{fields.displayName}</span>}
        </label>
        <label>
          Correo electrónico
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {fields.email && <span className="error small">{fields.email}</span>}
        </label>
        <label>
          Contraseña
          <input type="password" required autoComplete="new-password" maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.text} className={r.ok(password) ? 'ok' : ''}>{r.text}</li>
          ))}
        </ul>
        <label>
          Repite la contraseña
          <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {confirm && password !== confirm && <span className="error small">Las contraseñas no coinciden</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>
            He leído y acepto los <Link to="/terms" target="_blank">Términos de uso</Link> y la{' '}
            <Link to="/privacy" target="_blank">Política de privacidad</Link>.
          </span>
        </label>
        {error && <p className="error small" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || !valid}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
        <p className="muted small center-text">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </form>
      <div className="auth-foot"><LegalLinks /></div>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { api, ApiError } from '../api'
import Brand from '../components/Brand'
import LegalLinks from '../components/LegalLinks'
import { useToast } from '../toast'
import { ThemeToggle } from '../theme'

/** Página a la que llega quien recibe de un administrador un enlace para elegir una contraseña nueva. */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const toast = useToast()
  const [who, setWho] = useState<string | null>(null)
  const [invalid, setInvalid] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return setInvalid('Falta el enlace. Pide uno nuevo a un administrador.')
    api<{ displayName: string }>(`/auth/reset/${encodeURIComponent(token)}`).then((r) => setWho(r.displayName)).catch((e) => setInvalid(e instanceof ApiError ? e.message : 'No se pudo comprobar el enlace'))
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw !== pw2) return setError('Las contraseñas no coinciden')
    setError('')
    setBusy(true)
    try {
      await api('/auth/reset', 'POST', { token, password: pw })
      toast('Contraseña cambiada. Ya puedes iniciar sesión.', 'success')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-corner"><ThemeToggle /></div>
      <Brand large subtitle="Tu espacio. Tus reglas." />
      <div className="card auth-card">
        <div className="auth-head">
          <h2 className="row"><KeyRound size={20} /> Nueva contraseña</h2>
          {who && <p className="muted small">Cuenta de <b>{who}</b>. Elige una contraseña nueva; el enlace solo sirve una vez.</p>}
        </div>
        {invalid ? (
          <>
            <p className="error" role="alert">{invalid}</p>
            <Link to="/login" className="btn block">Ir a iniciar sesión</Link>
          </>
        ) : who === null ? <p className="muted">Comprobando el enlace…</p> : (
          <form className="stack" onSubmit={submit}>
            <label>Contraseña nueva<input type="password" autoComplete="new-password" required minLength={10} maxLength={72} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <label>Repítela<input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
            <p className="muted small">De 10 a 72 caracteres, con mayúscula, minúscula y número.</p>
            {error && <p className="error small" role="alert">{error}</p>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button>
          </form>
        )}
      </div>
      <div className="auth-foot"><LegalLinks /></div>
    </div>
  )
}

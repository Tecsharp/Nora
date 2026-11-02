import { useEffect, useState } from 'react'
import { api } from './api'

export interface AuthConfig {
  registrationEnabled: boolean
  /** Se puede entrar con correo y contraseña. */
  passwordLogin: boolean
  /** Se puede entrar con Google. */
  googleLogin: boolean
}

const FALLBACK: AuthConfig = { registrationEnabled: true, passwordLogin: true, googleLogin: false }

/** Cómo se entra en este sitio (lo decide el administrador). null mientras carga; si falla, solo contraseña. */
export function useAuthConfig(): AuthConfig | null {
  const [cfg, setCfg] = useState<AuthConfig | null>(null)
  useEffect(() => {
    let alive = true
    api<AuthConfig>('/auth/config').then((c) => alive && setCfg(c)).catch(() => alive && setCfg(FALLBACK))
    return () => { alive = false }
  }, [])
  return cfg
}

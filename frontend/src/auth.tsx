import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearFileCache } from './fileCache'
import { api, refreshSession, setAccessToken, setSessionLostHandler, type User } from './api'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState>(null!)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const onSession = (e: Event) => setUser((e as CustomEvent<User>).detail)
    window.addEventListener('nora:session', onSession)
    setSessionLostHandler(() => setUser(null))
    refreshSession().finally(() => setLoading(false))
    return () => window.removeEventListener('nora:session', onSession)
  }, [])

  const login = useCallback(async (email: string, password: string, remember = false) => {
    const res = await api<{ accessToken: string; user: User }>('/auth/login', 'POST', { email, password, remember })
    setAccessToken(res.accessToken)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', 'POST')
    } finally {
      clearFileCache()
      setAccessToken(null)
      setUser(null)
    }
  }, [])

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}

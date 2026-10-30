import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

interface Toast {
  id: number
  level: ToastLevel
  message: string
}

/** Permite avisar desde fuera de React (p. ej. el gestor de subidas). */
let sink: (message: string, level?: ToastLevel) => void = () => {}
export const notifyToast = (message: string, level?: ToastLevel) => sink(message, level)

const Ctx = createContext<(message: string, level?: ToastLevel) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)
  const last = useRef({ message: '', at: 0 })

  const push = useCallback((message: string, level: ToastLevel = 'info') => {
    const id = next.current++
    // el mismo aviso seguido (p. ej. dos eventos que dicen lo mismo) se muestra una sola vez
    const now = Date.now()
    if (last.current.message === message && now - last.current.at < 3000) return
    last.current = { message, at: now }
    setToasts((t) => [...t.slice(-2), { id, level, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === 'error' || level === 'warning' ? 6000 : 3200)
  }, [])

  sink = push

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`} role="status" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

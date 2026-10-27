import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

interface Toast {
  id: number
  level: ToastLevel
  message: string
}

const Ctx = createContext<(message: string, level?: ToastLevel) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)

  const push = useCallback((message: string, level: ToastLevel = 'info') => {
    const id = next.current++
    setToasts((t) => [...t.slice(-4), { id, level, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === 'error' || level === 'warning' ? 8000 : 4500)
  }, [])

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

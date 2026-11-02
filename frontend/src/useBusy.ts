import { useCallback, useRef, useState } from 'react'

/**
 * Candado para botones que crean o borran: mientras una acción con la misma clave sigue en curso, los clics repetidos se ignoran
 * (el candado se pone al instante, antes de que React vuelva a pintar el botón desactivado). La clave permite bloquear solo el
 * elemento afectado, p. ej. `del:${id}`.
 */
export function useBusy() {
  const running = useRef(new Set<string>())
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set())

  const run = useCallback(async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current.has(key)) return undefined
    running.current.add(key)
    setKeys(new Set(running.current))
    try {
      return await fn()
    } finally {
      running.current.delete(key)
      setKeys(new Set(running.current))
    }
  }, [])

  /** Sin clave: si hay alguna acción en curso. */
  const busy = useCallback((key?: string) => (key === undefined ? keys.size > 0 : keys.has(key)), [keys])

  return { run, busy }
}

import { useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Carpeta abierta en Archivos, Pizarras o Notas, guardada en la dirección (`?folder=…`): al recargar la página se vuelve a la misma carpeta
 * y el botón «atrás» del navegador sube de carpeta. Funciona como un `useState`.
 */
export function useFolderParam(): [string | null, (v: string | null | ((c: string | null) => string | null)) => void] {
  const [params, setParams] = useSearchParams()
  const current = params.get('folder')
  const ref = useRef(current)
  ref.current = current
  const set = useCallback((v: string | null | ((c: string | null) => string | null)) => {
    const next = typeof v === 'function' ? v(ref.current) : v
    if (next === ref.current) return
    ref.current = next
    setParams((p) => { if (next) p.set('folder', next); else p.delete('folder'); return p })
  }, [setParams])
  return [current, set]
}

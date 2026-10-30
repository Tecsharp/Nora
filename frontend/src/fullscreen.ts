import { useCallback, useEffect, useRef, useState } from 'react'

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void }
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

const fsDoc = () => document as FsDocument
const current = () => fsDoc().fullscreenElement ?? fsDoc().webkitFullscreenElement ?? null
const exit = async () => {
  const d = fsDoc()
  await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.())
}

/**
 * Pantalla completa de toda la página (no de un elemento): así los avisos y los diálogos de Nora, que cuelgan del `body`,
 * siguen viéndose. Si el navegador no la ofrece (p. ej. iPhone) `supported` es false y no se muestra el botón.
 * Al desmontarse sale de la pantalla completa si fue este componente quien la activó.
 */
export function useFullscreen() {
  const [active, setActive] = useState(() => !!current())
  const mine = useRef(false)
  const supported = !!(fsDoc().fullscreenEnabled ?? fsDoc().webkitFullscreenEnabled)

  useEffect(() => {
    const sync = () => {
      const on = !!current()
      setActive(on)
      if (!on) mine.current = false
    }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
      if (mine.current && current()) void exit().catch(() => undefined)
    }
  }, [])

  const toggle = useCallback(async () => {
    if (current()) {
      await exit()
      return
    }
    const el = document.documentElement as FsElement
    await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.())
    mine.current = true
  }, [])

  return { supported, active, toggle }
}

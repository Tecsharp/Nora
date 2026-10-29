import { useEffect, useRef, useState, type RefObject } from 'react'

export interface MarqueeBox { left: number; top: number; width: number; height: number }

const INTERACTIVE = '[data-sel-id], button, a, input, select, textarea, label, .menu, .fitem, .board-card, [role=button], [role=menuitem]'

/**
 * Selección con el ratón (rectángulo elástico): al arrastrar sobre un hueco del contenedor se dibuja un rectángulo y se
 * seleccionan los elementos con `data-sel-id` que toca. Con Ctrl/⌘ o Mayús se suma a lo ya seleccionado.
 * `onSelect` recibe los ids tocados y si se suma. Devuelve el rectángulo para dibujarlo y si acaba de terminar un arrastre
 * (para que el clic que sigue no borre la selección).
 */
export function useMarquee(container: RefObject<HTMLElement | null>, enabled: boolean, onSelect: (ids: string[], additive: boolean) => void) {
  const [box, setBox] = useState<MarqueeBox | null>(null)
  const justDragged = useRef(false)
  const cb = useRef(onSelect)
  cb.current = onSelect

  useEffect(() => {
    const el = container.current
    if (!el || !enabled) return
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse' || (e.target instanceof Element && e.target.closest(INTERACTIVE))) return
      const sx = e.clientX
      const sy = e.clientY
      const additive = e.ctrlKey || e.metaKey || e.shiftKey
      let active = false
      const move = (ev: PointerEvent) => {
        if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        active = true
        ev.preventDefault()
        const r = el.getBoundingClientRect()
        const x1 = Math.max(r.left, Math.min(sx, ev.clientX))
        const x2 = Math.min(r.right, Math.max(sx, ev.clientX))
        const y1 = Math.max(r.top, Math.min(sy, ev.clientY))
        const y2 = Math.min(r.bottom, Math.max(sy, ev.clientY))
        setBox({ left: x1, top: y1, width: x2 - x1, height: y2 - y1 })
        const hit: string[] = []
        el.querySelectorAll<HTMLElement>('[data-sel-id]').forEach((n) => {
          const b = n.getBoundingClientRect()
          if (b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2) hit.push(n.dataset.selId!)
        })
        cb.current(hit, additive)
      }
      const up = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        setBox(null)
        if (active) {
          justDragged.current = true
          setTimeout(() => (justDragged.current = false), 0)
        }
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    }
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [container, enabled])

  return { box, justDragged }
}

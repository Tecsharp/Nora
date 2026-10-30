import { useEffect, useRef } from 'react'

/** A dónde llevar a la persona dentro de la sala al abrir una notificación. `nonce` distingue dos avisos seguidos al mismo sitio. */
export interface FocusTarget {
  tool: string
  item?: string
  file?: string
  conv?: string
  msg?: string
  nonce: number
}

/** Ejecuta `run` una vez por cada destino nuevo, cuando la herramienta ya cargó lo que necesita (`ready`). */
export function useFocusTarget(focus: FocusTarget | null | undefined, ready: boolean, run: (f: FocusTarget) => void) {
  const done = useRef(0)
  const fn = useRef(run)
  fn.current = run
  useEffect(() => {
    if (!focus || !ready || done.current === focus.nonce) return
    done.current = focus.nonce
    fn.current(focus)
  }, [focus, ready])
}

/** Se desplaza hasta el elemento y lo resalta un momento. Reintenta unos instantes por si aún se está pintando. */
export function flash(selector: string, tries = 15) {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) {
    if (tries > 0) setTimeout(() => flash(selector, tries - 1), 120)
    return
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('flash-target')
  void el.offsetWidth // reinicia la animación si ya estaba puesta
  el.classList.add('flash-target')
  setTimeout(() => el.classList.remove('flash-target'), 2200)
}

export const byItem = (id: string) => `[data-item-id="${id}"]`

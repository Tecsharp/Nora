import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  title: string
  icon?: ReactNode
  onClose: () => void
  wide?: boolean
  /** Aún más ancho (tableros, calendario). */
  xl?: boolean
  /** Sigue montado (p. ej. el Reproductor, para que no se corte el sonido) pero no se ve ni bloquea la página. */
  hidden?: boolean
  flush?: boolean
  footer?: ReactNode
  children: ReactNode
}

/** Diálogo accesible: se cierra con Esc o tocando fuera, bloquea el scroll de fondo y devuelve el foco al cerrar. */
export default function Modal({ title, icon, onClose, wide, xl, hidden, flush, footer, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (hidden) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Solo el diálogo más reciente reacciona a Esc
      const dialogs = document.querySelectorAll('.modal-backdrop:not([hidden])')
      if (e.key === 'Escape' && dialogs[dialogs.length - 1] === ref.current?.parentElement) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [hidden])

  return createPortal(
    <div className="modal-backdrop" hidden={hidden} style={hidden ? { display: 'none' } : undefined} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide || xl ? 'wide' : ''} ${xl ? 'xl' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="modal-head">
          <h2>
            {icon}
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className={`modal-body ${flush ? 'flush' : ''}`}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export type MenuItem =
  | { heading: string }
  | { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }
  | 'separator'

/** Menú «más acciones». Se abre hacia arriba si no cabe debajo. */
export default function Menu({ items, label = 'Más acciones', trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const wrap = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false)
    }
    const away = () => setOpen(false)
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false) // el menú es fijo: si algo se desplaza debajo, se cierra
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <span className="menu-anchor" ref={wrap} onClick={(e) => e.stopPropagation()}>
      <button
        className={trigger ? 'menu-trigger' : 'icon-btn sm'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = wrap.current?.getBoundingClientRect()
          if (r) {
            // Se pinta en el body y fijo respecto a la ventana: así no lo recorta la lista que lo contiene (p. ej. con una sola tarjeta)
            const need = Math.max(280, items.length * 38 + 24)
            const up = r.bottom + need > window.innerHeight && r.top > window.innerHeight - r.bottom
            setPos(up
              ? { position: 'fixed', right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 12, overflowY: 'auto' }
              : { position: 'fixed', right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 4, maxHeight: window.innerHeight - r.bottom - 12, overflowY: 'auto' })
          }
          setOpen((o) => !o)
        }}
      >
        {trigger ?? <MoreHorizontal size={18} />}
      </button>
      {open && createPortal(
        <div className="menu" role="menu" ref={panel} style={{ ...pos, zIndex: 300 }}>
          {items.map((it, i) =>
            it === 'separator' ? (
              <hr key={i} />
            ) : 'heading' in it ? (
              <div key={i} className="menu-title">{it.heading}</div>
            ) : (
              <button key={i} role="menuitem" className={it.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}>
                {it.icon}
                <span className="truncate">{it.label}</span>
              </button>
            ),
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}

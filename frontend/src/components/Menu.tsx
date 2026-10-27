import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type MenuItem =
  | { heading: string }
  | { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }
  | 'separator'

/** Menú «más acciones». Se abre hacia arriba si no cabe debajo. */
export default function Menu({ items, label = 'Más acciones', trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
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
          setUp(!!r && r.bottom + 280 > window.innerHeight)
          setOpen((o) => !o)
        }}
      >
        {trigger ?? <MoreHorizontal size={18} />}
      </button>
      {open && (
        <div className={`menu ${up ? 'up' : ''}`} role="menu">
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
        </div>
      )}
    </span>
  )
}

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface TabItem {
  id: string
  label?: ReactNode
  icon?: ReactNode
  count?: number
  title?: string
}

interface Props {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  label: string
  /** 'radiogroup' para opciones excluyentes sin contenido asociado (tema, vista). */
  role?: 'tablist' | 'radiogroup'
  size?: 'md' | 'sm'
  className?: string
}

/** Pestañas con un indicador que se desliza hasta la opción activa. */
export default function Tabs({ items, value, onChange, label, role = 'tablist', size = 'md', className = '' }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ x: number; w: number } | null>(null)
  const [ready, setReady] = useState(false)
  const key = items.map((i) => `${i.id}:${i.count ?? ''}`).join('|')

  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLElement>('[data-active="true"]')
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    const t = requestAnimationFrame(() => setReady(true)) // la primera medida no se anima
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    return () => {
      cancelAnimationFrame(t)
      ro.disconnect()
    }
  }, [value, key])

  // Mantiene visible la pestaña activa cuando la fila se desplaza
  useLayoutEffect(() => {
    wrap.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [value])

  const icons = items.every((i) => i.label === undefined)
  return (
    <div ref={wrap} className={`tabs ${icons ? 'icons' : ''} ${size === 'sm' ? 'sm' : ''} ${className}`} role={role} aria-label={label}>
      {box && <span className={`pill ${ready ? '' : 'instant'}`} style={{ width: box.w, transform: `translateX(${box.x}px)` }} />}
      {items.map((i) => {
        const active = i.id === value
        return (
          <button
            key={i.id}
            type="button"
            role={role === 'tablist' ? 'tab' : 'radio'}
            aria-selected={role === 'tablist' ? active : undefined}
            aria-checked={role === 'radiogroup' ? active : undefined}
            aria-label={i.title}
            title={i.title}
            data-active={active}
            onClick={() => onChange(i.id)}
          >
            {i.icon}
            {i.label}
            {i.count !== undefined && <span className="count">{i.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Botón de la barra de herramientas. No roba el foco del editor al pulsarlo. */
export function TB({ label, icon, active, onClick, disabled, text, danger }: {
  label: string; icon?: ReactNode; active?: boolean; onClick: () => void; disabled?: boolean; text?: string; danger?: boolean
}) {
  return (
    <button type="button" className={`tb ${active ? 'on' : ''} ${text ? 'txt' : ''} ${danger ? 'danger' : ''}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}{text && <span>{text}</span>}
    </button>
  )
}

export const Sep = () => <span className="tb-sep" />

/** Grupo con título pequeño debajo, como en las cintas de Office. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rb-group" role="group" aria-label={title}>
      <div className="rb-items">{children}</div>
      <div className="rb-title">{title}</div>
    </div>
  )
}

export interface RibbonTab { id: string; label: string; content: ReactNode }

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches

/** Cinta de opciones con pestañas (Inicio, Insertar…). En pantallas estrechas empieza plegada: tocar una pestaña la despliega. */
export function Ribbon({ tabs, initial, trailing }: { tabs: RibbonTab[]; initial?: string; trailing?: ReactNode }) {
  const [tab, setTab] = useState(initial ?? tabs[0]!.id)
  const [open, setOpen] = useState(() => !narrow())
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0]!
  return (
    <div className="ribbon">
      <div className="rb-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={open && t.id === cur.id} className={`rb-tab ${open && t.id === cur.id ? 'on' : ''}`}
            onClick={() => { if (narrow() && open && t.id === cur.id) setOpen(false); else { setTab(t.id); setOpen(true) } }}>{t.label}</button>
        ))}
        <span className="grow" />
        {trailing}
      </div>
      {open && <div className="rb-body" role="toolbar" aria-label={cur.label}>{cur.content}</div>}
    </div>
  )
}

const SWATCHES = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#d9d9d9', '#efefef', '#ffffff',
  '#e03131', '#f76707', '#f59f00', '#37b24d', '#1098ad', '#1c7ed6', '#7048e8', '#d6336c',
  '#ffc9c9', '#ffd8a8', '#ffec99', '#b2f2bb', '#99e9f2', '#a5d8ff', '#d0bfff', '#fcc2d7',
  '#a61e4d', '#c92a2a', '#d9480f', '#e67700', '#2b8a3e', '#0b7285', '#1864ab', '#5f3dc4',
]

/** Selector de color con paleta (y un color personalizado). `value` es el color actual. */
export function ColorPick({ label, icon, value, onPick, none }: { label: string; icon: ReactNode; value?: string; onPick: (c: string | null) => void; none?: string }) {
  const [open, setOpen] = useState(false)
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
    <span className="menu-anchor" ref={wrap}>
      <button type="button" className="tb color-tb" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        <span className="color-ico">{icon}<i className="color-bar" style={{ background: value ?? 'transparent' }} /></span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="menu color-menu" role="dialog" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} type="button" className={`swatch ${value?.toLowerCase() === c ? 'on' : ''}`} aria-label={c} title={c} style={{ background: c }}
                onClick={() => { onPick(c); setOpen(false) }} />
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {none && <button type="button" className="btn sm" onClick={() => { onPick(null); setOpen(false) }}>{none}</button>}
            <label className="btn sm color-custom">Otro…<input type="color" value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#000000'} onChange={(e) => onPick(e.target.value)} /></label>
          </div>
        </div>
      )}
    </span>
  )
}

/** Lista desplegable compacta. */
export function Sel({ label, value, onChange, options, width }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; width?: number }) {
  return (
    <select className="tb-select" aria-label={label} title={label} value={value} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

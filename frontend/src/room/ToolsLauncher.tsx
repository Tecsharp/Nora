import { Pin, PinOff } from 'lucide-react'
import type { ReactNode } from 'react'
import Modal from '../components/Modal'
import { GROUPS, TOOLS } from './tools'
import { MAX_PINNED } from './RoomNav'

/** Todas las herramientas de la sala en una sola vista; desde aquí se eligen las cuatro que quedan en la barra lateral. */
export default function ToolsLauncher({ active, pinned, badges, onSelect, onTogglePin, onClose }: {
  active: string
  pinned: string[]
  badges: Record<string, ReactNode>
  onSelect: (id: string) => void
  onTogglePin: (id: string) => void
  onClose: () => void
}) {
  const shown = pinned.slice(0, MAX_PINNED)
  return (
    <Modal title="Herramientas" onClose={onClose} wide>
      <p className="tl-note small muted">Elige una herramienta. Con la chincheta decides cuáles van en la barra lateral (hasta {MAX_PINNED}: ahora {shown.length}).</p>
      {GROUPS.map((g) => {
        const list = TOOLS.filter((t) => t.group === g.id)
        return (
          <section key={g.id} className="tl-group">
            <h4>{g.label}</h4>
            <div className="tl-grid">
              {list.map((t) => {
                const on = shown.includes(t.id)
                return (
                  <div key={t.id} className={`tl-card ${active === t.id ? 'current' : ''}`}>
                    <button className="tl-open" onClick={() => { onSelect(t.id); onClose() }}>
                      <span className="tl-ico"><t.icon size={20} /></span>
                      <span className="tl-txt"><b>{t.label}</b><small>{t.hint}</small></span>
                      {badges[t.id]}
                    </button>
                    <button className={`tl-pin ${on ? 'on' : ''}`} onClick={() => onTogglePin(t.id)} aria-pressed={on} aria-label={on ? `Quitar ${t.label} de la barra lateral` : `Fijar ${t.label} en la barra lateral`} title={on ? 'Quitar de la barra lateral' : 'Fijar en la barra lateral'}>
                      {on ? <Pin size={15} /> : <PinOff size={15} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </Modal>
  )
}

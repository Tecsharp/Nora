import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { isActive, uploads, useUploads } from '../uploadManager'
import ProgressBar from './ProgressBar'

/** Panel flotante con las subidas en curso: sigue visible aunque se cierre el modal o se cambie de pantalla. */
export default function UploadDock() {
  const items = useUploads()
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null
  const active = items.filter(isActive).length

  return (
    <aside className="dock" aria-label="Subidas">
      <div className="dock-head">
        <strong>{active > 0 ? `Subiendo ${active} archivo${active === 1 ? '' : 's'}` : 'Subidas'}</strong>
        <button className="icon-btn" aria-label={collapsed ? 'Expandir' : 'Contraer'} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {!collapsed &&
        items.map((i) => (
          <div key={i.key} className="dock-item">
            <div className="row spread">
              <span className="break small">{i.file.name}</span>
              {isActive(i) ? (
                <button className="btn ghost small-btn" onClick={() => uploads.cancel(i.key)}>Cancelar</button>
              ) : (
                <button className="icon-btn" aria-label="Quitar" onClick={() => uploads.dismiss(i.key)}><X size={14} /></button>
              )}
            </div>
            <ProgressBar p={i.progress} />
          </div>
        ))}
    </aside>
  )
}

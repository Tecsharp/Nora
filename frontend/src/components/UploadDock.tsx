import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { isActive, uploads, useUploads } from '../uploadManager'
import { useFilesOpen } from '../ui'
import ProgressBar from './ProgressBar'

/**
 * Panel flotante con las subidas en curso. Solo aparece cuando el explorador de archivos está cerrado (dentro de él
 * ya se ve el progreso), así nunca hay dos indicadores a la vez.
 */
export default function UploadDock() {
  const items = useUploads()
  const filesOpen = useFilesOpen()
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0 || filesOpen) return null
  const active = items.filter(isActive).length

  return (
    <aside className="dock" aria-label="Subidas">
      <div className="dock-head">
        <strong>{active > 0 ? `Subiendo ${active} archivo${active === 1 ? '' : 's'}` : 'Subidas'}</strong>
        <button className="icon-btn sm" aria-label={collapsed ? 'Expandir' : 'Contraer'} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {!collapsed &&
        items.map((i) => (
          <div key={i.key} className="dock-item">
            <div className="row spread nowrap">
              <span className="truncate small">{i.file.name}</span>
              {isActive(i) ? (
                <button className="btn ghost sm" onClick={() => uploads.cancel(i.key)}>Cancelar</button>
              ) : (
                <button className="icon-btn sm" aria-label="Quitar" onClick={() => uploads.dismiss(i.key)}><X size={14} /></button>
              )}
            </div>
            <ProgressBar p={i.progress} />
          </div>
        ))}
    </aside>
  )
}

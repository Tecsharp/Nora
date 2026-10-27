import { formatBytes, formatEta, formatSpeed } from '../api'
import type { UploadProgress } from '../uploader'

const LABEL: Record<UploadProgress['state'], string> = {
  queued: 'En cola',
  preparing: 'Preparando…',
  uploading: 'Subiendo',
  waiting: 'En espera',
  finishing: 'Finalizando…',
  done: 'Completado',
  error: 'Error',
  canceled: 'Cancelado',
}

export default function ProgressBar({ p, hideSpeed }: { p: UploadProgress; hideSpeed?: boolean }) {
  const pct = p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0
  return (
    <div className="progress">
      <div
        className={`bar ${p.state}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Progreso de subida"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta muted small">
        <span>
          {p.message ?? LABEL[p.state]} · {pct}% ({formatBytes(p.loaded)} / {formatBytes(p.total)})
        </span>
        {!hideSpeed && (p.state === 'uploading' || p.state === 'waiting') && (
          <span>
            {formatSpeed(p.speed)}
            {p.state === 'uploading' && ` · quedan ${formatEta(p.eta)}`}
          </span>
        )}
      </div>
    </div>
  )
}

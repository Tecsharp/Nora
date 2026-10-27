import { memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import { ChartView, type ChartSpec } from './chart'
import { sanitizeRich } from './richtext'
import type { Elem, ShapeKind, SlidesStore } from './slidesModel'

export const DEFAULT_FONT = 'Calibri, Carlito, Arial, Helvetica, sans-serif'

const POLY: Partial<Record<ShapeKind, string>> = {
  triangle: '50,0 100,100 0,100', rtTriangle: '0,0 0,100 100,100', diamond: '50,0 100,50 50,100 0,50', pentagon: '50,0 100,38 82,100 18,100 0,38',
  hexagon: '25,0 75,0 100,50 75,100 25,100 0,50', star5: '50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35',
  rightArrow: '0,30 60,30 60,0 100,50 60,100 60,70 0,70', leftArrow: '100,30 40,30 40,0 0,50 40,100 40,70 100,70',
  upArrow: '30,100 30,40 0,40 50,0 100,40 70,40 70,100', downArrow: '30,0 70,0 70,60 100,60 50,100 0,60 30,60',
}

export const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: 'rect', label: 'Rectángulo' }, { id: 'roundRect', label: 'Rectángulo redondeado' }, { id: 'ellipse', label: 'Elipse' }, { id: 'triangle', label: 'Triángulo' },
  { id: 'rtTriangle', label: 'Triángulo rectángulo' }, { id: 'diamond', label: 'Rombo' }, { id: 'pentagon', label: 'Pentágono' }, { id: 'hexagon', label: 'Hexágono' },
  { id: 'star5', label: 'Estrella' }, { id: 'rightArrow', label: 'Flecha derecha' }, { id: 'leftArrow', label: 'Flecha izquierda' }, { id: 'upArrow', label: 'Flecha arriba' },
  { id: 'downArrow', label: 'Flecha abajo' }, { id: 'line', label: 'Línea' },
]

/** `k` = píxeles por punto tipográfico de la diapositiva (las tipografías del archivo están en puntos). */
function Geometry({ e, k }: { e: Elem; k: number }) {
  const shape = e.shape ?? 'rect'
  const stroke = e.line ? Math.max(1, (e.lw ?? 1) * k) : 0
  if (shape === 'line') {
    return (
      <svg className="sl-geo" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="50" x2="100" y2="50" stroke={e.line ?? '#111827'} strokeWidth={Math.max(1, (e.lw ?? 2) * k)} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  const poly = POLY[shape]
  if (poly) {
    return (
      <svg className="sl-geo" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" opacity={e.op ?? 1}>
        <polygon points={poly} fill={e.fill ?? 'none'} stroke={e.line ?? 'none'} strokeWidth={stroke} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  const style: CSSProperties = {
    background: e.fill, opacity: e.op, border: stroke ? `${stroke}px solid ${e.line}` : undefined,
    borderRadius: shape === 'ellipse' ? '50%' : shape === 'roundRect' ? '12%' : undefined,
  }
  return e.fill || stroke ? <div className="sl-geo" style={style} /> : null
}

export function RichText({ e, k, html, children }: { e: Elem; k: number; html?: string; children?: ReactNode }) {
  const safe = useMemo(() => (html !== undefined ? sanitizeRich(html) : ''), [html])
  const style: CSSProperties = {
    zoom: k * 0.75, fontFamily: e.ff ? `${e.ff}, ${DEFAULT_FONT}` : DEFAULT_FONT, fontSize: `${e.fontSize ?? 18}pt`, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal',
    textDecoration: e.underline ? 'underline' : undefined, color: e.color ?? '#111827', textAlign: e.align ?? 'left', lineHeight: (e.ls ?? 1) * 1.2,
    justifyContent: e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start',
  }
  return (
    <div className="sl-rich" style={style}>
      {children ?? <div dangerouslySetInnerHTML={{ __html: safe }} />}
    </div>
  )
}

function TableView({ e, k }: { e: Elem; k: number }) {
  const cells = useMemo(() => {
    try {
      const v = JSON.parse(e.cells ?? '[]') as string[][]
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }, [e.cells])
  const border = `${Math.max(1, k)}px solid ${e.line ?? '#9ca3af'}`
  return (
    <table className="sl-table" style={{ zoom: k * 0.75, fontFamily: e.ff ? `${e.ff}, ${DEFAULT_FONT}` : DEFAULT_FONT, fontSize: `${e.fontSize ?? 14}pt`, color: e.color ?? '#111827' }}>
      <tbody>
        {cells.map((row, r) => (
          <tr key={r}>
            {row.map((c, i) => <td key={i} style={{ border, background: e.hdr && r === 0 ? (e.fill ?? '#e8ecf5') : undefined, fontWeight: e.hdr && r === 0 ? 700 : undefined }}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function parseSpec(s?: string): ChartSpec | null {
  try {
    return s ? (JSON.parse(s) as ChartSpec) : null
  } catch {
    return null
  }
}

export interface ViewProps { e: Elem; stageW: number; stageH: number; k: number; textOverride?: ReactNode }

/** Dibuja un elemento (sin manejadores). */
export function ElementView({ e, stageW, stageH, k, textOverride }: ViewProps) {
  const style: CSSProperties = { left: `${e.x}%`, top: `${e.y}%`, width: `${e.w}%`, height: `${e.h}%`, transform: e.rot ? `rotate(${e.rot}deg)` : undefined }
  const hasText = e.type === 'text' || e.type === 'shape'
  const spec = e.type === 'chart' ? parseSpec(e.spec) : null
  return (
    <div className={`sl-el sl-${e.type}`} style={style}>
      {e.type === 'image' && <img className="sl-img" src={e.data} alt="" draggable={false} />}
      {e.type === 'chart' && spec && <ChartView spec={spec} w={(e.w / 100) * stageW} h={(e.h / 100) * stageH} />}
      {e.type === 'table' && <TableView e={e} k={k} />}
      {hasText && <Geometry e={e} k={k} />}
      {hasText && (textOverride ?? (e.html || e.text ? <RichText e={e} k={k} html={e.html ?? ''} /> : null))}
    </div>
  )
}

/** Diapositiva de solo lectura (miniaturas, presentación). */
export const SlideView = memo(function SlideView({ store, id, width, version }: { store: SlidesStore; id: string; width: number; version: number }) {
  const height = width * (store.height / store.width)
  const k = height / (store.height * 72)
  void version
  return (
    <div className="sl-slide" style={{ width, height, background: store.bg(id) }}>
      {store.elementIds(id).map((eid) => {
        const e = store.element(id, eid)
        return e ? <ElementView key={eid} e={e} stageW={width} stageH={height} k={k} /> : null
      })}
    </div>
  )
})

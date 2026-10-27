import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut'

export interface ChartSpec {
  type: ChartType
  title?: string
  labels: string[]
  series: { name: string; values: number[] }[]
}

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'column', label: 'Columnas' }, { id: 'bar', label: 'Barras' }, { id: 'line', label: 'Líneas' },
  { id: 'area', label: 'Áreas' }, { id: 'pie', label: 'Circular' }, { id: 'doughnut', label: 'Anillo' },
]

export const PALETTE = ['#4f7cf0', '#ef7a4f', '#3fb98a', '#e2b53b', '#9a6ae8', '#e3598b', '#37aebf', '#8a94a6']

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmtNum = (n: number) => (Math.abs(n) >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 100) / 100))
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

/** Dibujo del gráfico como SVG (solo atributos de presentación, sin estilos en línea). Fondo blanco: se ve igual en cualquier tema y al exportarlo. */
export function chartSvg(spec: ChartSpec, w: number, h: number): string {
  const W = Math.max(120, w)
  const H = Math.max(90, h)
  const series = spec.series.filter((s) => s.values.length)
  const labels = spec.labels
  const n = Math.max(labels.length, ...series.map((s) => s.values.length), 1)
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="${esc(spec.title ?? 'Gráfico')}">`,
    `<rect width="${W}" height="${H}" rx="6" fill="#ffffff"/>`]
  const pie = spec.type === 'pie' || spec.type === 'doughnut'
  const legend = pie || series.length > 1
  let top = 10
  if (spec.title) {
    out.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="700" fill="#1f2937">${esc(trunc(spec.title, Math.floor(W / 8)))}</text>`)
    top = 34
  }
  const legendItems = pie ? labels.slice(0, n) : series.map((s) => s.name)
  const bottomLegend = legend ? 22 : 0
  const bottom = H - bottomLegend - 6
  if (legend) {
    let x = 12
    const y = H - 10
    legendItems.forEach((name, i) => {
      const label = trunc(name || `Serie ${i + 1}`, 18)
      const wItem = 18 + label.length * 6.2 + 10
      if (x + wItem > W) return
      out.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="${x + 15}" y="${y}" font-size="11" fill="#4b5563">${esc(label)}</text>`)
      x += wItem
    })
  }

  if (pie) {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, Number(v) || 0))
    const total = vals.reduce((a, b) => a + b, 0)
    const cx = W / 2
    const cy = (top + bottom) / 2
    const r = Math.max(20, Math.min(W / 2 - 16, (bottom - top) / 2 - 4))
    if (total <= 0) out.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-size="12" fill="#6b7280">Sin datos</text>`)
    let a0 = -Math.PI / 2
    vals.forEach((v, i) => {
      if (v <= 0) return
      const a1 = a0 + (v / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const p = (a: number, rad: number) => `${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`
      const color = PALETTE[i % PALETTE.length]
      if (vals.filter((x) => x > 0).length === 1) out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`)
      else out.push(`<path d="M ${cx} ${cy} L ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`)
      const mid = (a0 + a1) / 2
      if (v / total > 0.05) out.push(`<text x="${(cx + Math.cos(mid) * r * 0.65).toFixed(1)}" y="${(cy + Math.sin(mid) * r * 0.65 + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">${Math.round((v / total) * 100)}%</text>`)
      a0 = a1
    })
    if (spec.type === 'doughnut') out.push(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.52).toFixed(1)}" fill="#ffffff"/>`)
    out.push('</svg>')
    return out.join('')
  }

  const all = series.flatMap((s) => s.values.map((v) => Number(v) || 0))
  let min = Math.min(0, ...all)
  let max = Math.max(0, ...all)
  if (min === max) max = min + 1
  const step = niceStep((max - min) / 5)
  min = Math.floor(min / step) * step
  max = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = min; v <= max + step / 1000; v += step) ticks.push(Math.round(v / step) * step)
  const horizontal = spec.type === 'bar'
  const tickW = Math.max(...ticks.map((t) => fmtNum(t).length)) * 6.2 + 10
  const left = horizontal ? Math.min(W / 3, Math.max(40, Math.max(0, ...labels.map((l) => Math.min(l.length, 14))) * 6.2 + 12)) : tickW + 8
  const right = 14
  const axisBottom = horizontal ? 22 : 26
  const px0 = left
  const px1 = W - right
  const py0 = top + 4
  const py1 = bottom - axisBottom
  const pw = Math.max(10, px1 - px0)
  const ph = Math.max(10, py1 - py0)
  const scale = (v: number) => (horizontal ? px0 + ((v - min) / (max - min)) * pw : py1 - ((v - min) / (max - min)) * ph)
  const band = (horizontal ? ph : pw) / n

  for (const t of ticks) {
    const p = scale(t)
    if (horizontal) out.push(`<line x1="${p}" y1="${py0}" x2="${p}" y2="${py1}" stroke="#e5e7eb"/><text x="${p}" y="${py1 + 14}" text-anchor="middle" font-size="10" fill="#6b7280">${fmtNum(t)}</text>`)
    else out.push(`<line x1="${px0}" y1="${p}" x2="${px1}" y2="${p}" stroke="#e5e7eb"/><text x="${px0 - 6}" y="${p + 3.5}" text-anchor="end" font-size="10" fill="#6b7280">${fmtNum(t)}</text>`)
  }
  for (let i = 0; i < n; i++) {
    const label = esc(trunc(labels[i] ?? String(i + 1), horizontal ? 14 : Math.max(3, Math.floor(band / 6))))
    if (horizontal) out.push(`<text x="${px0 - 6}" y="${py0 + band * i + band / 2 + 3.5}" text-anchor="end" font-size="10" fill="#4b5563">${label}</text>`)
    else out.push(`<text x="${px0 + band * i + band / 2}" y="${py1 + 15}" text-anchor="middle" font-size="10" fill="#4b5563">${label}</text>`)
  }
  const zero = scale(0)
  const k = Math.max(1, series.length)
  series.forEach((s, si) => {
    const color = PALETTE[si % PALETTE.length]!
    const pts = s.values.map((v, i) => {
      const cat = (horizontal ? py0 : px0) + band * i + band / 2
      return horizontal ? [scale(Number(v) || 0), cat] : [cat, scale(Number(v) || 0)]
    })
    if (spec.type === 'column' || spec.type === 'bar') {
      const bw = Math.max(2, (band * 0.72) / k)
      s.values.forEach((v, i) => {
        const val = scale(Number(v) || 0)
        const offset = band * 0.14 + bw * si
        if (horizontal) out.push(`<rect x="${Math.min(val, zero).toFixed(1)}" y="${(py0 + band * i + offset).toFixed(1)}" width="${Math.abs(val - zero).toFixed(1)}" height="${bw.toFixed(1)}" rx="2" fill="${color}"/>`)
        else out.push(`<rect x="${(px0 + band * i + offset).toFixed(1)}" y="${Math.min(val, zero).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(val - zero).toFixed(1)}" rx="2" fill="${color}"/>`)
      })
    } else if (pts.length) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]!.toFixed(1)} ${p[1]!.toFixed(1)}`).join(' ')
      if (spec.type === 'area') out.push(`<path d="${d} L ${pts[pts.length - 1]![0]!.toFixed(1)} ${zero.toFixed(1)} L ${pts[0]![0]!.toFixed(1)} ${zero.toFixed(1)} Z" fill="${color}" fill-opacity="0.28"/>`)
      out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`)
      pts.forEach((p) => out.push(`<circle cx="${p[0]!.toFixed(1)}" cy="${p[1]!.toFixed(1)}" r="3" fill="#ffffff" stroke="${color}" stroke-width="2"/>`))
    }
  })
  out.push(horizontal ? `<line x1="${zero}" y1="${py0}" x2="${zero}" y2="${py1}" stroke="#9ca3af"/>` : `<line x1="${px0}" y1="${zero}" x2="${px1}" y2="${zero}" stroke="#9ca3af"/>`)
  out.push('</svg>')
  return out.join('')
}

/** Gráfico vectorial dentro de la interfaz. */
export function ChartView({ spec, w, h }: { spec: ChartSpec; w: number; h: number }) {
  const svg = useMemo(() => chartSvg(spec, w, h), [spec, w, h])
  return <div className="chart-box" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** Imagen PNG (data URL) del gráfico, para llevarlo a documentos de texto y hojas exportadas. */
export function chartPng(spec: ChartSpec, w: number, h: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([chartSvg(spec, w, h)], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = Math.round(w * scale)
      c.height = Math.round(h * scale)
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo dibujar el gráfico'))
    }
    img.src = url
  })
}

/** Datos de un gráfico a partir de una tabla de valores (fila de títulos y columna de etiquetas opcionales). */
export function specFromGrid(grid: (string | number | boolean | null)[][], type: ChartType, title?: string): ChartSpec {
  const rows = grid.length
  const cols = Math.max(0, ...grid.map((r) => r.length))
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  const header = rows > 1 && cols > 1 && grid[0]!.slice(1).some((v) => typeof v === 'string' && v !== '') && !grid[0]!.slice(1).every(isNum)
  const labelCol = cols > 1 && grid.slice(header ? 1 : 0).some((r) => typeof r[0] === 'string' && r[0] !== '')
  const body = grid.slice(header ? 1 : 0)
  const c0 = labelCol ? 1 : 0
  const labels = body.map((r, i) => (labelCol ? text(r[0]) : String(i + 1)))
  const series = []
  for (let c = c0; c < cols; c++) series.push({ name: header ? text(grid[0]![c]) || `Serie ${c - c0 + 1}` : `Serie ${c - c0 + 1}`, values: body.map((r) => (isNum(r[c]) ? (r[c] as number) : Number(r[c]) || 0)) })
  return { type, title, labels, series }
}

/** Editor de gráficos con tabla de datos propia (documentos y presentaciones). */
export function ChartDialog({ initial, onOk, onCancel }: { initial?: ChartSpec; onOk: (s: ChartSpec) => void; onCancel: () => void }) {
  const [spec, setSpec] = useState<ChartSpec>(initial ?? {
    type: 'column', title: 'Ventas por trimestre', labels: ['T1', 'T2', 'T3', 'T4'],
    series: [{ name: 'Este año', values: [12, 19, 14, 23] }, { name: 'Año anterior', values: [9, 14, 13, 17] }],
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const setLabel = (i: number, v: string) => setSpec((s) => ({ ...s, labels: s.labels.map((l, j) => (j === i ? v : l)) }))
  const setVal = (si: number, i: number, v: string) => setSpec((s) => ({ ...s, series: s.series.map((x, j) => (j === si ? { ...x, values: x.values.map((n, k) => (k === i ? (Number(v.replace(',', '.')) || 0) : n)) } : x)) }))
  const addRow = () => setSpec((s) => ({ ...s, labels: [...s.labels, `Dato ${s.labels.length + 1}`], series: s.series.map((x) => ({ ...x, values: [...x.values, 0] })) }))
  const delRow = (i: number) => setSpec((s) => (s.labels.length < 2 ? s : { ...s, labels: s.labels.filter((_, j) => j !== i), series: s.series.map((x) => ({ ...x, values: x.values.filter((_, j) => j !== i) })) }))
  const addSeries = () => setSpec((s) => (s.series.length >= 8 ? s : { ...s, series: [...s.series, { name: `Serie ${s.series.length + 1}`, values: s.labels.map(() => 0) }] }))
  const delSeries = (si: number) => setSpec((s) => (s.series.length < 2 ? s : { ...s, series: s.series.filter((_, j) => j !== si) }))
  return (
    <div className="modal-backdrop" style={{ zIndex: 90 }} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal chart-dialog" role="dialog" aria-modal="true" aria-label="Gráfico">
        <div className="chart-dialog-grid">
          <div className="stack">
            <strong>Datos del gráfico</strong>
            <div className="row">
              <label className="grow">Tipo<select value={spec.type} onChange={(e) => setSpec({ ...spec, type: e.target.value as ChartType })}>{CHART_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
              <label className="grow">Título<input value={spec.title ?? ''} maxLength={80} onChange={(e) => setSpec({ ...spec, title: e.target.value })} /></label>
            </div>
            <div className="chart-table-wrap">
              <table className="chart-table">
                <thead>
                  <tr>
                    <th />
                    {spec.series.map((s, si) => (
                      <th key={si}><input aria-label={`Nombre de la serie ${si + 1}`} value={s.name} onChange={(e) => setSpec((p) => ({ ...p, series: p.series.map((x, j) => (j === si ? { ...x, name: e.target.value } : x)) }))} />
                        {spec.series.length > 1 && <button className="icon-btn sm" aria-label="Quitar serie" onClick={() => delSeries(si)}><Trash2 size={12} /></button>}</th>
                    ))}
                    <th><button className="icon-btn sm" aria-label="Añadir serie" title="Añadir serie" onClick={addSeries}><Plus size={14} /></button></th>
                  </tr>
                </thead>
                <tbody>
                  {spec.labels.map((l, i) => (
                    <tr key={`${i}:${spec.labels.length}:${spec.series.length}`}>
                      <td><input aria-label={`Etiqueta ${i + 1}`} value={l} onChange={(e) => setLabel(i, e.target.value)} /></td>
                      {spec.series.map((s, si) => <td key={si}><input inputMode="decimal" aria-label={`Valor ${i + 1} de ${s.name}`} defaultValue={s.values[i]} onChange={(e) => setVal(si, i, e.target.value)} /></td>)}
                      <td><button className="icon-btn sm" aria-label="Quitar fila" onClick={() => delRow(i)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn sm" onClick={addRow}><Plus size={14} /> Añadir fila</button>
          </div>
          <div className="stack">
            <strong>Vista previa</strong>
            <ChartView spec={spec} w={360} h={260} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" onClick={() => onOk(spec)}>{initial ? 'Aplicar' : 'Insertar gráfico'}</button>
        </div>
      </div>
    </div>
  )
}

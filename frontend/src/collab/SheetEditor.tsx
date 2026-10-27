import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import * as Y from 'yjs'
import { Bold, Italic, Plus, Redo2, Underline, Undo2, X } from 'lucide-react'
import type { CollabProvider } from './provider'
import { SheetStore, addr, colName, colIndex, key, type Cell, type CellStyle } from './sheetModel'
import { Evaluator, display, isError, type Computed } from './formulas'

const ROW_H = 26
const HEAD_H = 26
const GUTTER = 46
const DEFAULT_W = 100
const FORMATS: [string, string][] = [['', 'General'], ['0.00', '1234,50'], ['#,##0.00', '1.234,50'], ['0%', 'Porcentaje'], ['$#,##0.00', 'Moneda'], ['dd/mm/yyyy', 'Fecha']]

interface Sel { r1: number; c1: number; r2: number; c2: number }
const norm = (s: Sel): Sel => ({ r1: Math.min(s.r1, s.r2), c1: Math.min(s.c1, s.c2), r2: Math.max(s.r1, s.r2), c2: Math.max(s.c1, s.c2) })

/** Texto → celda: número, VERDADERO/FALSO o texto; si empieza por "=" es una fórmula. */
function parseInput(text: string, prev?: Cell): Cell | null {
  const s = prev?.s
  const withStyle = (c: Cell): Cell => (s ? { ...c, s } : c)
  if (text === '') return s ? { v: '', s } : null
  if (text.startsWith('=') && text.length > 1) return withStyle({ v: '', f: text.slice(1) })
  const n = text.trim() !== '' && /^[-+]?(\d+([.,]\d+)?|[.,]\d+)(e[-+]?\d+)?$/i.test(text.trim()) ? Number(text.trim().replace(',', '.')) : NaN
  if (!Number.isNaN(n)) return withStyle({ v: n })
  if (/^(true|verdadero)$/i.test(text.trim())) return withStyle({ v: true })
  if (/^(false|falso)$/i.test(text.trim())) return withStyle({ v: false })
  return withStyle({ v: text })
}

const raw = (c?: Cell) => (!c ? '' : c.f ? `=${c.f}` : String(c.v))

interface Props { provider: CollabProvider; editable: boolean }

export default function SheetEditor({ provider, editable }: Props) {
  const doc = provider.doc
  const store = useMemo(() => new SheetStore(doc), [doc])
  const evaluator = useMemo(() => new Evaluator(store), [store])
  const [, setTick] = useState(0)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [sel, setSel] = useState<Sel>({ r1: 0, c1: 0, r2: 0, c2: 0 })
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null)
  const [scroll, setScroll] = useState({ x: 0, y: 0, w: 800, h: 500 })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [peers, setPeers] = useState<{ clientId: number; name: string; color: string; sheet: string; r: number; c: number }[]>([])
  const viewport = useRef<HTMLDivElement>(null)
  const undo = useRef<Y.UndoManager | null>(null)
  const dragging = useRef(false)
  const ids = store.ids()
  const active = sheetId && ids.includes(sheetId) ? sheetId : ids[0] ?? null
  const meta = active ? store.meta(active) : null

  // Cualquier cambio del documento (propio o ajeno) repinta y vacía la caché de fórmulas
  useEffect(() => {
    let raf = 0
    const onUpdate = () => {
      evaluator.clear()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setTick((t) => t + 1))
    }
    doc.on('update', onUpdate)
    onUpdate()
    return () => {
      doc.off('update', onUpdate)
      cancelAnimationFrame(raf)
    }
  }, [doc, evaluator])

  // Deshacer/rehacer solo de los cambios propios
  useEffect(() => {
    const um = new Y.UndoManager([store.order, store.metas], { captureTimeout: 500 })
    undo.current = um
    return () => um.destroy()
  }, [store])
  useEffect(() => {
    if (active) undo.current?.addToScope(store.cellsOf(active))
  }, [active, store])

  // Presencia: dónde está cada persona
  useEffect(() => {
    const read = () => {
      const out: typeof peers = []
      provider.awareness.getStates().forEach((st, clientId) => {
        const s = st as { user?: { name: string; color: string }; sheetSel?: { sheet: string; r: number; c: number } }
        if (clientId !== doc.clientID && s.user && s.sheetSel) out.push({ clientId, name: s.user.name, color: s.user.color, ...s.sheetSel })
      })
      setPeers(out)
    }
    provider.awareness.on('change', read)
    read()
    return () => provider.awareness.off('change', read)
  }, [provider, doc])
  useEffect(() => {
    if (active) provider.awareness.setLocalStateField('sheetSel', { sheet: active, r: sel.r2, c: sel.c2 })
  }, [provider, active, sel.r2, sel.c2])

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => setScroll((s) => ({ ...s, w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])

  const colW = useCallback((c: number) => meta?.colWidths[c] ?? DEFAULT_W, [meta])
  const colX = useMemo(() => {
    const xs = [0]
    for (let c = 0; c < (meta?.cols ?? 0); c++) xs.push(xs[c]! + colW(c))
    return xs
  }, [meta, colW])
  const totalW = colX[colX.length - 1] ?? 0
  const totalH = (meta?.rows ?? 0) * ROW_H

  // Celdas combinadas: la de arriba a la izquierda abarca el rango; las demás no se pintan
  const merges = useMemo(() => {
    const spans = new Map<string, { rows: number; cols: number }>()
    const covered = new Set<string>()
    for (const m of meta?.merges ?? []) {
      const [a, b] = m.split(':')
      const pa = /^([A-Z]+)(\d+)$/.exec(a ?? '')
      const pb = /^([A-Z]+)(\d+)$/.exec(b ?? '')
      if (!pa || !pb) continue
      const r1 = Number(pa[2]) - 1, c1 = colIndex(pa[1]!), r2 = Number(pb[2]) - 1, c2 = colIndex(pb[1]!)
      spans.set(key(r1, c1), { rows: r2 - r1 + 1, cols: c2 - c1 + 1 })
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(key(r, c))
    }
    return { spans, covered }
  }, [meta])

  const valueAt = (r: number, c: number): Computed => (active ? evaluator.valueOf(active, r, c) : '')
  const cellAt = (r: number, c: number) => (active ? store.getCell(active, r, c) : undefined)

  // ---- edición ----
  const commit = useCallback((r: number, c: number, text: string) => {
    if (!active || !editable) return
    doc.transact(() => store.setCell(active, r, c, parseInput(text, store.getCell(active, r, c))))
  }, [active, doc, editable, store])

  const startEdit = (r: number, c: number, text?: string) => {
    if (!editable) return
    setEditing({ r, c, text: text ?? raw(cellAt(r, c)) })
  }

  const finishEdit = (move?: 'down' | 'right' | 'none' | 'cancel') => {
    if (!editing) return
    if (move !== 'cancel') commit(editing.r, editing.c, editing.text)
    const { r, c } = editing
    setEditing(null)
    viewport.current?.focus()
    if (move === 'down') moveTo(r + 1, c)
    else if (move === 'right') moveTo(r, c + 1)
  }

  const moveTo = (r: number, c: number, extend = false) => {
    if (!meta) return
    const rr = Math.max(0, Math.min(meta.rows - 1, r))
    const cc = Math.max(0, Math.min(meta.cols - 1, c))
    setSel((s) => (extend ? { ...s, r2: rr, c2: cc } : { r1: rr, c1: cc, r2: rr, c2: cc }))
    // mantener visible
    const el = viewport.current
    if (!el) return
    const top = rr * ROW_H
    const left = colX[cc] ?? 0
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = top + ROW_H - el.clientHeight + HEAD_H
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + colW(cc) > el.scrollLeft + el.clientWidth - GUTTER) el.scrollLeft = left + colW(cc) - el.clientWidth + GUTTER
  }

  const forEachSel = (fn: (r: number, c: number) => void) => {
    const s = norm(sel)
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) fn(r, c)
  }

  const clearSel = () => {
    if (!active || !editable) return
    doc.transact(() => forEachSel((r, c) => {
      const cell = store.getCell(active, r, c)
      store.setCell(active, r, c, cell?.s ? { v: '', s: cell.s } : null)
    }))
  }

  const applyStyle = (patch: Partial<CellStyle> | null) => {
    if (!active || !editable) return
    doc.transact(() => forEachSel((r, c) => {
      const cell = store.getCell(active, r, c) ?? { v: '' }
      const s: CellStyle | undefined = patch === null ? undefined : { ...cell.s, ...patch }
      if (s) for (const k of Object.keys(s) as (keyof CellStyle)[]) if (s[k] === undefined || s[k] === '') delete s[k]
      const next: Cell = { v: cell.v, ...(cell.f ? { f: cell.f } : {}), ...(s && Object.keys(s).length ? { s } : {}) }
      store.setCell(active, r, c, next)
    }))
  }

  const anchorStyle = cellAt(sel.r1, sel.c1)?.s ?? {}
  const toggle = (k: 'b' | 'i' | 'u') => applyStyle({ [k]: anchorStyle[k] ? undefined : 1 } as Partial<CellStyle>)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo.current?.redo(); else undo.current?.undo(); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo.current?.redo(); return }
    if (mod && (e.key === 'b' || e.key === 'i' || e.key === 'u')) { e.preventDefault(); toggle(e.key as 'b' | 'i' | 'u'); return }
    if (mod) return // copiar/pegar los gestionan los eventos copy/paste
    const ext = e.shiftKey
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (ext) moveTo(sel.r2 + 1, sel.c2, true); else moveTo(sel.r1 + 1, sel.c1); break
      case 'ArrowUp': e.preventDefault(); if (ext) moveTo(sel.r2 - 1, sel.c2, true); else moveTo(sel.r1 - 1, sel.c1); break
      case 'ArrowRight': e.preventDefault(); if (ext) moveTo(sel.r2, sel.c2 + 1, true); else moveTo(sel.r1, sel.c1 + 1); break
      case 'ArrowLeft': e.preventDefault(); if (ext) moveTo(sel.r2, sel.c2 - 1, true); else moveTo(sel.r1, sel.c1 - 1); break
      case 'Tab': e.preventDefault(); moveTo(sel.r1, sel.c1 + (ext ? -1 : 1)); break
      case 'Enter': e.preventDefault(); startEdit(sel.r1, sel.c1); break
      case 'F2': e.preventDefault(); startEdit(sel.r1, sel.c1); break
      case 'Delete': case 'Backspace': e.preventDefault(); clearSel(); break
      default:
        if (editable && e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.r1, sel.c1, e.key) }
    }
  }

  const onCopy = (e: ClipboardEvent) => {
    if (editing) return
    const s = norm(sel)
    const rows: string[] = []
    for (let r = s.r1; r <= s.r2; r++) {
      const line: string[] = []
      for (let c = s.c1; c <= s.c2; c++) line.push(raw(cellAt(r, c)).replace(/\t|\r|\n/g, ' '))
      rows.push(line.join('\t'))
    }
    e.clipboardData.setData('text/plain', rows.join('\n'))
    e.preventDefault()
  }

  const onPaste = (e: ClipboardEvent) => {
    if (editing || !editable || !active) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const s = norm(sel)
    doc.transact(() => {
      grid.forEach((row, i) => row.forEach((t, j) => {
        const r = s.r1 + i, c = s.c1 + j
        if (meta && r < meta.rows && c < meta.cols) store.setCell(active, r, c, parseInput(t, store.getCell(active, r, c)))
      }))
    })
    setSel({ r1: s.r1, c1: s.c1, r2: Math.min((meta?.rows ?? 1) - 1, s.r1 + grid.length - 1), c2: Math.min((meta?.cols ?? 1) - 1, s.c1 + Math.max(...grid.map((g) => g.length)) - 1) })
  }

  // ---- ratón ----
  const cellFromEvent = (e: MouseEvent) => {
    const el = viewport.current!
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left + el.scrollLeft - GUTTER
    const y = e.clientY - rect.top + el.scrollTop - HEAD_H
    let c = 0
    while (c < (meta?.cols ?? 1) - 1 && (colX[c + 1] ?? 0) <= x) c++
    return { r: Math.max(0, Math.min((meta?.rows ?? 1) - 1, Math.floor(y / ROW_H))), c }
  }

  const onMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sheet-edit, .col-resize')) return
    const rect = viewport.current!.getBoundingClientRect()
    if (e.clientX - rect.left < GUTTER || e.clientY - rect.top < HEAD_H) return
    if (editing) finishEdit('none')
    const { r, c } = cellFromEvent(e)
    dragging.current = true
    setSel((s) => (e.shiftKey ? { ...s, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }))
    viewport.current?.focus()
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return
    const { r, c } = cellFromEvent(e)
    setSel((s) => (s.r2 === r && s.c2 === c ? s : { ...s, r2: r, c2: c }))
  }
  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const startResize = (c: number, e: MouseEvent) => {
    if (!active || !editable) return
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = colW(c)
    const move = (ev: globalThis.MouseEvent) => {
      const w = Math.max(30, Math.min(600, Math.round(w0 + ev.clientX - x0)))
      store.patchMeta(active, { colWidths: { ...store.meta(active).colWidths, [c]: w } })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- pintado (solo lo visible) ----
  const firstRow = Math.max(0, Math.floor(scroll.y / ROW_H) - 2)
  const lastRow = Math.min((meta?.rows ?? 0) - 1, Math.ceil((scroll.y + scroll.h) / ROW_H) + 2)
  let firstCol = 0
  while (firstCol < (meta?.cols ?? 0) - 1 && (colX[firstCol + 1] ?? 0) < scroll.x) firstCol++
  firstCol = Math.max(0, firstCol - 1)
  let lastCol = firstCol
  while (lastCol < (meta?.cols ?? 0) - 1 && (colX[lastCol] ?? 0) < scroll.x + scroll.w) lastCol++

  const s = norm(sel)
  const cells: React.ReactNode[] = []
  if (meta && active) {
    for (let r = firstRow; r <= lastRow; r++) {
      for (let c = firstCol; c <= lastCol; c++) {
        const k = key(r, c)
        if (merges.covered.has(k)) continue
        const cell = cellAt(r, c)
        const span = merges.spans.get(k)
        const val = valueAt(r, c)
        const w = span ? (colX[c + span.cols] ?? 0) - (colX[c] ?? 0) : colW(c)
        const st = cell?.s
        const num = typeof val === 'number' && !st?.align
        cells.push(
          <div key={k} className={`sh-cell ${isError(val) ? 'err' : ''} ${num || st?.align === 'right' ? 'r' : st?.align === 'center' ? 'c' : ''}`}
            style={{
              left: colX[c], top: r * ROW_H, width: w, height: ROW_H * (span?.rows ?? 1),
              fontWeight: st?.b ? 700 : undefined, fontStyle: st?.i ? 'italic' : undefined, textDecoration: st?.u ? 'underline' : undefined,
              color: st?.color, background: st?.bg,
            }}>
            {display(val, st?.fmt)}
          </div>,
        )
      }
    }
  }

  const selBox = meta && {
    left: colX[s.c1] ?? 0, top: s.r1 * ROW_H, width: (colX[s.c2 + 1] ?? colX[s.c2] ?? 0) - (colX[s.c1] ?? 0), height: (s.r2 - s.r1 + 1) * ROW_H,
  }

  if (!active || !meta) return <div className="empty"><strong>Este libro no tiene hojas</strong>{editable && <button className="btn" onClick={() => setSheetId(store.addSheet('Hoja 1'))}>Crear hoja</button>}</div>

  const formulaText = editing ? editing.text : raw(cellAt(sel.r1, sel.c1))

  return (
    <div className="sheet-editor">
      {editable && (
        <div className="toolbar" role="toolbar" aria-label="Formato de celdas">
          <button className="tb" aria-label="Deshacer" title="Deshacer" onClick={() => undo.current?.undo()}><Undo2 size={16} /></button>
          <button className="tb" aria-label="Rehacer" title="Rehacer" onClick={() => undo.current?.redo()}><Redo2 size={16} /></button>
          <span className="tb-sep" />
          <button className={`tb ${anchorStyle.b ? 'on' : ''}`} aria-label="Negrita" title="Negrita" onClick={() => toggle('b')}><Bold size={16} /></button>
          <button className={`tb ${anchorStyle.i ? 'on' : ''}`} aria-label="Cursiva" title="Cursiva" onClick={() => toggle('i')}><Italic size={16} /></button>
          <button className={`tb ${anchorStyle.u ? 'on' : ''}`} aria-label="Subrayado" title="Subrayado" onClick={() => toggle('u')}><Underline size={16} /></button>
          <label className="tb color" title="Color del texto"><span className="sr-only">Color del texto</span><span className="tb-a" style={{ ['--c' as string]: anchorStyle.color ?? 'var(--text)' }}>A</span>
            <input type="color" value={anchorStyle.color ?? '#000000'} onChange={(e) => applyStyle({ color: e.target.value })} /></label>
          <label className="tb color" title="Color de relleno"><span className="sr-only">Color de relleno</span><span className="tb-fill" style={{ ['--c' as string]: anchorStyle.bg ?? 'transparent' }} />
            <input type="color" value={anchorStyle.bg ?? '#ffffff'} onChange={(e) => applyStyle({ bg: e.target.value })} /></label>
          <select className="tb-select" aria-label="Alineación" value={anchorStyle.align ?? ''} onChange={(e) => applyStyle({ align: (e.target.value || undefined) as CellStyle['align'] })}>
            <option value="">Alinear: auto</option><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option>
          </select>
          <select className="tb-select" aria-label="Formato numérico" value={anchorStyle.fmt ?? ''} onChange={(e) => applyStyle({ fmt: e.target.value || undefined })}>
            {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="tb txt" onClick={() => applyStyle(null)}>Quitar formato</button>
        </div>
      )}
      <div className="formula-bar">
        <span className="fb-ref">{addr(sel.r1, sel.c1)}{(sel.r1 !== sel.r2 || sel.c1 !== sel.c2) ? `:${addr(s.r2, s.c2)}` : ''}</span>
        <input className="fb-input" aria-label="Contenido de la celda" value={formulaText} readOnly={!editable} placeholder="ƒx"
          onFocus={() => { if (!editing && editable) startEdit(sel.r1, sel.c1) }}
          onChange={(e) => setEditing({ r: sel.r1, c: sel.c1, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finishEdit('down') } else if (e.key === 'Escape') finishEdit('cancel') }} />
      </div>

      <div ref={viewport} className="sheet-viewport" tabIndex={0} role="grid" aria-label="Hoja de cálculo"
        onScroll={(e) => setScroll((p) => ({ ...p, x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop }))}
        onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste} onCut={(e) => { onCopy(e as unknown as ClipboardEvent); clearSel() }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onDoubleClick={(e) => { const rect = viewport.current!.getBoundingClientRect(); if (e.clientX - rect.left > GUTTER && e.clientY - rect.top > HEAD_H) startEdit(sel.r1, sel.c1) }}>
        <div className="sheet-canvas" style={{ width: totalW + GUTTER, height: totalH + HEAD_H }}>
          {/* encabezados de columna y fila (fijos al desplazar) */}
          <div className="sh-corner" style={{ left: scroll.x, top: scroll.y, width: GUTTER, height: HEAD_H }} />
          <div className="sh-colheads" style={{ left: GUTTER, top: scroll.y, width: totalW, height: HEAD_H }}>
            {Array.from({ length: lastCol - firstCol + 1 }, (_, i) => firstCol + i).map((c) => (
              <div key={c} className={`sh-colhead ${c >= s.c1 && c <= s.c2 ? 'on' : ''}`} style={{ left: colX[c], width: colW(c) }}>
                {colName(c)}
                <span className="col-resize" onMouseDown={(e) => startResize(c, e)} />
              </div>
            ))}
          </div>
          <div className="sh-rowheads" style={{ left: scroll.x, top: HEAD_H, width: GUTTER, height: totalH }}>
            {Array.from({ length: lastRow - firstRow + 1 }, (_, i) => firstRow + i).map((r) => (
              <div key={r} className={`sh-rowhead ${r >= s.r1 && r <= s.r2 ? 'on' : ''}`} style={{ top: r * ROW_H, height: ROW_H }}>{r + 1}</div>
            ))}
          </div>
          <div className="sh-body" style={{ left: GUTTER, top: HEAD_H, width: totalW, height: totalH }}>
            {cells}
            {peers.filter((p) => p.sheet === active).map((p) => (
              <div key={p.clientId} className="sh-peer" style={{ left: colX[p.c], top: p.r * ROW_H, width: colW(p.c), height: ROW_H, borderColor: p.color }}>
                <span style={{ background: p.color }}>{p.name}</span>
              </div>
            ))}
            {selBox && <div className="sh-sel" style={selBox} />}
            {editing && (
              <input className="sheet-edit" autoFocus value={editing.text} aria-label="Editar celda"
                style={{ left: colX[editing.c], top: editing.r * ROW_H, minWidth: colW(editing.c), height: ROW_H }}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') { e.preventDefault(); finishEdit('down') }
                  else if (e.key === 'Tab') { e.preventDefault(); finishEdit('right') }
                  else if (e.key === 'Escape') { e.preventDefault(); finishEdit('cancel') }
                }}
                onBlur={() => { if (editing) finishEdit('none') }} />
            )}
          </div>
          {editable && (
            <div className="sheet-more" style={{ left: scroll.x + GUTTER + 8, top: scroll.y + Math.max(scroll.h - 36, 0) }}>
              <button className="btn sm" onClick={() => store.patchMeta(active, { rows: meta.rows + 50 })}><Plus size={14} /> 50 filas</button>
              <button className="btn sm" onClick={() => store.patchMeta(active, { cols: meta.cols + 10 })}><Plus size={14} /> 10 columnas</button>
            </div>
          )}
        </div>
      </div>

      <div className="sheet-tabs" role="tablist" aria-label="Hojas">
        {ids.map((id) => (
          renaming === id ? (
            <input key={id} className="tab-rename" autoFocus defaultValue={store.meta(id).name}
              onBlur={(e) => { store.patchMeta(id, { name: e.target.value.trim().slice(0, 60) || store.meta(id).name }); setRenaming(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} />
          ) : (
            <button key={id} role="tab" aria-selected={id === active} className={`sheet-tab ${id === active ? 'on' : ''}`}
              onClick={() => { setSheetId(id); setSel({ r1: 0, c1: 0, r2: 0, c2: 0 }) }} onDoubleClick={() => editable && setRenaming(id)}>
              {store.meta(id).name}
              {editable && ids.length > 1 && id === active && (
                <span className="tab-x" role="button" aria-label={`Eliminar ${store.meta(id).name}`}
                  onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar la hoja «${store.meta(id).name}»?`)) store.removeSheet(id) }}><X size={12} /></span>
              )}
            </button>
          )
        ))}
        {editable && <button className="sheet-tab add" aria-label="Añadir hoja" onClick={() => setSheetId(store.addSheet(`Hoja ${ids.length + 1}`))}><Plus size={14} /></button>}
      </div>
    </div>
  )
}

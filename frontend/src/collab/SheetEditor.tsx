import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import * as Y from 'yjs'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import type { CollabProvider } from './provider'
import { SheetStore, addr, colName, key, parseKey, type Cell, type CellStyle, type ChartObj } from './sheetModel'
import { Evaluator, display, isError, toLocalFormula, toStoredFormula, changeDecimals, type Computed } from './formulas'
import { translateFormula, parseRange, rangeText } from './refs'
import { CHART_TYPES, ChartView, type ChartSpec, type ChartType } from './chart'
import { chartSpecOf } from './sheetCharts'
import SheetRibbon, { type RibbonApi } from './SheetRibbon'

const ROW_H = 26
const HEAD_H = 26
const GUTTER = 46
const DEFAULT_W = 100

interface Sel { r1: number; c1: number; r2: number; c2: number }
const norm = (s: Sel): Sel => ({ r1: Math.min(s.r1, s.r2), c1: Math.min(s.c1, s.c2), r2: Math.max(s.r1, s.r2), c2: Math.max(s.c1, s.c2) })

/** Texto → celda: número, fecha, VERDADERO/FALSO o texto; si empieza por "=" es una fórmula. */
function parseInput(text: string, prev?: Cell): Cell | null {
  let s = prev?.s
  const withStyle = (c: Cell): Cell => (s ? { ...c, s } : c)
  if (text === '') return s ? { v: '', s } : null
  if (text.startsWith('=') && text.length > 1) return withStyle({ v: '', f: toStoredFormula(text.slice(1)) })
  const t = text.trim()
  const n = t !== '' && /^[-+]?(\d+([.,]\d+)?|[.,]\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t.replace(',', '.')) : NaN
  if (!Number.isNaN(n)) return withStyle({ v: n })
  const pct = /^([-+]?\d+(?:[.,]\d+)?)\s*%$/.exec(t)
  if (pct) {
    s = { ...s, fmt: s?.fmt && s.fmt.includes('%') ? s.fmt : '0%' }
    return { v: Number(pct[1]!.replace(',', '.')) / 100, s }
  }
  const date = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t)
  if (date) {
    const [d, m, y] = [Number(date[1]), Number(date[2]), Number(date[3])]
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      s = { ...s, fmt: s?.fmt && /[ymd]/i.test(s.fmt) ? s.fmt : 'dd/mm/yyyy' }
      return { v: Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000), s }
    }
  }
  if (/^(true|verdadero)$/i.test(t)) return withStyle({ v: true })
  if (/^(false|falso)$/i.test(t)) return withStyle({ v: false })
  return withStyle({ v: text })
}

const raw = (c?: Cell) => (!c ? '' : c.f ? `=${toLocalFormula(c.f)}` : typeof c.v === 'boolean' ? (c.v ? 'VERDADERO' : 'FALSO') : String(c.v))

interface Props { provider: CollabProvider; editable: boolean }

interface ClipData { text: string; r: number; c: number; cells: (Cell | undefined)[][] }

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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [chartSel, setChartSel] = useState<string | null>(null)
  const [chartDlg, setChartDlg] = useState<null | { id: string | null; draft: ChartObj }>(null)
  const [finding, setFinding] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const undo = useRef<Y.UndoManager | null>(null)
  const dragging = useRef(false)
  const clip = useRef<ClipData | null>(null)
  const ids = store.ids()
  const active = sheetId && ids.includes(sheetId) ? sheetId : ids[0] ?? null
  const meta = active ? store.meta(active) : null
  const frozen = Math.min(meta?.freeze ?? 0, meta?.rows ?? 0)

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

  // Deshacer/rehacer solo de los cambios propios (incluye las celdas de todas las hojas: insertar filas toca varias)
  useEffect(() => {
    const um = new Y.UndoManager([store.order, store.metas, store.charts], { captureTimeout: 500 })
    undo.current = um
    return () => um.destroy()
  }, [store])
  const idsKey = ids.join(',')
  useEffect(() => {
    for (const id of store.ids()) undo.current?.addToScope(store.cellsOf(id))
  }, [idsKey, store])

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
      const p = parseRange(m)
      if (!p) continue
      spans.set(key(p.r1, p.c1), { rows: p.r2 - p.r1 + 1, cols: p.c2 - p.c1 + 1 })
      for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) if (r !== p.r1 || c !== p.c1) covered.add(key(r, c))
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
    const owner = store.mergeAt(active!, r, c)
    const p = owner ? parseRange(owner) : null
    const rr = p ? p.r1 : r
    const cc = p ? p.c1 : c
    setEditing({ r: rr, c: cc, text: text ?? raw(cellAt(rr, cc)) })
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
    const el = viewport.current
    if (!el) return
    const top = rr * ROW_H
    const left = colX[cc] ?? 0
    const topLimit = el.scrollTop + frozen * ROW_H
    if (rr >= frozen) {
      if (top < topLimit) el.scrollTop = top - frozen * ROW_H
      else if (top + ROW_H > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = top + ROW_H - el.clientHeight + HEAD_H
    }
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + colW(cc) > el.scrollLeft + el.clientWidth - GUTTER) el.scrollLeft = left + colW(cc) - el.clientWidth + GUTTER
  }

  const s = norm(sel)
  const forEachSel = (fn: (r: number, c: number) => void) => {
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
      const st: CellStyle | undefined = patch === null ? undefined : { ...cell.s, ...patch }
      if (st) for (const k of Object.keys(st) as (keyof CellStyle)[]) if (st[k] === undefined || st[k] === '') delete st[k]
      const next: Cell = { v: cell.v, ...(cell.f ? { f: cell.f } : {}), ...(st && Object.keys(st).length ? { s: st } : {}) }
      store.setCell(active, r, c, next)
    }))
  }

  const anchorStyle: CellStyle = cellAt(s.r1, s.c1)?.s ?? {}
  const toggle = (k: 'b' | 'i' | 'u' | 'st') => applyStyle({ [k]: anchorStyle[k] ? undefined : 1 } as Partial<CellStyle>)

  /** Bordes de la selección: 'all' | 'outer' | 'none' | 't' | 'b' | 'l' | 'r'. */
  const setBorders = (kind: string) => {
    if (!active || !editable) return
    doc.transact(() => forEachSel((r, c) => {
      const cell = store.getCell(active, r, c) ?? { v: '' }
      const cur = new Set((cell.s?.bd ?? '').split(''))
      const edges = { t: r === s.r1, b: r === s.r2, l: c === s.c1, r: c === s.c2 }
      if (kind === 'none') cur.clear()
      else if (kind === 'all') ['t', 'r', 'b', 'l'].forEach((e) => cur.add(e))
      else if (kind === 'outer') (['t', 'b', 'l', 'r'] as const).forEach((e) => edges[e] && cur.add(e))
      else if (kind in edges && edges[kind as 't']) cur.add(kind)
      const bd = ['t', 'r', 'b', 'l'].filter((e) => cur.has(e)).join('')
      const st: CellStyle = { ...cell.s, ...(bd ? { bd } : {}) }
      if (!bd) delete st.bd
      store.setCell(active, r, c, { v: cell.v, ...(cell.f ? { f: cell.f } : {}), ...(Object.keys(st).length ? { s: st } : {}) })
    }))
  }

  const isMerged = !!active && !!store.mergeAt(active, s.r1, s.c1)
  const toggleMerge = () => {
    if (!active || !editable) return
    if (isMerged) store.unmerge(active, s)
    else store.merge(active, s)
  }

  // ---- filas y columnas ----
  const insertRows = (below: boolean) => active && editable && store.shift(active, 'row', below ? s.r2 + 1 : s.r1, s.r2 - s.r1 + 1)
  const insertCols = (right: boolean) => active && editable && store.shift(active, 'col', right ? s.c2 + 1 : s.c1, s.c2 - s.c1 + 1)
  const deleteRows = () => active && editable && (meta?.rows ?? 0) > s.r2 - s.r1 + 1 && store.shift(active, 'row', s.r1, -(s.r2 - s.r1 + 1))
  const deleteCols = () => active && editable && (meta?.cols ?? 0) > s.c2 - s.c1 + 1 && store.shift(active, 'col', s.c1, -(s.c2 - s.c1 + 1))

  // ---- relleno, autosuma, ordenar ----
  /** Ctrl+D / Ctrl+R: copia la primera fila (o columna) de la selección sobre las demás; con una sola celda, copia la de arriba (o la de la izquierda). */
  const fill = (dir: 'down' | 'right') => {
    if (!active || !editable) return
    const down = dir === 'down'
    const single = down ? s.r1 === s.r2 : s.c1 === s.c2
    const from = (down ? s.r1 : s.c1) - (single ? 1 : 0)
    if (from < 0) return
    const first = single ? from + 1 : from + 1
    const last = down ? s.r2 : s.c2
    doc.transact(() => {
      for (let t = first; t <= last; t++) {
        for (let o = down ? s.c1 : s.r1; o <= (down ? s.c2 : s.r2); o++) {
          const src = down ? store.getCell(active, from, o) : store.getCell(active, o, from)
          const [r, c] = down ? [t, o] : [o, t]
          store.setCell(active, r, c, src ? { ...src, ...(src.f ? { f: translateFormula(src.f, down ? t - from : 0, down ? 0 : t - from) } : {}) } : null)
        }
      }
    })
  }

  const autosum = (fn: string) => {
    if (!active || !editable) return
    const numeric = (r: number, c: number) => typeof valueAt(r, c) === 'number'
    doc.transact(() => {
      if (s.r1 === s.r2 && s.c1 === s.c2) {
        // una sola celda: suma los números contiguos de arriba (o, si no hay, de la izquierda)
        let r = s.r1 - 1
        while (r >= 0 && numeric(r, s.c1)) r--
        if (r < s.r1 - 1) { store.setCell(active, s.r1, s.c1, { v: '', f: `${fn}(${addr(r + 1, s.c1)}:${addr(s.r1 - 1, s.c1)})` }); return }
        let c = s.c1 - 1
        while (c >= 0 && numeric(s.r1, c)) c--
        if (c < s.c1 - 1) store.setCell(active, s.r1, s.c1, { v: '', f: `${fn}(${addr(s.r1, c + 1)}:${addr(s.r1, s.c1 - 1)})` })
        return
      }
      for (let c = s.c1; c <= s.c2; c++) store.setCell(active, s.r2 + 1, c, { v: '', f: `${fn}(${addr(s.r1, c)}:${addr(s.r2, c)})` })
    })
  }

  const insertFunction = (name: string) => {
    if (!editable) return
    const cell = cellAt(s.r1, s.c1)
    const base = editing ? editing.text : raw(cell)
    setEditing({ r: s.r1, c: s.c1, text: `${base.startsWith('=') && base.length > 1 ? base : '='}${name}(` })
  }

  const sortSel = (asc: boolean) => {
    if (!active || !editable) return
    let range = s
    if (s.r1 === s.r2 && s.c1 === s.c2) {
      const reg = region(s.r1, s.c1)
      if (!reg) return
      // si la primera fila parece un encabezado (texto sobre números), no se mueve
      range = { ...reg, r1: reg.r1 + (looksLikeHeader(reg) ? 1 : 0) }
    } else if (s.r1 !== s.r2 && looksLikeHeader(s)) range = { ...s, r1: s.r1 + 1 }
    if (range.r2 <= range.r1) return
    store.sort(active, range, s.c1, asc, (r, c) => {
      const v = valueAt(r, c)
      return isError(v) ? { error: v.error } : v
    })
  }

  /** La primera fila parece un encabezado si es texto y debajo de alguna de sus columnas hay números. */
  const looksLikeHeader = (g: Sel) => {
    if (g.r2 <= g.r1) return false
    let numberBelow = false
    for (let c = g.c1; c <= g.c2; c++) {
      const top = valueAt(g.r1, c)
      if (top !== '' && typeof top !== 'string') return false
      if (typeof valueAt(g.r1 + 1, c) === 'number') numberBelow = true
    }
    return numberBelow
  }

  /** Bloque de datos que rodea a una celda (celdas contiguas no vacías). */
  const region = (r: number, c: number): Sel | null => {
    if (!active) return null
    const filled = (rr: number, cc: number) => rr >= 0 && cc >= 0 && !!store.getCell(active, rr, cc) && store.getCell(active, rr, cc)!.v !== '' || !!store.getCell(active, rr, cc)?.f
    if (!filled(r, c)) return null
    let { r1, c1, r2, c2 } = { r1: r, c1: c, r2: r, c2: c }
    let grew = true
    while (grew) {
      grew = false
      const rowAny = (rr: number) => { for (let cc = c1 - 1; cc <= c2 + 1; cc++) if (filled(rr, cc)) return true; return false }
      const colAny = (cc: number) => { for (let rr = r1 - 1; rr <= r2 + 1; rr++) if (filled(rr, cc)) return true; return false }
      if (r1 > 0 && rowAny(r1 - 1)) { r1--; grew = true }
      if (rowAny(r2 + 1) && r2 + 1 < (meta?.rows ?? 0)) { r2++; grew = true }
      if (c1 > 0 && colAny(c1 - 1)) { c1--; grew = true }
      if (colAny(c2 + 1) && c2 + 1 < (meta?.cols ?? 0)) { c2++; grew = true }
    }
    return { r1, c1, r2, c2 }
  }

  // ---- gráficos ----
  const chartSpec = (ch: ChartObj): ChartSpec => chartSpecOf(evaluator, ch)

  const newChart = (type: ChartType) => {
    if (!active || !editable) return
    let range = s
    if (s.r1 === s.r2 && s.c1 === s.c2) range = region(s.r1, s.c1) ?? s
    // el gráfico nace a la derecha de los datos (o, si no hay sitio a la vista, cerca de la esquina visible)
    setChartDlg({ id: null, draft: { sheet: active, type, title: '', range: rangeText(range), x: Math.round((colX[range.c2 + 1] ?? 0) + 24), y: Math.round(range.r1 * ROW_H), w: 440, h: 290 } })
  }

  // ---- teclado ----
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) undo.current?.redo(); else undo.current?.undo(); return }
    if (mod && k === 'y') { e.preventDefault(); undo.current?.redo(); return }
    if (mod && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); toggle(k as 'b' | 'i' | 'u'); return }
    if (mod && k === 'd') { e.preventDefault(); fill('down'); return }
    if (mod && k === 'r') { e.preventDefault(); fill('right'); return }
    if (mod && k === 'f') { e.preventDefault(); setFinding(true); return }
    if (mod && k === 'a') { e.preventDefault(); if (meta) setSel({ r1: 0, c1: 0, r2: meta.rows - 1, c2: meta.cols - 1 }); return }
    if (mod && e.key === 'Home') { e.preventDefault(); moveTo(0, 0); return }
    if (mod) return // copiar/pegar los gestionan los eventos copy/paste
    if (chartSel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); if (editable) store.charts.delete(chartSel); setChartSel(null); return }
    const ext = e.shiftKey
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (ext) moveTo(sel.r2 + 1, sel.c2, true); else moveTo(sel.r2 + 1, sel.c1); break
      case 'ArrowUp': e.preventDefault(); if (ext) moveTo(sel.r2 - 1, sel.c2, true); else moveTo(sel.r2 - 1, sel.c1); break
      case 'ArrowRight': e.preventDefault(); if (ext) moveTo(sel.r2, sel.c2 + 1, true); else moveTo(sel.r1, sel.c2 + 1); break
      case 'ArrowLeft': e.preventDefault(); if (ext) moveTo(sel.r2, sel.c2 - 1, true); else moveTo(sel.r1, sel.c2 - 1); break
      case 'PageDown': e.preventDefault(); moveTo(sel.r1 + Math.floor(scroll.h / ROW_H) - 2, sel.c1); break
      case 'PageUp': e.preventDefault(); moveTo(sel.r1 - Math.floor(scroll.h / ROW_H) + 2, sel.c1); break
      case 'Home': e.preventDefault(); moveTo(sel.r1, 0); break
      case 'Tab': e.preventDefault(); moveTo(sel.r1, sel.c1 + (ext ? -1 : 1)); break
      case 'Enter': e.preventDefault(); if (editable) startEdit(sel.r1, sel.c1); break
      case 'F2': e.preventDefault(); startEdit(sel.r1, sel.c1); break
      case 'Delete': case 'Backspace': e.preventDefault(); clearSel(); break
      default:
        if (editable && e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.r1, sel.c1, e.key) }
    }
  }

  const onCopy = (e: ClipboardEvent) => {
    if (editing) return
    const rows: string[] = []
    const cells: (Cell | undefined)[][] = []
    for (let r = s.r1; r <= s.r2; r++) {
      const line: string[] = []
      const crow: (Cell | undefined)[] = []
      for (let c = s.c1; c <= s.c2; c++) {
        const cell = cellAt(r, c)
        crow.push(cell)
        const v = valueAt(r, c)
        line.push((cell?.f ? display(v, cell.s?.fmt) : raw(cell)).replace(/\t|\r|\n/g, ' '))
      }
      rows.push(line.join('\t'))
      cells.push(crow)
    }
    const text = rows.join('\n')
    clip.current = { text, r: s.r1, c: s.c1, cells }
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }

  const onPaste = (e: ClipboardEvent) => {
    if (editing || !editable || !active) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const internal = clip.current && clip.current.text === text.replace(/\r\n?/g, '\n').replace(/\n$/, '') ? clip.current : null
    const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    doc.transact(() => {
      if (internal) {
        internal.cells.forEach((row, i) => row.forEach((cell, j) => {
          const r = s.r1 + i, c = s.c1 + j
          if (!meta || r >= meta.rows || c >= meta.cols) return
          store.setCell(active, r, c, cell ? { ...cell, ...(cell.f ? { f: translateFormula(cell.f, r - (internal.r + i), c - (internal.c + j)) } : {}) } : null)
        }))
      } else {
        grid.forEach((row, i) => row.forEach((t, j) => {
          const r = s.r1 + i, c = s.c1 + j
          if (meta && r < meta.rows && c < meta.cols) store.setCell(active, r, c, parseInput(t, store.getCell(active, r, c)))
        }))
      }
    })
    setSel({ r1: s.r1, c1: s.c1, r2: Math.min((meta?.rows ?? 1) - 1, s.r1 + grid.length - 1), c2: Math.min((meta?.cols ?? 1) - 1, s.c1 + Math.max(...grid.map((g) => g.length)) - 1) })
  }

  // ---- ratón ----
  const cellFromEvent = (e: MouseEvent) => {
    const el = viewport.current!
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left + el.scrollLeft - GUTTER
    const vy = e.clientY - rect.top - HEAD_H
    const y = vy < frozen * ROW_H ? vy : vy + el.scrollTop
    let c = 0
    while (c < (meta?.cols ?? 1) - 1 && (colX[c + 1] ?? 0) <= x) c++
    return { r: Math.max(0, Math.min((meta?.rows ?? 1) - 1, Math.floor(y / ROW_H))), c }
  }

  const onMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sheet-edit, .col-resize, .sh-chart, .sheet-more')) return
    setMenu(null)
    setChartSel(null)
    if (e.button === 2) {
      const rect = viewport.current!.getBoundingClientRect()
      if (e.clientX - rect.left > GUTTER && e.clientY - rect.top > HEAD_H) {
        const { r, c } = cellFromEvent(e)
        const inside = r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2
        if (!inside) setSel({ r1: r, c1: c, r2: r, c2: c })
      }
      return
    }
    const rect = viewport.current!.getBoundingClientRect()
    const onColHead = e.clientY - rect.top < HEAD_H && e.clientX - rect.left >= GUTTER
    const onRowHead = e.clientX - rect.left < GUTTER && e.clientY - rect.top >= HEAD_H
    if (editing) finishEdit('none')
    if (onColHead || onRowHead) {
      const { r, c } = cellFromEvent(e)
      if (!meta) return
      if (onColHead) setSel((p) => (e.shiftKey ? { ...p, c2: c } : { r1: 0, c1: c, r2: meta.rows - 1, c2: c }))
      else setSel((p) => (e.shiftKey ? { ...p, r2: r } : { r1: r, c1: 0, r2: r, c2: meta.cols - 1 }))
      viewport.current?.focus()
      return
    }
    if (e.clientX - rect.left < GUTTER || e.clientY - rect.top < HEAD_H) return
    const { r, c } = cellFromEvent(e)
    dragging.current = true
    setSel((p) => (e.shiftKey ? { ...p, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }))
    viewport.current?.focus()
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return
    const { r, c } = cellFromEvent(e)
    setSel((p) => (p.r2 === r && p.c2 === c ? p : { ...p, r2: r, c2: c }))
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

  /** Arrastra o redimensiona un gráfico flotante. */
  const startChartDrag = (id: string, ch: ChartObj, mode: 'move' | 'size', e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setChartSel(id)
    if (!editable) return
    const x0 = e.clientX
    const y0 = e.clientY
    const move = (ev: globalThis.MouseEvent) => {
      const dx = ev.clientX - x0
      const dy = ev.clientY - y0
      if (mode === 'move') store.patchChart(id, { x: Math.max(0, Math.round(ch.x + dx)), y: Math.max(0, Math.round(ch.y + dy)) })
      else store.patchChart(id, { w: Math.max(160, Math.round(ch.w + dx)), h: Math.max(110, Math.round(ch.h + dy)) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- buscar ----
  const find = (term: string, dir: 1 | -1) => {
    if (!active || !term || !meta) return false
    const t = term.toLowerCase()
    const hits: [number, number][] = []
    for (const k of store.cellsOf(active).keys()) {
      const [r, c] = parseKey(k)
      const v = valueAt(r, c)
      if (display(v, cellAt(r, c)?.s?.fmt).toLowerCase().includes(t) || raw(cellAt(r, c)).toLowerCase().includes(t)) hits.push([r, c])
    }
    if (!hits.length) return false
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cur = sel.r1 * 100000 + sel.c1
    const order = dir === 1 ? hits.find(([r, c]) => r * 100000 + c > cur) ?? hits[0]! : [...hits].reverse().find(([r, c]) => r * 100000 + c < cur) ?? hits[hits.length - 1]!
    moveTo(order[0], order[1])
    return true
  }
  const replaceAll = (term: string, rep: string) => {
    if (!active || !term || !editable) return 0
    let n = 0
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    doc.transact(() => {
      for (const [k, cell] of [...store.cellsOf(active).entries()]) {
        if (cell.f || typeof cell.v !== 'string' || !re.test(cell.v)) continue
        re.lastIndex = 0
        const [r, c] = parseKey(k)
        store.setCell(active, r, c, parseInput(cell.v.replace(re, rep), cell))
        n++
      }
    })
    return n
  }

  // ---- estadísticas de la selección ----
  const stats = (() => {
    if (!active || (s.r1 === s.r2 && s.c1 === s.c2)) return null
    let count = 0, sum = 0, min = Infinity, max = -Infinity, filled = 0
    for (const k of store.cellsOf(active).keys()) {
      const [r, c] = parseKey(k)
      if (r < s.r1 || r > s.r2 || c < s.c1 || c > s.c2) continue
      const v = evaluator.valueOf(active, r, c)
      if (v === '' || isError(v)) continue
      filled++
      if (typeof v === 'number') { count++; sum += v; min = Math.min(min, v); max = Math.max(max, v) }
    }
    return { filled, count, sum, avg: count ? sum / count : 0, min, max }
  })()

  // ---- pintado (solo lo visible) ----
  const firstRow = Math.max(0, Math.floor(scroll.y / ROW_H) - 2)
  const lastRow = Math.min((meta?.rows ?? 0) - 1, Math.ceil((scroll.y + scroll.h) / ROW_H) + 2)
  let firstCol = 0
  while (firstCol < (meta?.cols ?? 0) - 1 && (colX[firstCol + 1] ?? 0) < scroll.x) firstCol++
  firstCol = Math.max(0, firstCol - 1)
  let lastCol = firstCol
  while (lastCol < (meta?.cols ?? 0) - 1 && (colX[lastCol] ?? 0) < scroll.x + scroll.w) lastCol++

  const renderCell = (r: number, c: number) => {
    const k = key(r, c)
    if (merges.covered.has(k)) return null
    const cell = cellAt(r, c)
    const span = merges.spans.get(k)
    const val = valueAt(r, c)
    const w = span ? (colX[c + span.cols] ?? 0) - (colX[c] ?? 0) : colW(c)
    const st = cell?.s
    const num = typeof val === 'number' && !st?.align
    const bd = st?.bd ?? ''
    const line = '1px solid #1f2937'
    return (
      <div key={k} className={`sh-cell ${isError(val) ? 'err' : ''} ${num || st?.align === 'right' ? 'r' : st?.align === 'center' ? 'c' : ''} ${st?.va === 'top' ? 'vt' : st?.va === 'bottom' ? 'vb' : ''}`}
        style={{
          left: colX[c], top: r * ROW_H, width: w, height: ROW_H * (span?.rows ?? 1),
          fontWeight: st?.b ? 700 : undefined, fontStyle: st?.i ? 'italic' : undefined,
          textDecoration: [st?.u ? 'underline' : '', st?.st ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
          color: st?.color, background: st?.bg, fontFamily: st?.ff, fontSize: st?.fs ? `${(st.fs * 4) / 3}px` : undefined,
          ...(bd.includes('t') ? { borderTop: line } : {}), ...(bd.includes('b') ? { borderBottom: line } : {}),
          ...(bd.includes('l') ? { borderLeft: line } : {}), ...(bd.includes('r') ? { borderRight: line } : {}),
        }}>
        {display(val, st?.fmt)}
      </div>
    )
  }

  const cells: React.ReactNode[] = []
  const frozenCells: React.ReactNode[] = []
  if (meta && active) {
    for (let r = firstRow; r <= lastRow; r++) for (let c = firstCol; c <= lastCol; c++) cells.push(renderCell(r, c))
    for (let r = 0; r < frozen; r++) for (let c = firstCol; c <= lastCol; c++) frozenCells.push(renderCell(r, c))
  }

  const selBox = meta && {
    left: colX[s.c1] ?? 0, top: s.r1 * ROW_H, width: (colX[s.c2 + 1] ?? colX[s.c2] ?? 0) - (colX[s.c1] ?? 0), height: (s.r2 - s.r1 + 1) * ROW_H,
  }

  if (!active || !meta) return <div className="empty"><strong>Este libro no tiene hojas</strong>{editable && <button className="btn" onClick={() => setSheetId(store.addSheet('Hoja 1'))}>Crear hoja</button>}</div>

  const formulaText = editing ? editing.text : raw(cellAt(sel.r1, sel.c1))
  const editInput = editing && (
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
  )

  const api: RibbonApi = {
    canEdit: editable, style: anchorStyle, sel: s, merged: isMerged, freeze: frozen,
    undo: () => undo.current?.undo(), redo: () => undo.current?.redo(),
    apply: applyStyle, toggle, borders: setBorders, merge: toggleMerge,
    decimals: (d) => applyStyle({ fmt: changeDecimals(anchorStyle.fmt, d) }),
    insertRows, insertCols, deleteRows, deleteCols, clear: clearSel,
    autosum, fill, sort: sortSel, insertFunction, newChart, find: () => setFinding(true),
    setFreeze: (n) => store.patchMeta(active, { freeze: n || undefined }),
  }

  return (
    <div className="sheet-editor" onContextMenu={(e) => { if ((e.target as HTMLElement).closest('.sheet-viewport')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: e.clientX - r.left, y: e.clientY - r.top }) } }}>
      {editable && <SheetRibbon api={api} />}
      <div className="formula-bar">
        <span className="fb-ref">{addr(s.r1, s.c1)}{(s.r1 !== s.r2 || s.c1 !== s.c2) ? `:${addr(s.r2, s.c2)}` : ''}</span>
        <span className="fb-fx">ƒx</span>
        <input className="fb-input" aria-label="Contenido de la celda" value={formulaText} readOnly={!editable}
          onFocus={() => { if (!editing && editable) startEdit(sel.r1, sel.c1) }}
          onChange={(e) => setEditing({ r: sel.r1, c: sel.c1, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finishEdit('down') } else if (e.key === 'Escape') finishEdit('cancel') }} />
      </div>
      {finding && <SheetFind onClose={() => { setFinding(false); viewport.current?.focus() }} onFind={find} onReplaceAll={replaceAll} editable={editable} />}

      <div ref={viewport} className="sheet-viewport" tabIndex={0} role="grid" aria-label="Hoja de cálculo"
        onScroll={(e) => setScroll((p) => ({ ...p, x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop }))}
        onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste} onCut={(e) => { onCopy(e as unknown as ClipboardEvent); clearSel() }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onDoubleClick={(e) => { const rect = viewport.current!.getBoundingClientRect(); if (e.clientX - rect.left > GUTTER && e.clientY - rect.top > HEAD_H && !(e.target as HTMLElement).closest('.sh-chart')) startEdit(sel.r1, sel.c1) }}>
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
            {store.chartsOf(active).map(({ id, chart }) => (
              <div key={id} className={`sh-chart ${chartSel === id ? 'on' : ''}`} style={{ left: chart.x, top: chart.y, width: chart.w, height: chart.h }}
                onMouseDown={(e) => startChartDrag(id, chart, 'move', e)} onDoubleClick={() => editable && setChartDlg({ id, draft: chart })}>
                <ChartView spec={chartSpec(chart)} w={chart.w} h={chart.h} />
                {chartSel === id && editable && (
                  <>
                    <span className="sh-chart-tools">
                      <button className="btn sm" onMouseDown={(e) => e.stopPropagation()} onClick={() => setChartDlg({ id, draft: chart })}>Editar</button>
                      <button className="btn sm danger" onMouseDown={(e) => e.stopPropagation()} onClick={() => { store.charts.delete(id); setChartSel(null) }}>Quitar</button>
                    </span>
                    <span className="sh-chart-size" onMouseDown={(e) => startChartDrag(id, chart, 'size', e)} />
                  </>
                )}
              </div>
            ))}
            {peers.filter((p) => p.sheet === active).map((p) => (
              <div key={p.clientId} className="sh-peer" style={{ left: colX[p.c], top: p.r * ROW_H, width: colW(p.c), height: ROW_H, borderColor: p.color }}>
                <span style={{ background: p.color }}>{p.name}</span>
              </div>
            ))}
            {selBox && <div className="sh-sel" style={selBox} />}
            {editing && editing.r >= frozen && editInput}
          </div>
          {frozen > 0 && (
            <>
              <div className="sh-frozen" style={{ left: GUTTER, top: scroll.y + HEAD_H, width: totalW, height: frozen * ROW_H }}>
                {frozenCells}
                {selBox && s.r1 < frozen && <div className="sh-sel" style={selBox} />}
                {editing && editing.r < frozen && editInput}
              </div>
              <div className="sh-frozen-heads" style={{ left: scroll.x, top: scroll.y + HEAD_H, width: GUTTER, height: frozen * ROW_H }}>
                {Array.from({ length: frozen }, (_, r) => <div key={r} className={`sh-rowhead ${r >= s.r1 && r <= s.r2 ? 'on' : ''}`} style={{ top: r * ROW_H, height: ROW_H }}>{r + 1}</div>)}
              </div>
            </>
          )}
          {editable && (
            <div className="sheet-more" style={{ left: scroll.x + GUTTER + 8, top: scroll.y + Math.max(scroll.h - 36, 0) }}>
              <button className="btn sm" onClick={() => store.patchMeta(active, { rows: meta.rows + 50 })}><Plus size={14} /> 50 filas</button>
              <button className="btn sm" onClick={() => store.patchMeta(active, { cols: meta.cols + 10 })}><Plus size={14} /> 10 columnas</button>
            </div>
          )}
        </div>
      </div>

      {menu && editable && (
        <div className="sheet-ctx menu" style={{ left: menu.x, top: menu.y }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
          {[
            ['Insertar fila arriba', () => insertRows(false)], ['Insertar fila abajo', () => insertRows(true)],
            ['Insertar columna a la izquierda', () => insertCols(false)], ['Insertar columna a la derecha', () => insertCols(true)],
            null,
            [`Eliminar ${s.r2 > s.r1 ? 'filas' : 'fila'}`, deleteRows], [`Eliminar ${s.c2 > s.c1 ? 'columnas' : 'columna'}`, deleteCols],
            null,
            ['Borrar contenido', clearSel], ['Ordenar de A a Z', () => sortSel(true)], ['Ordenar de Z a A', () => sortSel(false)],
          ].map((it, i) => it === null ? <hr key={i} /> : <button key={i} role="menuitem" onClick={() => { setMenu(null); (it as [string, () => void])[1]() }}>{(it as [string, () => void])[0]}</button>)}
        </div>
      )}

      {stats && (
        <div className="sheet-status" role="status">
          <span>Recuento: {stats.filled}</span>
          {stats.count > 0 && <><span>Suma: {display(stats.sum)}</span><span>Promedio: {display(Math.round(stats.avg * 1e6) / 1e6)}</span><span>Mín: {display(stats.min)}</span><span>Máx: {display(stats.max)}</span></>}
        </div>
      )}

      <div className="sheet-tabs" role="tablist" aria-label="Hojas">
        {ids.map((id) => (
          renaming === id ? (
            <input key={id} className="tab-rename" autoFocus defaultValue={store.meta(id).name}
              onBlur={(e) => { store.patchMeta(id, { name: e.target.value.trim().slice(0, 60) || store.meta(id).name }); setRenaming(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} />
          ) : (
            <button key={id} role="tab" aria-selected={id === active} className={`sheet-tab ${id === active ? 'on' : ''}`}
              onClick={() => { setSheetId(id); setSel({ r1: 0, c1: 0, r2: 0, c2: 0 }); setChartSel(null) }} onDoubleClick={() => editable && setRenaming(id)}>
              {store.meta(id).name}
              {editable && id === active && (
                <>
                  <span className="tab-x" role="button" aria-label={`Duplicar ${store.meta(id).name}`} title="Duplicar hoja"
                    onClick={(e) => { e.stopPropagation(); setSheetId(store.duplicateSheet(id)) }}>⧉</span>
                  {ids.length > 1 && (
                    <span className="tab-x" role="button" aria-label={`Eliminar ${store.meta(id).name}`}
                      onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar la hoja «${store.meta(id).name}»?`)) store.removeSheet(id) }}><X size={12} /></span>
                  )}
                </>
              )}
            </button>
          )
        ))}
        {editable && <button className="sheet-tab add" aria-label="Añadir hoja" onClick={() => setSheetId(store.addSheet(`Hoja ${ids.length + 1}`))}><Plus size={14} /></button>}
      </div>

      {chartDlg && (
        <SheetChartDialog draft={chartDlg.draft} isNew={chartDlg.id === null} spec={chartSpec}
          onCancel={() => setChartDlg(null)}
          onOk={(d) => { if (chartDlg.id) store.patchChart(chartDlg.id, d); else setChartSel(store.addChart(d)); setChartDlg(null) }} />
      )}
    </div>
  )
}

function SheetFind({ onClose, onFind, onReplaceAll, editable }: { onClose: () => void; onFind: (t: string, d: 1 | -1) => boolean; onReplaceAll: (t: string, r: string) => number; editable: boolean }) {
  const [term, setTerm] = useState('')
  const [rep, setRep] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <div className="findbar sheet-find" role="search" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="row">
        <input autoFocus placeholder="Buscar en la hoja" aria-label="Buscar" value={term} onChange={(e) => { setTerm(e.target.value); setMsg('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setMsg(onFind(term, e.shiftKey ? -1 : 1) ? '' : 'Sin resultados') } }} />
        <button className="icon-btn sm" aria-label="Anterior" onClick={() => setMsg(onFind(term, -1) ? '' : 'Sin resultados')}><ChevronLeft size={15} /></button>
        <button className="icon-btn sm" aria-label="Siguiente" onClick={() => setMsg(onFind(term, 1) ? '' : 'Sin resultados')}><ChevronRight size={15} /></button>
        <button className="icon-btn sm" aria-label="Cerrar la búsqueda" onClick={onClose}><X size={15} /></button>
      </div>
      {editable && (
        <div className="row">
          <input placeholder="Reemplazar con (en celdas de texto)" aria-label="Reemplazar con" value={rep} onChange={(e) => setRep(e.target.value)} />
          <button className="btn sm" disabled={!term} onClick={() => setMsg(`${onReplaceAll(term, rep)} reemplazos`)}>Reemplazar todo</button>
        </div>
      )}
      {msg && <span className="muted small">{msg}</span>}
    </div>
  )
}

function SheetChartDialog({ draft, isNew, spec, onOk, onCancel }: { draft: ChartObj; isNew: boolean; spec: (c: ChartObj) => ChartSpec; onOk: (c: ChartObj) => void; onCancel: () => void }) {
  const [d, setD] = useState(draft)
  const valid = !!parseRange(d.range)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="modal-backdrop" style={{ zIndex: 90 }} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal chart-dialog" role="dialog" aria-modal="true" aria-label="Gráfico">
        <div className="chart-dialog-grid">
          <div className="stack">
            <strong>{isNew ? 'Nuevo gráfico' : 'Editar gráfico'}</strong>
            <label>Tipo<select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as ChartType })}>{CHART_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
            <label>Título<input value={d.title} maxLength={80} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
            <label>Rango de datos<input value={d.range} onChange={(e) => setD({ ...d, range: e.target.value.toUpperCase() })} aria-invalid={!valid} placeholder="A1:C6" /></label>
            <p className="muted small">La primera fila se usa como nombre de las series y la primera columna como etiquetas, si son texto. El gráfico se actualiza solo cuando cambian los datos.</p>
          </div>
          <div className="stack">
            <strong>Vista previa</strong>
            {valid ? <ChartView spec={spec(d)} w={360} h={250} /> : <span className="muted small">Escribe un rango válido, por ejemplo A1:C6.</span>}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={!valid} onClick={() => onOk(d)}>{isNew ? 'Insertar gráfico' : 'Aplicar'}</button>
        </div>
      </div>
    </div>
  )
}


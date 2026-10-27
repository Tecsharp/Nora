// Hojas de cálculo: XLSX / ODS / XLS / CSV  <->  matriz de celdas con fórmulas (formato nativo del editor).
import ExcelJS from 'exceljs'
import { convert } from './lo.mjs'

const MAX_ROWS = 10_000
const MAX_COLS = 200
const MAX_CELLS = 300_000
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

const argb = (c) => (c?.argb && /^[0-9a-f]{8}$/i.test(c.argb) ? `#${c.argb.slice(2)}` : undefined)
const toArgb = (hex) => (/^#[0-9a-f]{6}$/i.test(hex ?? '') ? `FF${hex.slice(1).toUpperCase()}` : undefined)

/** Abre una hoja de cálculo y devuelve { kind: 'SHEET', sheets: [...] }. */
export async function importSheet(buf, ext) {
  if (ext === 'csv' || ext === 'tsv') return { kind: 'SHEET', sheets: [fromGrid('Hoja 1', parseCsv(buf.toString('utf8'), ext === 'tsv' ? '\t' : undefined))] }
  const xlsx = ext === 'xlsx' ? buf : await convert(buf, ext, 'xlsx')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(xlsx)
  const sheets = []
  let total = 0
  wb.eachSheet((ws) => {
    const cells = {}
    let rows = 0
    let cols = 0
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > MAX_ROWS) return
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > MAX_COLS || ++total > MAX_CELLS) return
        const out = cellOut(cell)
        if (!out) return
        cells[`${r - 1},${c - 1}`] = out
        rows = Math.max(rows, r)
        cols = Math.max(cols, c)
      })
    })
    // En las celdas combinadas solo vale la de arriba a la izquierda
    for (const m of ws.model.merges ?? []) {
      const [a, b] = m.split(':')
      const tl = ws.getCell(a)
      const br = ws.getCell(b)
      for (let r = tl.row; r <= br.row; r++) for (let c = tl.col; c <= br.col; c++) if (r !== tl.row || c !== tl.col) delete cells[`${r - 1},${c - 1}`]
    }
    const colWidths = {}
    ws.columns?.forEach((col, i) => {
      if (col?.width && i < MAX_COLS) colWidths[i] = Math.round(col.width * 7 + 5)
    })
    const view = ws.views?.[0]
    const freeze = view?.state === 'frozen' && view.ySplit > 0 && view.ySplit <= 50 ? view.ySplit : undefined
    sheets.push({
      id: `s${sheets.length + 1}`, name: ws.name.slice(0, 60), rows: Math.max(rows, 50), cols: Math.max(cols, 12),
      cells, colWidths, merges: (ws.model.merges ?? []).slice(0, 2000), ...(freeze ? { freeze } : {}),
    })
  })
  if (!sheets.length) sheets.push(fromGrid('Hoja 1', []))
  return { kind: 'SHEET', sheets }
}

function cellOut(cell) {
  let v = cell.value
  let f
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('formula' in v || 'sharedFormula' in v) {
      f = cell.formula || v.formula
      v = v.result
    } else if ('richText' in v) v = v.richText.map((t) => t.text).join('')
    else if ('text' in v) v = v.text
    else if ('error' in v) v = v.error
    else v = String(cell.text ?? '')
  }
  if (v && typeof v === 'object' && !(v instanceof Date)) v = v.error ?? ''
  if (v instanceof Date) v = (v.getTime() - EXCEL_EPOCH) / 86_400_000
  if (v === null || v === undefined) {
    if (!f) return null
    v = ''
  }
  const out = { v }
  if (f) out.f = String(f).replace(/^=/, '')
  const s = {}
  if (cell.font?.bold) s.b = 1
  if (cell.font?.italic) s.i = 1
  if (cell.font?.underline) s.u = 1
  if (cell.font?.strike) s.st = 1
  const fname = cell.font?.name
  if (fname && !['Calibri', 'Arial', 'Liberation Sans', 'Calibri Light'].includes(fname)) s.ff = String(fname).slice(0, 40)
  const fsize = cell.font?.size
  if (fsize && Math.round(fsize) !== 10 && Math.round(fsize) !== 11 && fsize >= 6 && fsize <= 96) s.fs = Math.round(fsize)
  if (['top', 'middle', 'bottom'].includes(cell.alignment?.vertical) && cell.alignment.vertical !== 'bottom') s.va = cell.alignment.vertical
  const bd = ['top', 'right', 'bottom', 'left'].filter((e) => cell.border?.[e]?.style).map((e) => e[0]).join('')
  if (bd) s.bd = bd
  const color = argb(cell.font?.color)
  if (color && color !== '#000000') s.color = color
  const bg = cell.fill?.type === 'pattern' ? argb(cell.fill.fgColor) : undefined
  if (bg && bg !== '#FFFFFF') s.bg = bg
  if (['left', 'center', 'right'].includes(cell.alignment?.horizontal)) s.align = cell.alignment.horizontal
  if (cell.numFmt && cell.numFmt !== 'General') s.fmt = cell.numFmt
  if (Object.keys(s).length) out.s = s
  return out
}

function fromGrid(name, grid) {
  const cells = {}
  grid.slice(0, MAX_ROWS).forEach((row, r) => row.slice(0, MAX_COLS).forEach((raw, c) => {
    if (raw === '') return
    const n = raw.trim() !== '' && /^-?\d+([.,]\d+)?$/.test(raw.trim()) ? Number(raw.trim().replace(',', '.')) : NaN
    cells[`${r},${c}`] = { v: Number.isNaN(n) ? raw : n }
  }))
  return { id: 's1', name, rows: Math.max(grid.length, 50), cols: Math.max(...grid.map((r) => r.length), 12), cells, colWidths: {}, merges: [] }
}

/** CSV según RFC 4180 (comillas, saltos de línea dentro de campos). Detecta el separador (, ; tab). */
export function parseCsv(text, forced) {
  const src = text.replace(/^﻿/, '')
  const head = src.split('\n').slice(0, 5).join('\n')
  const delim = forced ?? [',', ';', '\t'].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = []
  let cur = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur); cur = ''
      rows.push(row); row = []
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const csvEscape = (s) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** Guarda la hoja como XLSX / ODS / CSV (CSV: solo la primera hoja, con los valores calculados). */
export async function exportSheet(native, format, active = 0) {
  const sheets = native.sheets ?? []
  if (!sheets.length) throw new Error('El libro no tiene hojas')
  if (format === 'csv') {
    const sh = sheets[Math.min(active, sheets.length - 1)]
    let maxR = 0
    let maxC = 0
    for (const k of Object.keys(sh.cells)) {
      const [r, c] = k.split(',').map(Number)
      maxR = Math.max(maxR, r)
      maxC = Math.max(maxC, c)
    }
    const lines = []
    for (let r = 0; r <= maxR; r++) {
      const line = []
      for (let c = 0; c <= maxC; c++) line.push(csvEscape(String(sh.cells[`${r},${c}`]?.v ?? '')))
      lines.push(line.join(','))
    }
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8')
  }
  const wb = new ExcelJS.Workbook()
  const used = new Set()
  for (const sh of sheets) {
    let name = (sh.name || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja'
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${used.size}`
    used.add(name.toLowerCase())
    const ws = wb.addWorksheet(name)
    for (const [key, cell] of Object.entries(sh.cells)) {
      const [r, c] = key.split(',').map(Number)
      const x = ws.getCell(r + 1, c + 1)
      x.value = cell.f ? { formula: cell.f, result: cell.v } : cell.v
      const s = cell.s
      if (!s) continue
      if (s.b || s.i || s.u || s.st || s.color || s.ff || s.fs) {
        x.font = {
          bold: !!s.b, italic: !!s.i, underline: !!s.u, strike: !!s.st,
          ...(toArgb(s.color) ? { color: { argb: toArgb(s.color) } } : {}),
          ...(s.ff ? { name: String(s.ff).slice(0, 40) } : {}), ...(s.fs ? { size: Math.max(6, Math.min(96, Number(s.fs))) } : {}),
        }
      }
      if (toArgb(s.bg)) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(s.bg) } }
      if (s.align || s.va) x.alignment = { ...(s.align ? { horizontal: s.align } : {}), ...(['top', 'middle', 'bottom'].includes(s.va) ? { vertical: s.va } : {}) }
      if (s.fmt) x.numFmt = s.fmt
      if (s.bd) {
        const edge = { style: 'thin', color: { argb: 'FF1F2937' } }
        x.border = { ...(s.bd.includes('t') ? { top: edge } : {}), ...(s.bd.includes('r') ? { right: edge } : {}), ...(s.bd.includes('b') ? { bottom: edge } : {}), ...(s.bd.includes('l') ? { left: edge } : {}) }
      }
    }
    for (const [i, w] of Object.entries(sh.colWidths ?? {})) ws.getColumn(Number(i) + 1).width = Math.max(2, (w - 5) / 7)
    for (const m of sh.merges ?? []) { try { ws.mergeCells(m) } catch { /* combinación inválida: se omite */ } }
    if (Number(sh.freeze) > 0) ws.views = [{ state: 'frozen', ySplit: Math.min(50, Number(sh.freeze)) }]
    // Los gráficos llegan ya dibujados (PNG): se colocan sobre la hoja en la misma posición que en el editor (filas de 26 px, columnas según su ancho)
    if (sh.images?.length) {
      ws.properties.defaultRowHeight = 19.5
      const colX = [0]
      for (let c = 0; c < 200; c++) colX.push(colX[c] + (Number(sh.colWidths?.[c]) || 100))
      for (const im of sh.images.slice(0, 50)) {
        if (!/^data:image\/png;base64,/.test(im.png ?? '')) continue
        const id = wb.addImage({ base64: im.png, extension: 'png' })
        let col = 0
        while (col < 199 && colX[col + 1] <= im.x) col++
        ws.addImage(id, { tl: { col: col + (im.x - colX[col]) / (colX[col + 1] - colX[col]), row: Math.max(0, im.y / 26) }, ext: { width: Math.round(im.w), height: Math.round(im.h) } })
      }
    }
  }
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer())
  if (format === 'xlsx') return xlsx
  if (format === 'ods') return convert(xlsx, 'xlsx', 'ods')
  if (format === 'pdf') return convert(xlsx, 'xlsx', 'pdf')
  throw new Error(`Formato no admitido para hojas: ${format}`)
}

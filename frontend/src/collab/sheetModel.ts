import * as Y from 'yjs'
import { adjustFormula, adjustRange, colIndex, colName, parseRange, translateFormula } from './refs'
import type { ChartType } from './chart'

export { colIndex, colName }

export interface CellStyle {
  b?: 1
  i?: 1
  u?: 1
  st?: 1
  color?: string
  bg?: string
  align?: 'left' | 'center' | 'right'
  va?: 'top' | 'middle' | 'bottom'
  ff?: string
  fs?: number
  fmt?: string
  /** Bordes: letras t (arriba), r (derecha), b (abajo), l (izquierda). */
  bd?: string
}

export type CellValue = string | number | boolean

/** Una celda. `f` es la fórmula (sin "="); `v` el valor (para fórmulas, el último resultado conocido). */
export interface Cell {
  v: CellValue
  f?: string
  s?: CellStyle
}

export interface SheetMeta {
  name: string
  rows: number
  cols: number
  colWidths: Record<string, number>
  merges: string[]
  /** Número de filas inmovilizadas arriba. */
  freeze?: number
}

/** Gráfico flotante sobre la hoja. x, y, w, h en píxeles del cuerpo de la hoja. */
export interface ChartObj {
  sheet: string
  type: ChartType
  title: string
  range: string
  x: number
  y: number
  w: number
  h: number
}

export interface NativeSheet extends SheetMeta {
  id: string
  cells: Record<string, Cell>
  /** Solo al exportar: gráficos ya convertidos a imagen. */
  images?: { png: string; x: number; y: number; w: number; h: number }[]
  charts?: (ChartObj & { id: string })[]
}

export interface NativeSheets {
  kind: 'SHEET'
  sheets: NativeSheet[]
}

export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`
export const key = (r: number, c: number) => `${r},${c}`
export const parseKey = (k: string): [number, number] => {
  const i = k.indexOf(',')
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))]
}

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/**
 * Hoja de cálculo sobre Yjs. Una celda es un valor JSON en un Y.Map por hoja ("r,c" → Cell): la última escritura gana
 * por celda, que es lo natural en una hoja (dos personas editando celdas distintas nunca chocan).
 */
export class SheetStore {
  readonly order: Y.Array<string>
  readonly metas: Y.Map<SheetMeta>
  readonly charts: Y.Map<ChartObj>

  constructor(readonly doc: Y.Doc) {
    this.order = doc.getArray<string>('sheetOrder')
    this.metas = doc.getMap<SheetMeta>('sheets')
    this.charts = doc.getMap<ChartObj>('charts')
  }

  cellsOf(id: string): Y.Map<Cell> {
    return this.doc.getMap<Cell>(`c:${id}`)
  }

  ids(): string[] {
    return this.order.toArray().filter((id) => this.metas.has(id))
  }

  meta(id: string): SheetMeta {
    return this.metas.get(id) ?? { name: '—', rows: 100, cols: 26, colWidths: {}, merges: [] }
  }

  getCell(id: string, r: number, c: number): Cell | undefined {
    return this.cellsOf(id).get(key(r, c))
  }

  setCell(id: string, r: number, c: number, cell: Cell | null) {
    const m = this.cellsOf(id)
    if (cell === null || (cell.v === '' && !cell.f && !cell.s)) m.delete(key(r, c))
    else m.set(key(r, c), cell)
  }

  patchMeta(id: string, patch: Partial<SheetMeta>) {
    this.metas.set(id, { ...this.meta(id), ...patch })
  }

  addSheet(name: string): string {
    const id = uid('s')
    this.doc.transact(() => {
      this.metas.set(id, { name, rows: 100, cols: 26, colWidths: {}, merges: [] })
      this.order.push([id])
    })
    return id
  }

  removeSheet(id: string) {
    if (this.ids().length <= 1) return
    this.doc.transact(() => {
      const i = this.order.toArray().indexOf(id)
      if (i >= 0) this.order.delete(i, 1)
      this.metas.delete(id)
      this.cellsOf(id).clear()
      for (const [cid, ch] of this.charts.entries()) if (ch.sheet === id) this.charts.delete(cid)
    })
  }

  duplicateSheet(id: string): string {
    const newId = uid('s')
    this.doc.transact(() => {
      const meta = this.meta(id)
      this.metas.set(newId, { ...meta, name: `${meta.name} (copia)`.slice(0, 60), colWidths: { ...meta.colWidths }, merges: [...meta.merges] })
      this.order.insert(this.order.toArray().indexOf(id) + 1, [newId])
      const to = this.cellsOf(newId)
      for (const [k, c] of this.cellsOf(id).entries()) to.set(k, c)
    })
    return newId
  }

  // ---- gráficos ----
  chartsOf(sheet: string): { id: string; chart: ChartObj }[] {
    return [...this.charts.entries()].filter(([, c]) => c.sheet === sheet).map(([id, chart]) => ({ id, chart }))
  }
  addChart(chart: ChartObj): string {
    const id = uid('g')
    this.charts.set(id, chart)
    return id
  }
  patchChart(id: string, patch: Partial<ChartObj>) {
    const c = this.charts.get(id)
    if (c) this.charts.set(id, { ...c, ...patch })
  }

  // ---- combinar celdas ----
  mergeAt(id: string, r: number, c: number): string | undefined {
    return this.meta(id).merges.find((m) => {
      const p = parseRange(m)
      return p && r >= p.r1 && r <= p.r2 && c >= p.c1 && c <= p.c2
    })
  }

  merge(id: string, range: { r1: number; c1: number; r2: number; c2: number }) {
    if (range.r1 === range.r2 && range.c1 === range.c2) return
    this.doc.transact(() => {
      const meta = this.meta(id)
      const text = `${colName(range.c1)}${range.r1 + 1}:${colName(range.c2)}${range.r2 + 1}`
      // las combinaciones que se solapan con la nueva desaparecen
      const keep = meta.merges.filter((m) => {
        const p = parseRange(m)!
        return p.r2 < range.r1 || p.r1 > range.r2 || p.c2 < range.c1 || p.c1 > range.c2
      })
      this.patchMeta(id, { merges: [...keep, text] })
      const cells = this.cellsOf(id)
      for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) if (r !== range.r1 || c !== range.c1) cells.delete(key(r, c))
    })
  }

  unmerge(id: string, range: { r1: number; c1: number; r2: number; c2: number }) {
    const meta = this.meta(id)
    this.patchMeta(id, {
      merges: meta.merges.filter((m) => {
        const p = parseRange(m)!
        return p.r2 < range.r1 || p.r1 > range.r2 || p.c2 < range.c1 || p.c1 > range.c2
      }),
    })
  }

  // ---- filas y columnas ----
  /**
   * Inserta (count > 0) o elimina (count < 0) filas o columnas. Mueve las celdas, ajusta las fórmulas de todo el libro
   * que apuntan a esta hoja, las combinaciones, los anchos y los gráficos. Si dos personas lo hacen a la vez sobre la
   * misma hoja, el resultado es la suma de ambos cambios aplicados uno tras otro.
   */
  shift(id: string, axis: 'row' | 'col', at: number, count: number) {
    if (!count) return
    this.doc.transact(() => {
      const meta = this.meta(id)
      const cells = this.cellsOf(id)
      const del = count < 0
      const last = at - count - 1
      const moved: [string, Cell][] = []
      for (const [k, cell] of [...cells.entries()]) {
        const [r, c] = parseKey(k)
        const v = axis === 'row' ? r : c
        if (v < at) continue
        cells.delete(k)
        if (del && v <= last) continue
        const nv = v + count
        moved.push([axis === 'row' ? key(nv, c) : key(r, nv), cell])
      }
      for (const [k, cell] of moved) cells.set(k, cell)

      // fórmulas de todas las hojas
      const name = meta.name
      for (const sid of this.ids()) {
        const own = this.meta(sid).name
        const m = this.cellsOf(sid)
        for (const [k, cell] of [...m.entries()]) {
          if (!cell.f) continue
          const nf = adjustFormula(cell.f, own, name, axis, at, count)
          if (nf !== cell.f) m.set(k, { ...cell, f: nf })
        }
      }

      const patch: Partial<SheetMeta> = {}
      if (axis === 'row') patch.rows = Math.max(1, meta.rows + count)
      else {
        patch.cols = Math.max(1, meta.cols + count)
        const w: Record<string, number> = {}
        for (const [ci, width] of Object.entries(meta.colWidths)) {
          const c = Number(ci)
          if (c < at) w[c] = width
          else if (!del || c > last) w[c + count] = width
        }
        patch.colWidths = w
      }
      patch.merges = meta.merges.flatMap((mr) => {
        const next = adjustRange(mr, axis, at, count)
        const p = next ? parseRange(next) : null
        return next && p && (p.r1 !== p.r2 || p.c1 !== p.c2) ? [next] : []
      })
      if (axis === 'row' && meta.freeze) {
        const f = meta.freeze
        patch.freeze = del ? f - Math.max(0, Math.min(last, f - 1) - at + 1) : at < f ? f + count : f
      }
      this.patchMeta(id, patch)

      // los gráficos de esta hoja siguen apuntando a los mismos datos
      for (const [cid, ch] of this.charts.entries()) {
        if (ch.sheet !== id) continue
        const next = adjustRange(ch.range, axis, at, count)
        if (next === null) this.charts.delete(cid)
        else if (next !== ch.range) this.charts.set(cid, { ...ch, range: next })
      }
    })
  }

  // ---- ordenar ----
  /** Ordena las filas r1..r2 por el contenido de la columna `col` (los textos tras los números, las vacías al final). */
  sort(id: string, range: { r1: number; c1: number; r2: number; c2: number }, col: number, asc: boolean, valueOf: (r: number, c: number) => CellValue | { error: string }) {
    this.doc.transact(() => {
      const rows: { from: number; sortKey: CellValue | { error: string }; cells: Map<number, Cell> }[] = []
      for (let r = range.r1; r <= range.r2; r++) {
        const cells = new Map<number, Cell>()
        for (let c = range.c1; c <= range.c2; c++) {
          const cell = this.getCell(id, r, c)
          if (cell) cells.set(c, cell)
        }
        rows.push({ from: r, sortKey: valueOf(r, col), cells })
      }
      const rank = (v: unknown) => (v === '' || v === undefined ? 3 : typeof v === 'number' ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'object' ? 2 : 1)
      rows.sort((a, b) => {
        const ra = rank(a.sortKey)
        const rb = rank(b.sortKey)
        if (ra === 3 || rb === 3) return ra - rb // las vacías siempre al final
        if (ra !== rb) return asc ? ra - rb : rb - ra
        const x = a.sortKey as number | string
        const y = b.sortKey as number | string
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })
        return asc ? cmp : -cmp
      })
      rows.forEach((row, i) => {
        const r = range.r1 + i
        for (let c = range.c1; c <= range.c2; c++) {
          const cell = row.cells.get(c)
          if (!cell) this.cellsOf(id).delete(key(r, c))
          else this.cellsOf(id).set(key(r, c), cell.f && row.from !== r ? { ...cell, f: translateFormula(cell.f, r - row.from, 0) } : cell)
        }
      })
    })
  }

  /** Escribe un libro completo (siembra o restauración de una versión), sustituyendo lo que hubiera. */
  write(native: NativeSheets) {
    this.doc.transact(() => {
      for (const id of this.ids()) {
        this.cellsOf(id).clear()
        this.metas.delete(id)
      }
      this.charts.clear()
      this.order.delete(0, this.order.length)
      for (const sh of native.sheets) {
        const { id, cells, charts, images: _images, ...meta } = sh
        this.metas.set(id, meta)
        this.order.push([id])
        const m = this.cellsOf(id)
        for (const [k, c] of Object.entries(cells)) m.set(k, c)
        for (const ch of charts ?? []) {
          const { id: cid, ...rest } = ch
          this.charts.set(cid, rest)
        }
      }
    })
  }

  read(): NativeSheets {
    return {
      kind: 'SHEET',
      sheets: this.ids().map((id) => ({
        id, ...this.meta(id), cells: Object.fromEntries(this.cellsOf(id).entries()),
        charts: this.chartsOf(id).map(({ id: cid, chart }) => ({ id: cid, ...chart })),
      })),
    }
  }
}

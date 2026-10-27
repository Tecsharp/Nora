import FormulaParser from 'fast-formula-parser'
import { SheetStore, colName, key, type Cell, type CellValue } from './sheetModel'

const FormulaError = FormulaParser.FormulaError

export type Computed = CellValue | { error: string }
export const isError = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && 'error' in v

/**
 * Evalúa las fórmulas de las hojas bajo demanda: cada celda se calcula al consultarla (con caché) y sus dependencias
 * se calculan recursivamente, así que cambiar una celda se refleja en todo lo que depende de ella sin mantener un
 * grafo. La caché se vacía en cada cambio del documento.
 */
export class Evaluator {
  private cache = new Map<string, Computed>()
  private stack = new Set<string>()
  private parser: FormulaParser

  constructor(private store: SheetStore) {
    const byName = () => new Map(store.ids().map((id) => [store.meta(id).name.toLowerCase(), id]))
    this.parser = new FormulaParser({
      onCell: ({ sheet, row, col }: { sheet: string; row: number; col: number }) => this.valueOf(this.sheetId(sheet, byName()), row - 1, col - 1),
      onRange: ({ sheet, from, to }: { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const id = this.sheetId(sheet, byName())
        const out: (CellValue | null)[][] = []
        for (let r = from.row; r <= to.row; r++) {
          const line: (CellValue | null)[] = []
          for (let c = from.col; c <= to.col; c++) {
            const v = this.valueOf(id, r - 1, c - 1)
            line.push(isError(v) ? (new FormulaError(v.error) as unknown as null) : v === '' ? null : v)
          }
          out.push(line)
        }
        return out
      },
    })
  }

  private current = ''
  private sheetId(name: string | undefined, byName: Map<string, string>) {
    return (name && byName.get(name.toLowerCase())) || this.current
  }

  clear() {
    this.cache.clear()
  }

  /** Valor a mostrar de una celda (resultado de la fórmula, si tiene). */
  valueOf(sheetId: string, r: number, c: number): Computed {
    const cell = this.store.getCell(sheetId, r, c)
    if (!cell) return ''
    if (!cell.f) return cell.v
    return this.compute(sheetId, r, c, cell)
  }

  private compute(sheetId: string, r: number, c: number, cell: Cell): Computed {
    const k = `${sheetId}!${key(r, c)}`
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    if (this.stack.has(k)) return { error: '#REF!' } // referencia circular
    this.stack.add(k)
    const prev = this.current
    this.current = sheetId
    let result: Computed
    try {
      const raw = this.parser.parse(cell.f!, { sheet: this.store.meta(sheetId).name, row: r + 1, col: c + 1 })
      result = raw instanceof FormulaError ? { error: (raw as { error: string }).error } : normalize(raw)
    } catch (e) {
      const err = (e as { error?: string }).error ?? '#ERROR!'
      result = { error: err === '#ERROR!' ? '#NOMBRE?' : err }
    } finally {
      this.stack.delete(k)
      this.current = prev
    }
    this.cache.set(k, result)
    return result
  }
}

function normalize(v: unknown): Computed {
  if (Array.isArray(v)) return normalize(v[0]?.[0] ?? '')
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? v : { error: '#NUM!' }
  if (typeof v === 'string' || typeof v === 'boolean') return v
  return String(v)
}

/** Texto mostrado para un valor, aplicando el formato numérico más habitual. */
export function display(v: Computed, fmt?: string): string {
  if (isError(v)) return v.error
  if (v === '' || v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'
  if (typeof v === 'number') {
    if (fmt) {
      if (/y|d{1,2}\/|m{1,2}\/|-m/.test(fmt) && /[ymd]/i.test(fmt)) return fmtDate(v, fmt)
      if (fmt.includes('%')) return `${(v * 100).toFixed(Math.max(0, (fmt.split('.')[1] ?? '').replace(/[^0]/g, '').length))}%`
      const dec = (fmt.split('.')[1] ?? '').replace(/[^0#]/g, '').length
      const out = v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: fmt.includes(',') })
      return fmt.includes('$') ? `$${out}` : out
    }
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)
  }
  return String(v)
}

function fmtDate(serial: number, fmt: string) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000))
  const p = (n: number) => String(n).padStart(2, '0')
  return fmt.replace(/yyyy/gi, String(d.getUTCFullYear())).replace(/yy/gi, p(d.getUTCFullYear() % 100)).replace(/mm/g, p(d.getUTCMonth() + 1)).replace(/dd/g, p(d.getUTCDate()))
}

export { colName }

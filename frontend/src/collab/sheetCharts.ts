import { Evaluator, isError, type Computed } from './formulas'
import { parseRange } from './refs'
import { specFromGrid, type ChartSpec } from './chart'
import type { ChartObj } from './sheetModel'

/** Datos actuales de un gráfico de hoja: lee su rango (con las fórmulas ya calculadas). */
export function chartSpecOf(ev: Evaluator, ch: ChartObj): ChartSpec {
  const p = parseRange(ch.range)
  const grid: (Computed | null)[][] = []
  if (p) {
    for (let r = p.r1; r <= p.r2; r++) {
      const row: (Computed | null)[] = []
      for (let c = p.c1; c <= p.c2; c++) {
        const v = ev.valueOf(ch.sheet, r, c)
        row.push(isError(v) ? null : v)
      }
      grid.push(row)
    }
  }
  return specFromGrid(grid as (string | number | boolean | null)[][], ch.type, ch.title)
}

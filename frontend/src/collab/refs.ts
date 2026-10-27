export const colName = (c: number) => {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
export const colIndex = (name: string) => [...name.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** Referencia A1 (con $ opcionales). Filas y columnas empiezan en 0. */
interface Ref { col: number; row: number; colAbs: boolean; rowAbs: boolean }

const REF = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\w(])/g
const STRING = /("(?:[^"]|"")*")/

/** Recorre las referencias de una fórmula (sin tocar el texto entre comillas) y las reemplaza con lo que devuelva `fn`. */
function mapRefs(formula: string, fn: (sheet: string | undefined, a: Ref, b: Ref | undefined) => string): string {
  return formula
    .split(STRING)
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(REF, (m, sheetPart: string | undefined, d1: string, c1: string, d2: string, r1: string, d3: string, c2: string, d4: string, r2: string, offset: number) => {
        if (offset > 0 && /[A-Za-z0-9_.]/.test(part[offset - 1]!)) return m
        const a: Ref = { colAbs: d1 === '$', col: colIndex(c1), rowAbs: d2 === '$', row: Number(r1) - 1 }
        const b: Ref | undefined = c2 ? { colAbs: d3 === '$', col: colIndex(c2), rowAbs: d4 === '$', row: Number(r2) - 1 } : undefined
        const sheet = sheetPart ? sheetPart.slice(0, -1).replace(/^'|'$/g, '') : undefined
        return fn(sheet, a, b).replace(/^/, sheetPart ?? '')
      })
    })
    .join('')
}

const fmt = (r: Ref) => `${r.colAbs ? '$' : ''}${colName(r.col)}${r.rowAbs ? '$' : ''}${r.row + 1}`
const out = (a: Ref, b?: Ref) => (b ? `${fmt(a)}:${fmt(b)}` : fmt(a))

/** Copia una fórmula a otra posición: las referencias relativas se desplazan, las absolutas ($) no. */
export function translateFormula(f: string, dRow: number, dCol: number): string {
  const move = (r: Ref): Ref | null => {
    const row = r.rowAbs ? r.row : r.row + dRow
    const col = r.colAbs ? r.col : r.col + dCol
    return row < 0 || col < 0 ? null : { ...r, row, col }
  }
  return mapRefs(f, (_s, a, b) => {
    const na = move(a)
    const nb = b ? move(b) : undefined
    return !na || (b && !nb) ? '#REF!' : out(na, nb ?? undefined)
  })
}

/**
 * Ajusta las referencias de una fórmula cuando se insertan o eliminan filas/columnas de `target`.
 * count > 0 inserta `count` antes de `at`; count < 0 elimina `-count` a partir de `at`.
 */
export function adjustFormula(f: string, own: string, target: string, axis: 'row' | 'col', at: number, count: number): string {
  const key = axis === 'row' ? 'row' : 'col'
  const del = count < 0
  const last = at - count - 1 // última fila/columna eliminada
  const shift = (v: number) => (v >= at ? v + count : v)
  return mapRefs(f, (sheet, a, b) => {
    if ((sheet ?? own).toLowerCase() !== target.toLowerCase()) return out(a, b)
    if (!b) {
      if (del && a[key] >= at && a[key] <= last) return '#REF!'
      return out({ ...a, [key]: del && a[key] > last ? a[key] + count : shift(a[key]) })
    }
    let s = a[key]
    let e = b[key]
    if (del) {
      if (e < at) return out(a, b)
      if (s > last) { s += count; e += count } else {
        const ns = s >= at ? at : s
        const ne = e > last ? e + count : at - 1
        if (ne < ns) return '#REF!'
        s = ns
        e = ne
      }
    } else {
      s = shift(s)
      e = shift(e)
    }
    return out({ ...a, [key]: s }, { ...b, [key]: e })
  })
}

/** "A1:C5" → rango (o null). */
export function parseRange(text: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text)
  if (!m) return null
  const c1 = colIndex(m[1]!.toUpperCase())
  const r1 = Number(m[2]) - 1
  const c2 = m[3] ? colIndex(m[3].toUpperCase()) : c1
  const r2 = m[4] ? Number(m[4]) - 1 : r1
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) }
}

export const rangeText = (r: { r1: number; c1: number; r2: number; c2: number }) => `${colName(r.c1)}${r.r1 + 1}:${colName(r.c2)}${r.r2 + 1}`

/** Ajusta un rango (y devuelve null si desaparece por completo) tras insertar o eliminar filas/columnas. */
export function adjustRange(range: string, axis: 'row' | 'col', at: number, count: number): string | null {
  const r = parseRange(range)
  if (!r) return range
  const f = adjustFormula(range.replace(/\$/g, ''), '', '', axis, at, count)
  return f.includes('#REF!') ? null : f
}

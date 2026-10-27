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
      onCell: ({ sheet, row, col }: { sheet: string; row: number; col: number }) => {
        const v = this.valueOf(this.sheetId(sheet, byName()), row - 1, col - 1)
        return isError(v) ? new FormulaError(v.error) : v // los errores viajan como errores de fórmula, no como objetos
      },
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

/** Nombres de funciones en español ↔ inglés (se guarda siempre en inglés; la persona puede escribir en cualquiera de los dos). */
const ES_EN: [string, string][] = [
  ['SUMA', 'SUM'], ['PROMEDIO', 'AVERAGE'], ['CONTAR', 'COUNT'], ['CONTARA', 'COUNTA'], ['CONTAR.BLANCO', 'COUNTBLANK'], ['CONTAR.SI', 'COUNTIF'],
  ['SUMAR.SI', 'SUMIF'], ['SUMAPRODUCTO', 'SUMPRODUCT'], ['SI', 'IF'], ['SI.ERROR', 'IFERROR'], ['Y', 'AND'], ['O', 'OR'], ['NO', 'NOT'],
  ['BUSCARV', 'VLOOKUP'], ['BUSCARH', 'HLOOKUP'], ['INDICE', 'INDEX'], ['COINCIDIR', 'MATCH'], ['REDONDEAR', 'ROUND'], ['REDONDEAR.MAS', 'ROUNDUP'],
  ['REDONDEAR.MENOS', 'ROUNDDOWN'], ['ENTERO', 'INT'], ['RAIZ', 'SQRT'], ['POTENCIA', 'POWER'], ['RESIDUO', 'MOD'], ['SIGNO', 'SIGN'],
  ['HOY', 'TODAY'], ['AHORA', 'NOW'], ['AÑO', 'YEAR'], ['MES', 'MONTH'], ['DIA', 'DAY'], ['FECHA', 'DATE'], ['DIAS', 'DAYS'],
  ['CONCATENAR', 'CONCATENATE'], ['IZQUIERDA', 'LEFT'], ['DERECHA', 'RIGHT'], ['EXTRAE', 'MID'], ['LARGO', 'LEN'], ['MAYUSC', 'UPPER'],
  ['MINUSC', 'LOWER'], ['NOMPROPIO', 'PROPER'], ['ESPACIOS', 'TRIM'], ['TEXTO', 'TEXT'], ['VALOR', 'VALUE'], ['MEDIANA', 'MEDIAN'], ['MODA', 'MODE'],
  ['ALEATORIO', 'RAND'], ['ESNUMERO', 'ISNUMBER'], ['ESTEXTO', 'ISTEXT'], ['ESBLANCO', 'ISBLANK'], ['ESERROR', 'ISERROR'],
]
const TO_EN = new Map(ES_EN)
const TO_ES = new Map(ES_EN.map(([es, en]) => [en, es]))
const STRING = /("(?:[^"]|"")*")/
const CALL = /([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.]*)\(/g

function mapOutsideStrings(f: string, fn: (part: string) => string) {
  return f.split(STRING).map((p, i) => (i % 2 ? p : fn(p))).join('')
}

/** Lo que escribe la persona → lo que se guarda (funciones en inglés, argumentos separados por comas). */
export function toStoredFormula(f: string): string {
  return mapOutsideStrings(f, (p) =>
    p.replace(CALL, (_m, name: string) => `${TO_EN.get(name.toUpperCase()) ?? name.toUpperCase()}(`).replace(/;/g, ',').replace(/\bVERDADERO\b/gi, 'TRUE').replace(/\bFALSO\b/gi, 'FALSE'))
}

/** Lo guardado → lo que ve la persona al editar (funciones en español, separador «;»). */
export function toLocalFormula(f: string): string {
  return mapOutsideStrings(f, (p) => p.replace(CALL, (_m, name: string) => `${TO_ES.get(name.toUpperCase()) ?? name}(`).replace(/,/g, ';'))
}

export const FUNCTION_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'Matemáticas', items: [['SUMA', 'Suma de valores'], ['PROMEDIO', 'Media aritmética'], ['MAX', 'Valor máximo'], ['MIN', 'Valor mínimo'], ['REDONDEAR', 'Redondea un número'], ['ENTERO', 'Parte entera'], ['RAIZ', 'Raíz cuadrada'], ['POTENCIA', 'Potencia'], ['RESIDUO', 'Resto de una división'], ['ABS', 'Valor absoluto'], ['SUMAPRODUCTO', 'Suma de productos']] },
  { title: 'Estadística', items: [['CONTAR', 'Cuenta números'], ['CONTARA', 'Cuenta celdas no vacías'], ['CONTAR.SI', 'Cuenta según un criterio'], ['SUMAR.SI', 'Suma según un criterio'], ['MEDIANA', 'Mediana'], ['MODA', 'Valor más frecuente']] },
  { title: 'Lógicas', items: [['SI', 'Condicional: SI(prueba; si_cierto; si_falso)'], ['Y', 'Todas ciertas'], ['O', 'Alguna cierta'], ['NO', 'Invierte un valor lógico'], ['SI.ERROR', 'Valor alternativo si hay error']] },
  { title: 'Texto', items: [['CONCATENAR', 'Une textos'], ['IZQUIERDA', 'Primeros caracteres'], ['DERECHA', 'Últimos caracteres'], ['EXTRAE', 'Caracteres del medio'], ['LARGO', 'Longitud'], ['MAYUSC', 'A mayúsculas'], ['MINUSC', 'A minúsculas'], ['ESPACIOS', 'Quita espacios sobrantes'], ['TEXTO', 'Da formato a un número']] },
  { title: 'Fecha', items: [['HOY', 'Fecha de hoy'], ['AHORA', 'Fecha y hora actuales'], ['AÑO', 'Año de una fecha'], ['MES', 'Mes de una fecha'], ['DIA', 'Día de una fecha'], ['FECHA', 'Crea una fecha']] },
  { title: 'Búsqueda', items: [['BUSCARV', 'Busca en la primera columna'], ['BUSCARH', 'Busca en la primera fila'], ['INDICE', 'Valor en una posición'], ['COINCIDIR', 'Posición de un valor']] },
]

/** Formatos numéricos predefinidos. */
export const NUMBER_FORMATS: [string, string][] = [
  ['', 'General'], ['0', 'Número entero (1234)'], ['0.00', 'Número (1234,50)'], ['#,##0.00', 'Con separador de miles (1.234,50)'],
  ['$#,##0.00', 'Moneda $'], ['#,##0.00 €', 'Moneda €'], ['0%', 'Porcentaje (12%)'], ['0.00%', 'Porcentaje (12,34%)'], ['0.00E+00', 'Científico'],
  ['dd/mm/yyyy', 'Fecha corta'], ['dd mmm yyyy', 'Fecha con mes'], ['hh:mm', 'Hora'], ['dd/mm/yyyy hh:mm', 'Fecha y hora'],
]

/** Sube o baja en uno los decimales de un formato. */
export function changeDecimals(fmt: string | undefined, delta: number): string {
  const f = fmt && fmt !== 'General' ? fmt : '0'
  if (/[ymdh]/i.test(f.replace(/E\+0+/i, ''))) return f
  const m = /^([^.0#]*[0#,]*)(?:\.(0+))?(.*)$/.exec(f)
  if (!m) return f
  const dec = Math.max(0, Math.min(10, (m[2]?.length ?? 0) + delta))
  return `${m[1]}${dec ? `.${'0'.repeat(dec)}` : ''}${m[3]}`
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Texto mostrado para un valor, aplicando el formato numérico. */
export function display(v: Computed, fmt?: string): string {
  if (isError(v)) return v.error
  if (v === '' || v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'
  if (typeof v !== 'number') return String(v)
  if (!fmt || fmt === 'General') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)
  if (/[ymdh]/i.test(fmt.replace(/E\+0+/i, '')) && !/^[#,0.$€£%]+$/.test(fmt)) return fmtDate(v, fmt)
  const decOf = (s: string) => (s.split('.')[1] ?? '').replace(/[^0#]/g, '').length
  if (/E\+0+/i.test(fmt)) return v.toExponential(decOf(fmt.split(/E/i)[0]!)).replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2')
  if (fmt.includes('%')) return `${(v * 100).toLocaleString(undefined, { minimumFractionDigits: decOf(fmt), maximumFractionDigits: decOf(fmt) })}%`
  const dec = decOf(fmt)
  const out = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: fmt.includes(',') })
  const cur = /[$€£¥]/.exec(fmt)?.[0]
  const sign = v < 0 ? '-' : ''
  if (!cur) return sign + out
  return fmt.trimStart().startsWith(cur) ? `${sign}${cur}${out}` : `${sign}${out} ${cur}`
}

function fmtDate(serial: number, fmt: string) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000))
  const p = (n: number) => String(n).padStart(2, '0')
  return fmt
    .replace(/yyyy/gi, '\u0001').replace(/yy/gi, '\u0002')
    .replace(/hh/gi, '\u0003')
    .replace(/(\u0003:)mm/g, '$1\u0004')
    .replace(/mmm/g, '\u0005').replace(/mm/g, '\u0006').replace(/dd/g, '\u0007')
    .replace(/:ss/g, `:${p(d.getUTCSeconds())}`)
    .replace(/\u0001/g, String(d.getUTCFullYear())).replace(/\u0002/g, p(d.getUTCFullYear() % 100)).replace(/\u0003/g, p(d.getUTCHours()))
    .replace(/\u0004/g, p(d.getUTCMinutes())).replace(/\u0005/g, MONTHS[d.getUTCMonth()]!).replace(/\u0006/g, p(d.getUTCMonth() + 1)).replace(/\u0007/g, p(d.getUTCDate()))
}

export { colName }

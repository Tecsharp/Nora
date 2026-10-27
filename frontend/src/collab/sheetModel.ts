import * as Y from 'yjs'

export interface CellStyle {
  b?: 1
  i?: 1
  u?: 1
  color?: string
  bg?: string
  align?: 'left' | 'center' | 'right'
  fmt?: string
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
}

export interface NativeSheet extends SheetMeta {
  id: string
  cells: Record<string, Cell>
}

export interface NativeSheets {
  kind: 'SHEET'
  sheets: NativeSheet[]
}

export const colName = (c: number) => {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
export const colIndex = (name: string) => [...name.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`
export const key = (r: number, c: number) => `${r},${c}`
export const parseKey = (k: string): [number, number] => {
  const i = k.indexOf(',')
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))]
}

/**
 * Hoja de cálculo sobre Yjs. Una celda es un valor JSON en un Y.Map por hoja ("r,c" → Cell): la última escritura gana
 * por celda, que es lo natural en una hoja (dos personas editando celdas distintas nunca chocan).
 */
export class SheetStore {
  readonly order: Y.Array<string>
  readonly metas: Y.Map<SheetMeta>

  constructor(readonly doc: Y.Doc) {
    this.order = doc.getArray<string>('sheetOrder')
    this.metas = doc.getMap<SheetMeta>('sheets')
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
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
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
    })
  }

  /** Escribe un libro completo (siembra o restauración de una versión), sustituyendo lo que hubiera. */
  write(native: NativeSheets) {
    this.doc.transact(() => {
      for (const id of this.ids()) {
        this.cellsOf(id).clear()
        this.metas.delete(id)
      }
      this.order.delete(0, this.order.length)
      for (const sh of native.sheets) {
        const { id, cells, ...meta } = sh
        this.metas.set(id, meta)
        this.order.push([id])
        const m = this.cellsOf(id)
        for (const [k, c] of Object.entries(cells)) m.set(k, c)
      }
    })
  }

  read(): NativeSheets {
    return {
      kind: 'SHEET',
      sheets: this.ids().map((id) => ({ id, ...this.meta(id), cells: Object.fromEntries(this.cellsOf(id).entries()) })),
    }
  }
}

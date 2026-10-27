import * as Y from 'yjs'
import { generateNKeysBetween } from 'fractional-indexing'

/** Elemento de la pizarra tal como lo entiende Excalidraw (se guarda entero, como JSON, bajo su id). */
export interface BoardElement {
  id: string
  type: string
  index?: string | null
  version: number
  versionNonce: number
  isDeleted?: boolean
  updated?: number
  fileId?: string | null
  [k: string]: unknown
}

export interface BoardFile {
  id: string
  mimeType: string
  dataURL: string
  created: number
  lastRetrieved?: number
}

/** Formato de archivo `.excalidraw` (el mismo que usan Excalidraw y las herramientas que lo leen). */
export interface NativeBoard {
  type: 'excalidraw'
  version: 2
  source: string
  elements: BoardElement[]
  appState: { viewBackgroundColor?: string; gridSize?: number | null }
  files: Record<string, BoardFile>
}

/** Un archivo de imagen no puede pasar de aquí: cada cambio viaja en un mensaje de como mucho ~1,5 MB. */
export const MAX_FILE_CHARS = 1_100_000

const byIndex = (a: BoardElement, b: BoardElement) => {
  const ai = a.index ?? ''
  const bi = b.index ?? ''
  return ai < bi ? -1 : ai > bi ? 1 : a.id < b.id ? -1 : 1
}

/** Asigna índices de orden (el orden de apilado de Excalidraw) si faltan o están repetidos. */
export function ensureIndices(elements: BoardElement[]): BoardElement[] {
  let ok = true
  for (let i = 0; i < elements.length; i++) {
    const idx = elements[i]!.index
    if (typeof idx !== 'string' || (i > 0 && !(typeof elements[i - 1]!.index === 'string' && (elements[i - 1]!.index as string) < idx))) { ok = false; break }
  }
  if (ok) return elements
  const keys = generateNKeysBetween(null, null, elements.length)
  return elements.map((e, i) => ({ ...e, index: keys[i]! }))
}

/**
 * Pizarra sobre Yjs: un Y.Map con los elementos (id → elemento) y otro con las imágenes (id → archivo).
 * Cada elemento lleva su `version`; quien lo cambia lo reescribe entero y Excalidraw resuelve los choques con su propia
 * lógica de reconciliación (la misma que usa su colaboración oficial). Los elementos borrados se quedan como lápidas.
 */
export class BoardStore {
  readonly elements: Y.Map<BoardElement>
  readonly files: Y.Map<BoardFile>
  readonly meta: Y.Map<unknown>

  constructor(readonly doc: Y.Doc) {
    this.elements = doc.getMap<BoardElement>('b:el')
    this.files = doc.getMap<BoardFile>('b:files')
    this.meta = doc.getMap<unknown>('b:meta')
  }

  /** Todos los elementos (también los borrados) en orden de apilado. */
  ordered(): BoardElement[] {
    return [...this.elements.values()].sort(byIndex)
  }

  get background(): string {
    return (this.meta.get('bg') as string) ?? '#ffffff'
  }

  /** Escribe una pizarra completa (siembra al importar). Sustituye lo que hubiera. */
  write(native: Partial<NativeBoard>) {
    this.doc.transact(() => {
      this.elements.clear()
      this.files.clear()
      for (const e of ensureIndices((native.elements ?? []).filter((x) => x && typeof x.id === 'string'))) this.elements.set(e.id, e)
      for (const [id, f] of Object.entries(native.files ?? {})) if (f?.dataURL && f.dataURL.length <= MAX_FILE_CHARS * 4) this.files.set(id, { ...f, id })
      const bg = native.appState?.viewBackgroundColor
      if (typeof bg === 'string') this.meta.set('bg', bg)
      const grid = native.appState?.gridSize
      if (typeof grid === 'number') this.meta.set('grid', grid)
    })
  }

  /** Contenido para guardar como archivo `.excalidraw`: sin lápidas y solo con las imágenes que se usan. */
  read(): NativeBoard {
    const elements = this.ordered().filter((e) => !e.isDeleted)
    const used = new Set(elements.map((e) => e.fileId).filter((x): x is string => !!x))
    const files: Record<string, BoardFile> = {}
    for (const id of used) {
      const f = this.files.get(id)
      if (f) files[id] = f
    }
    const grid = this.meta.get('grid')
    return { type: 'excalidraw', version: 2, source: 'nora', elements, appState: { viewBackgroundColor: this.background, ...(typeof grid === 'number' ? { gridSize: grid } : {}) }, files }
  }

  /**
   * Restaura una versión anterior como un cambio más: lo que ya no estaba se marca como borrado y lo que sí estaba se
   * reescribe con versión superior, así que todos los clientes lo reciben igual que cualquier otra edición.
   */
  restoreFrom(old: BoardStore) {
    this.doc.transact(() => {
      const now = Date.now()
      const ids = new Set([...this.elements.keys(), ...old.elements.keys()])
      for (const id of ids) {
        const cur = this.elements.get(id)
        const prev = old.elements.get(id)
        const target = prev ?? { ...cur!, isDeleted: true }
        this.elements.set(id, { ...target, version: Math.max(cur?.version ?? 0, prev?.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now })
      }
      for (const [id, f] of old.files.entries()) if (!this.files.has(id)) this.files.set(id, f)
      const bg = old.meta.get('bg')
      if (typeof bg === 'string') this.meta.set('bg', bg)
    })
  }

  /** Elimina las lápidas con más de una semana (las que ya nadie puede necesitar para reconciliar). */
  prune(maxAgeMs = 7 * 86_400_000) {
    const limit = Date.now() - maxAgeMs
    const dead = [...this.elements.values()].filter((e) => e.isDeleted && (e.updated ?? 0) < limit)
    if (!dead.length) return
    this.doc.transact(() => dead.forEach((e) => this.elements.delete(e.id)), 'prune')
  }
}

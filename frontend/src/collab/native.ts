import * as Y from 'yjs'
import { SheetStore, type NativeSheets } from './sheetModel'
import { SlidesStore, type NativeSlides } from './slidesModel'
import { Evaluator, isError } from './formulas'

export type Kind = 'DOC' | 'SHEET' | 'SLIDES'
export interface NativeDoc {
  kind: 'DOC'
  html: string
}
export type Native = NativeDoc | NativeSheets | NativeSlides

/** Escribe el contenido inicial importado en un documento de hoja o presentación (el de texto lo escribe el editor). */
export function seedNonText(kind: Kind, native: Native, doc: Y.Doc) {
  if (kind === 'SHEET') new SheetStore(doc).write(native as NativeSheets)
  else if (kind === 'SLIDES') new SlidesStore(doc).write(native as NativeSlides)
}

/** Hoja con los resultados de las fórmulas calculados (para que el archivo exportado lleve también el valor). */
export function sheetsWithResults(doc: Y.Doc): NativeSheets {
  const store = new SheetStore(doc)
  const ev = new Evaluator(store)
  const native = store.read()
  for (const sh of native.sheets) {
    for (const [k, cell] of Object.entries(sh.cells)) {
      if (!cell.f) continue
      const [r, c] = k.split(',').map(Number) as [number, number]
      const v = ev.valueOf(sh.id, r, c)
      cell.v = isError(v) ? v.error : v
    }
  }
  return native
}

export function readNative(kind: Kind, doc: Y.Doc, html?: () => string): Native {
  if (kind === 'DOC') return { kind: 'DOC', html: html?.() ?? '' }
  if (kind === 'SHEET') return sheetsWithResults(doc)
  return new SlidesStore(doc).read()
}

/**
 * Restaura una versión guardada: su contenido sustituye al actual como un cambio más (así se propaga a todos y se
 * puede deshacer). Devuelve false si el tipo necesita al editor (texto), que lo hace por su cuenta.
 */
export function restoreNonText(kind: Kind, doc: Y.Doc, snapshot: Uint8Array): boolean {
  const old = new Y.Doc()
  Y.applyUpdate(old, snapshot)
  try {
    if (kind === 'SHEET') new SheetStore(doc).write(new SheetStore(old).read())
    else if (kind === 'SLIDES') new SlidesStore(doc).write(new SlidesStore(old).read())
    else return false
    return true
  } finally {
    old.destroy()
  }
}

export function restoreText(doc: Y.Doc, snapshot: Uint8Array) {
  const old = new Y.Doc()
  Y.applyUpdate(old, snapshot)
  const from = old.getXmlFragment('default')
  const to = doc.getXmlFragment('default')
  doc.transact(() => {
    to.delete(0, to.length)
    to.insert(0, from.toArray().map((n) => n.clone() as Y.XmlElement | Y.XmlText))
  })
  old.destroy()
}

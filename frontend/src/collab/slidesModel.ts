import * as Y from 'yjs'

export type ElemType = 'text' | 'shape' | 'image' | 'chart' | 'table'

export type ShapeKind =
  | 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rtTriangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star5'
  | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow' | 'line'

/**
 * Elemento de una diapositiva. x, y, w, h son porcentajes del tamaño de la diapositiva (0–100).
 * El texto con formato (negrita parcial, listas…) vive en `html` (para mostrarlo y exportarlo) y, mientras alguien lo edita,
 * en un fragmento Yjs propio (`t:<id>`) que permite la edición simultánea; quien edita mantiene `html` al día.
 */
export interface Elem {
  id: string
  type: ElemType
  x: number
  y: number
  w: number
  h: number
  shape?: ShapeKind
  /** Texto con formato (HTML restringido) y su versión sin formato. */
  html?: string
  text?: string
  /** Tipografía por defecto del cuadro (las partes con formato propio la sustituyen). */
  ff?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'middle' | 'bottom'
  /** Interlineado (1 = sencillo). */
  ls?: number
  fill?: string
  line?: string
  /** Grosor del borde en puntos. */
  lw?: number
  /** Opacidad del relleno (0–1). */
  op?: number
  /** Giro en grados. */
  rot?: number
  /** Imagen (data URI). */
  data?: string
  /** Gráfico: ChartSpec en JSON. */
  spec?: string
  /** Tabla: celdas en JSON (string[][]) y si la primera fila es encabezado. */
  cells?: string
  hdr?: boolean
}

export interface NativeSlide {
  id: string
  bg: string
  elements: Elem[]
  notes?: string
}

export interface NativeSlides {
  kind: 'SLIDES'
  width: number
  height: number
  slides: NativeSlide[]
}

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const plainOf = (html: string) =>
  html.replace(/<\/(p|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n+$/, '')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Texto sin formato → HTML de párrafos. */
export const htmlOf = (text: string) => text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')

/**
 * Presentación sobre Yjs: lista ordenada de diapositivas, cada una con su fondo y sus elementos posicionados.
 * Las propiedades de un elemento son valores simples (gana la última escritura); las notas son un Y.Text.
 */
export class SlidesStore {
  readonly deck: Y.Map<number>
  readonly order: Y.Array<string>
  readonly slides: Y.Map<Y.Map<unknown>>

  constructor(readonly doc: Y.Doc) {
    this.deck = doc.getMap<number>('deck')
    this.order = doc.getArray<string>('slideOrder')
    this.slides = doc.getMap<Y.Map<unknown>>('slides')
  }

  get width() {
    return this.deck.get('width') ?? 13.333
  }
  get height() {
    return this.deck.get('height') ?? 7.5
  }
  setSize(w: number, h: number) {
    this.doc.transact(() => {
      this.deck.set('width', w)
      this.deck.set('height', h)
    })
  }

  ids(): string[] {
    return this.order.toArray().filter((id) => this.slides.has(id))
  }

  private slide(id: string) {
    return this.slides.get(id)
  }

  bg(id: string): string {
    return (this.slide(id)?.get('bg') as string) ?? '#ffffff'
  }

  private els(id: string) {
    return this.slide(id)?.get('els') as Y.Map<Y.Map<unknown>> | undefined
  }

  private elOrder(id: string) {
    return this.slide(id)?.get('order') as Y.Array<string> | undefined
  }

  elementIds(id: string): string[] {
    const els = this.els(id)
    return (this.elOrder(id)?.toArray() ?? []).filter((e) => els?.has(e))
  }

  element(slideId: string, elId: string): Elem | null {
    const m = this.els(slideId)?.get(elId)
    if (!m) return null
    return { ...(m.toJSON() as unknown as Elem), id: elId }
  }

  notesOf(slideId: string): Y.Text | null {
    const t = this.slide(slideId)?.get('notes')
    return t instanceof Y.Text ? t : null
  }

  private buildElement(e: Elem): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(e)) {
      if (k === 'id' || v === undefined) continue
      m.set(k, v)
    }
    if (e.text !== undefined && e.html === undefined) m.set('html', htmlOf(e.text))
    return m
  }

  private buildSlide(s: NativeSlide): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    m.set('bg', s.bg)
    const notes = new Y.Text()
    if (s.notes) notes.insert(0, s.notes)
    m.set('notes', notes)
    const els = new Y.Map<Y.Map<unknown>>()
    const order = new Y.Array<string>()
    m.set('els', els)
    m.set('order', order)
    for (const e of s.elements) {
      els.set(e.id, this.buildElement(e))
      order.push([e.id])
    }
    return m
  }

  addSlide(afterId?: string, elements: Omit<Elem, 'id'>[] = []): string {
    const id = uid('p')
    this.doc.transact(() => {
      this.slides.set(id, this.buildSlide({ id, bg: '#ffffff', elements: elements.map((e) => ({ ...e, id: uid('e') })) }))
      const i = afterId ? this.order.toArray().indexOf(afterId) + 1 : this.order.length
      this.order.insert(i, [id])
    })
    return id
  }

  duplicateSlide(id: string): string {
    const copy = this.read().slides.find((s) => s.id === id)!
    const newId = uid('p')
    this.doc.transact(() => {
      this.slides.set(newId, this.buildSlide({ ...copy, id: newId, elements: copy.elements.map((e) => ({ ...e, id: uid('e') })) }))
      this.order.insert(this.order.toArray().indexOf(id) + 1, [newId])
    })
    return newId
  }

  removeSlide(id: string) {
    if (this.ids().length <= 1) return
    this.doc.transact(() => {
      const i = this.order.toArray().indexOf(id)
      if (i >= 0) this.order.delete(i, 1)
      this.slides.delete(id)
    })
  }

  moveSlide(id: string, to: number) {
    this.doc.transact(() => {
      const arr = this.order.toArray()
      const from = arr.indexOf(id)
      if (from < 0 || from === to) return
      this.order.delete(from, 1)
      this.order.insert(Math.min(to, this.order.length), [id])
    })
  }

  setBg(id: string, color: string) {
    this.slide(id)?.set('bg', color)
  }

  addElement(slideId: string, e: Omit<Elem, 'id'>): string {
    const id = uid('e')
    this.doc.transact(() => {
      this.els(slideId)?.set(id, this.buildElement({ ...e, id }))
      this.elOrder(slideId)?.push([id])
    })
    return id
  }

  updateElement(slideId: string, elId: string, patch: Partial<Elem>, origin?: unknown) {
    const m = this.els(slideId)?.get(elId)
    if (!m) return
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id') continue
        if (v === undefined) m.delete(k)
        else if (m.get(k) !== v) m.set(k, v)
      }
    }, origin)
  }

  removeElement(slideId: string, elId: string) {
    this.doc.transact(() => {
      const order = this.elOrder(slideId)
      const i = order?.toArray().indexOf(elId) ?? -1
      if (i >= 0) order!.delete(i, 1)
      this.els(slideId)?.delete(elId)
    })
  }

  /** Cambia el orden de apilado: al frente/al fondo, o un paso adelante/atrás. */
  restack(slideId: string, elId: string, where: 'front' | 'back' | 'forward' | 'backward') {
    const order = this.elOrder(slideId)
    if (!order) return
    this.doc.transact(() => {
      const i = order.toArray().indexOf(elId)
      if (i < 0) return
      const to = where === 'front' ? order.length - 1 : where === 'back' ? 0 : where === 'forward' ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1)
      if (to === i) return
      order.delete(i, 1)
      order.insert(to, [elId])
    })
  }

  write(native: NativeSlides) {
    this.doc.transact(() => {
      // los fragmentos de edición de texto se rehacen a partir del HTML de cada elemento
      for (const [name, type] of this.doc.share) if (name.startsWith('t:') && type instanceof Y.XmlFragment && type.length) type.delete(0, type.length)
      for (const id of this.ids()) this.slides.delete(id)
      this.order.delete(0, this.order.length)
      this.deck.set('width', native.width)
      this.deck.set('height', native.height)
      for (const s of native.slides) {
        this.slides.set(s.id, this.buildSlide(s))
        this.order.push([s.id])
      }
    })
  }

  read(): NativeSlides {
    return {
      kind: 'SLIDES',
      width: this.width,
      height: this.height,
      slides: this.ids().map((id) => ({
        id,
        bg: this.bg(id),
        notes: this.notesOf(id)?.toString() ?? '',
        elements: this.elementIds(id).map((e) => this.element(id, e)!).filter(Boolean),
      })),
    }
  }
}

/** Aplica a un Y.Text el cambio mínimo (prefijo/sufijo común) para llegar a `next`: así se mezclan bien las ediciones simultáneas. */
export function setYText(t: Y.Text, next: string) {
  const prev = t.toString()
  if (prev === next) return
  let a = 0
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++
  let b = 0
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++
  t.doc?.transact(() => {
    if (prev.length - a - b > 0) t.delete(a, prev.length - a - b)
    if (next.length - a - b > 0) t.insert(a, next.slice(a, next.length - b))
  })
}

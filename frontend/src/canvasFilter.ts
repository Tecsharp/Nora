/**
 * Relleno para navegadores sin `CanvasRenderingContext2D.filter` (Safari).
 *
 * En tema oscuro Excalidraw invierte todo el lienzo con un filtro CSS y, para que las imágenes se vean como son, las
 * dibuja antes con el filtro contrario usando `context.filter`. Donde `context.filter` no existe esa corrección no se
 * aplica y una captura oscura aparece en blanco. Aquí se emula `filter` en `drawImage` (invert, hue-rotate, saturate,
 * brightness, contrast, grayscale), de modo que las imágenes se ven igual que en Chrome o Firefox.
 */
const proto = typeof CanvasRenderingContext2D === 'undefined' ? null : CanvasRenderingContext2D.prototype

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap
type Matrix = number[] // 3x3 por filas, aplicada a (r, g, b) en 0..1

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const amount = (s: string) => (s.trim().endsWith('%') ? parseFloat(s) / 100 : parseFloat(s))

/** Convierte una cadena de filtros CSS en una lista de operaciones por píxel (null si hay alguna que no se sabe emular). */
function parse(filter: string): ((px: Float32Array) => void)[] | null {
  const ops: ((px: Float32Array) => void)[] = []
  const re = /([a-z-]+)\(([^)]*)\)/gi
  if (filter.replace(re, '').trim()) return null
  for (let m = re.exec(filter); m; m = re.exec(filter)) {
    const name = m[1]!.toLowerCase()
    const arg = m[2]!
    let mat: Matrix | null = null
    if (name === 'invert') {
      const a = clamp01(amount(arg))
      ops.push((p) => { p[0] = a + (1 - 2 * a) * p[0]!; p[1] = a + (1 - 2 * a) * p[1]!; p[2] = a + (1 - 2 * a) * p[2]! })
      continue
    }
    if (name === 'brightness') {
      const a = amount(arg)
      ops.push((p) => { p[0] = clamp01(p[0]! * a); p[1] = clamp01(p[1]! * a); p[2] = clamp01(p[2]! * a) })
      continue
    }
    if (name === 'contrast') {
      const a = amount(arg)
      ops.push((p) => { for (let i = 0; i < 3; i++) p[i] = clamp01((p[i]! - 0.5) * a + 0.5) })
      continue
    }
    if (name === 'saturate') {
      const s = amount(arg)
      mat = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]
    } else if (name === 'grayscale') {
      const g = 1 - clamp01(amount(arg))
      mat = [0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g, 0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g, 0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g]
    } else if (name === 'hue-rotate') {
      const v = parseFloat(arg)
      const rad = arg.includes('rad') ? v : arg.includes('turn') ? v * 2 * Math.PI : (v * Math.PI) / 180
      const c = Math.cos(rad)
      const s = Math.sin(rad)
      mat = [
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ]
    } else return null
    const k = mat
    ops.push((p) => {
      const r = p[0]!, g = p[1]!, b = p[2]!
      p[0] = clamp01(k[0]! * r + k[1]! * g + k[2]! * b)
      p[1] = clamp01(k[3]! * r + k[4]! * g + k[5]! * b)
      p[2] = clamp01(k[6]! * r + k[7]! * g + k[8]! * b)
    })
  }
  return ops
}

const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>()

function filtered(src: Source, filter: string): Source {
  const ops = parse(filter)
  if (!ops) return src
  const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width
  const h = src instanceof HTMLImageElement ? src.naturalHeight : src.height
  if (!w || !h || w * h > 40_000_000) return src
  const cacheable = !(src instanceof HTMLCanvasElement) // un canvas puede cambiar de contenido; las imágenes no
  const hit = cacheable ? cache.get(src)?.get(filter) : undefined
  if (hit) return hit
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ;(proto!.drawImage as (this: CanvasRenderingContext2D, ...a: unknown[]) => void).call(ctx, src, 0, 0)
  const data = ctx.getImageData(0, 0, w, h)
  const px = new Float32Array(3)
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    px[0] = d[i]! / 255
    px[1] = d[i + 1]! / 255
    px[2] = d[i + 2]! / 255
    for (const op of ops) op(px)
    d[i] = Math.round(px[0]! * 255)
    d[i + 1] = Math.round(px[1]! * 255)
    d[i + 2] = Math.round(px[2]! * 255)
  }
  ctx.putImageData(data, 0, 0)
  if (cacheable) {
    const m = cache.get(src) ?? new Map<string, HTMLCanvasElement>()
    m.set(filter, out)
    cache.set(src, m)
  }
  return out
}

if (proto && !('filter' in proto)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = proto as any
  const state = new WeakMap<object, { value: string; stack: string[] }>()
  const of = (ctx: object) => {
    let s = state.get(ctx)
    if (!s) state.set(ctx, (s = { value: 'none', stack: [] }))
    return s
  }
  Object.defineProperty(p, 'filter', {
    configurable: true,
    get(this: CanvasRenderingContext2D) { return of(this).value },
    set(this: CanvasRenderingContext2D, v: string) { of(this).value = String(v).trim() || 'none' },
  })
  const { save, restore, drawImage } = p
  p.save = function (this: CanvasRenderingContext2D) {
    const s = of(this)
    s.stack.push(s.value)
    return save.call(this)
  }
  p.restore = function (this: CanvasRenderingContext2D) {
    const s = of(this)
    s.value = s.stack.pop() ?? 'none'
    return restore.call(this)
  }
  p.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    const s = state.get(this)
    const img = args[0]
    if (s && s.value !== 'none' && (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap))) args[0] = filtered(img, s.value)
    return drawImage.apply(this, args)
  }
}

export {}

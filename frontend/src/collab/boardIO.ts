import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { BoardElement } from './boardModel'

/** Id corto aleatorio con el mismo aspecto que los de Excalidraw. */
export const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(12))
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, 'x')
}

type AnyEl = Record<string, unknown> & { id: string }

/**
 * Da ids nuevos a unos elementos importados (para poder añadirlos a una pizarra que ya tiene contenido sin que choquen con
 * los suyos) y recoloca las referencias entre ellos: contenedores, flechas ligadas, grupos y marcos.
 */
export function reidElements<T extends AnyEl>(elements: readonly T[]): T[] {
  const ids = new Map<string, string>()
  const groups = new Map<string, string>()
  for (const e of elements) ids.set(e.id, newId())
  const mapId = (v: unknown) => (typeof v === 'string' ? ids.get(v) ?? v : v)
  const mapGroup = (g: string) => groups.get(g) ?? (groups.set(g, newId()), groups.get(g)!)
  return elements.map((e) => {
    const c: Record<string, unknown> = { ...e, id: ids.get(e.id)!, index: null, seed: Math.floor(Math.random() * 2 ** 31), versionNonce: Math.floor(Math.random() * 2 ** 31) }
    if (c.containerId) c.containerId = mapId(c.containerId)
    if (c.frameId) c.frameId = mapId(c.frameId)
    if (Array.isArray(c.groupIds)) c.groupIds = (c.groupIds as string[]).map(mapGroup)
    if (Array.isArray(c.boundElements)) c.boundElements = (c.boundElements as { id: string; type: string }[]).map((b) => ({ ...b, id: ids.get(b.id) ?? b.id }))
    for (const k of ['startBinding', 'endBinding'] as const) {
      const b = c[k] as { elementId: string } | null | undefined
      if (b) c[k] = { ...b, elementId: ids.get(b.elementId) ?? b.elementId }
    }
    return c as T
  })
}

export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Reduce una imagen (data URL) hasta que quepa en `maxChars`: baja la resolución y, si hace falta, la calidad. */
export async function shrinkDataURL(dataURL: string, maxChars: number): Promise<string | null> {
  if (dataURL.length <= maxChars) return dataURL
  const img = new Image()
  img.src = dataURL
  try {
    await img.decode()
  } catch {
    return null
  }
  let max = 1800
  for (let i = 0; i < 6; i++, max = Math.round(max * 0.75)) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * scale))
    c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const out = c.toDataURL('image/webp', 0.82)
    if (out.length <= maxChars) return out
  }
  return null
}

/** PDF de una sola página con la imagen de la pizarra (JPEG): sin dependencias, suficiente para imprimir o compartir. */
export async function jpegToPdf(jpeg: Blob, width: number, height: number): Promise<Blob> {
  const data = new Uint8Array(await jpeg.arrayBuffer())
  const w = Math.round(width * 0.75)
  const h = Math.round(height * 0.75)
  const enc = new TextEncoder()
  const parts: (Uint8Array | string)[] = []
  const offsets: number[] = []
  let len = 0
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p
    parts.push(b)
    len += b.length
  }
  push('%PDF-1.4\n')
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = len
    push(`${n} 0 obj\n`)
    if (typeof body === 'string') push(body)
    else body()
    push('\nendobj\n')
  }
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`)
    push(data)
    push('\nendstream')
  })
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  const xref = len
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

export interface BoardHandle {
  api: ExcalidrawImperativeAPI
  /** Imagen de lo dibujado ('png' lleva la escena incrustada para poder volver a importarla). */
  exportBlob: (kind: 'png' | 'svg' | 'pdf', opts?: { dark?: boolean; background?: boolean; scale?: number }) => Promise<Blob>
  /** Miniatura pequeña para la galería (null si la pizarra está vacía). */
  thumbnail: () => Promise<Blob | null>
  /** Importa un archivo: .excalidraw/.json, PNG o SVG con la escena incrustada, o una imagen suelta. */
  importFile: (file: File, mode: 'replace' | 'merge') => Promise<number>
  elementCount: () => number
}

export type { BoardElement }

/** Dibuja una pizarra guardada (el contenido de su .excalidraw) como PNG (con la escena incrustada), SVG o PDF, sin abrir el editor. */
export async function renderSavedBoard(file: Blob, kind: 'png' | 'svg' | 'pdf'): Promise<Blob> {
  const { loadFromBlob, exportToBlob, exportToSvg } = await import('@excalidraw/excalidraw')
  const scene = await loadFromBlob(file, null, null)
  const elements = scene.elements.filter((e) => !e.isDeleted)
  if (!elements.length) throw new Error('La pizarra está vacía')
  const files = scene.files ?? {}
  const appState = { ...scene.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: kind !== 'pdf' }
  if (kind === 'svg') {
    const svg = await exportToSvg({ elements, appState, files, exportPadding: 20 })
    return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
  }
  if (kind === 'png') return exportToBlob({ elements, appState, files, mimeType: 'image/png', exportPadding: 20, getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }) })
  const jpeg = await exportToBlob({ elements, appState, files, mimeType: 'image/jpeg', quality: 0.92, exportPadding: 20, getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }) })
  const bmp = await createImageBitmap(jpeg)
  const out = await jpegToPdf(jpeg, bmp.width, bmp.height)
  bmp.close()
  return out
}

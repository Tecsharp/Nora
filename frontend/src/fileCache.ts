import { fetchBlob, type BlobHandle } from './api'

/**
 * Caché en memoria de los archivos que se previsualizan (imágenes, PDF, texto). Volver a abrir lo que ya se vio es instantáneo y no gasta
 * red. Vive solo mientras la pestaña está abierta y se vacía al cerrar sesión: no deja copias de archivos privados en el disco del equipo.
 */
const MAX_BYTES = 200 * 1024 * 1024
const cache = new Map<string, { blob: Blob; size: number }>() // el orden de inserción hace de LRU
let total = 0

const key = (code: string, fileId: string) => `${code}/${fileId}`

function put(k: string, blob: Blob) {
  if (blob.size > MAX_BYTES / 2) return // lo enorme no se guarda: echaría todo lo demás
  const old = cache.get(k)
  if (old) { total -= old.size; cache.delete(k) }
  cache.set(k, { blob, size: blob.size })
  total += blob.size
  for (const [k2, v] of cache) {
    if (total <= MAX_BYTES) break
    cache.delete(k2)
    total -= v.size
  }
}

export function clearFileCache() {
  cache.clear()
  total = 0
  urls.clear()
}

export function cachedFile(code: string, fileId: string): Blob | null {
  const k = key(code, fileId)
  const hit = cache.get(k)
  if (!hit) return null
  cache.delete(k) // lo usado último pasa al final
  cache.set(k, hit)
  return hit.blob
}

/** Descarga el archivo (o lo toma de la caché). La promesa se resuelve al instante si ya se había visto. */
export function loadFile(code: string, fileId: string, onProgress: (loaded: number, total: number) => void, mime?: string): BlobHandle {
  const hit = cachedFile(code, fileId)
  if (hit && (!mime || hit.type === mime)) {
    onProgress(hit.size, hit.size)
    return { cancel: () => {}, promise: Promise.resolve(hit) }
  }
  const h = fetchBlob(`/rooms/${code}/files/${fileId}`, onProgress, mime)
  return { cancel: h.cancel, promise: h.promise.then((b) => { put(key(code, fileId), b); return b }) }
}

/** Calienta la caché con un archivo cercano (p. ej. el siguiente de la carpeta) sin avisar de progreso ni molestar si falla. */
export function prefetchFile(code: string, fileId: string, sizeBytes: number, mime?: string) {
  if (cache.has(key(code, fileId)) || sizeBytes > 15 * 1024 * 1024) return
  loadFile(code, fileId, () => {}, mime).promise.catch(() => {})
}

// Direcciones firmadas de reproducción (audio/vídeo): se reutilizan mientras sean válidas, así el navegador reaprovecha lo que ya descargó
const urls = new Map<string, { at: number; value: unknown }>()
const URL_TTL = 5 * 60 * 60 * 1000 // el servidor las firma por 6 h

export async function memo<T>(k: string, make: () => Promise<T>): Promise<T> {
  const hit = urls.get(k)
  if (hit && Date.now() - hit.at < URL_TTL) return hit.value as T
  const value = await make()
  urls.set(k, { at: Date.now(), value })
  return value
}

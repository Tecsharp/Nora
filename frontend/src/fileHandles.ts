/**
 * Guarda en IndexedDB el "file handle" de los archivos que se están subiendo (API File System Access, solo Chromium
 * y en contexto seguro: HTTPS o localhost). Así, tras recargar la página o reiniciar el navegador, una subida
 * interrumpida se puede reanudar sin volver a elegir el archivo. Sin soporte, todo sigue funcionando eligiéndolo otra vez.
 */
export interface FsHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  queryPermission?(d: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>
  requestPermission?(d: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>
}

const DB = 'nora'
const STORE = 'file-handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined // IndexedDB no disponible (modo privado, etc.): se ignora
  }
}

const key = (code: string, fingerprint: string) => `${code}|${fingerprint}`

export const saveHandle = (code: string, fingerprint: string, handle: FsHandle) =>
  tx('readwrite', (s) => s.put(handle, key(code, fingerprint)))

export const getHandle = async (code: string, fingerprint: string) =>
  (await tx<FsHandle>('readonly', (s) => s.get(key(code, fingerprint)))) ?? null

export const deleteHandle = (code: string, fingerprint: string) => tx('readwrite', (s) => s.delete(key(code, fingerprint)))

/** Borra los handles de una sala que ya no corresponden a ninguna subida pendiente. */
export async function pruneHandles(code: string, keep: Set<string>) {
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
  for (const k of keys ?? []) {
    const str = String(k)
    if (str.startsWith(code + '|') && !keep.has(str.slice(code.length + 1))) await tx('readwrite', (s) => s.delete(k))
  }
}

export function pickerSupported(): boolean {
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'
}

export interface Picked {
  file: File
  handle?: FsHandle
}

/** Abre el selector de archivos. Con File System Access devuelve también el handle reutilizable. */
export async function pickFiles(): Promise<Picked[]> {
  if (pickerSupported()) {
    try {
      const handles: FsHandle[] = await (window as unknown as { showOpenFilePicker: (o: object) => Promise<FsHandle[]> }).showOpenFilePicker({ multiple: true })
      return await Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return [] // el usuario canceló
      // cualquier otro fallo: se cae al selector clásico
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => resolve(Array.from(input.files ?? []).map((file) => ({ file })))
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** Selector de carpeta (funciona en todos los navegadores de escritorio). Devuelve los archivos con su ruta relativa. */
export function pickFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}

import { useSyncExternalStore } from 'react'
import { api } from './api'
import { deleteHandle, getHandle, pruneHandles, saveHandle, type FsHandle } from './fileHandles'
import { rt } from './realtime'
import { notifyToast } from './toast'
import { fingerprintOf, startUpload, type UploadProgress, type UploadTask } from './uploader'

export interface UploadItem {
  key: number
  code: string
  file: File
  fingerprint: string
  folderId?: string | null
  progress: UploadProgress
  task?: UploadTask
  /** instante del último aviso de progreso enviado al resto de la sala */
  lastReport: number
}

export interface PendingUpload {
  id: string
  name: string
  fingerprint: string
  size: number
  receivedBytes: number
}

const ACTIVE = new Set(['queued', 'preparing', 'uploading', 'waiting', 'finishing'])
export const isActive = (i: UploadItem) => ACTIVE.has(i.progress.state)

/**
 * Gestor global de subidas. Vive fuera de los componentes, así que cerrar el modal o cambiar de pantalla no las
 * interrumpe. Las sube de una en una (los trozos de cada una van en paralelo) y cuenta el progreso a la sala.
 */
class UploadManager {
  private items: UploadItem[] = []
  private listeners = new Set<() => void>()
  private running = false
  private seq = 1

  constructor() {
    // Cerrar la pestaña corta las subidas en curso (se podrán reanudar, pero conviene avisar).
    window.addEventListener('beforeunload', (e) => {
      if (this.items.some(isActive)) {
        e.preventDefault()
        e.returnValue = ''
      }
    })
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.items

  private set(items: UploadItem[]) {
    this.items = items
    this.listeners.forEach((l) => l())
  }

  private patch(key: number, p: Partial<UploadItem>) {
    this.set(this.items.map((i) => (i.key === key ? { ...i, ...p } : i)))
  }

  isUploading(code: string, fingerprint: string) {
    return this.items.some((i) => i.code === code && i.fingerprint === fingerprint && isActive(i))
  }

  add(code: string, file: File, handle?: FsHandle, folderId?: string | null, fingerprintOverride?: string) {
    const fingerprint = fingerprintOverride ?? fingerprintOf(file)
    if (this.isUploading(code, fingerprint)) return // ya se está subiendo
    if (handle) void saveHandle(code, fingerprint, handle)
    const item: UploadItem = {
      key: this.seq++,
      code,
      file,
      fingerprint,
      folderId,
      lastReport: 0,
      progress: { state: 'queued', loaded: 0, total: file.size, speed: 0, eta: null },
    }
    this.set([...this.items, item])
    void this.pump()
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const next = this.items.find((i) => i.progress.state === 'queued')
        if (!next) break
        await this.run(next)
      }
    } finally {
      this.running = false
    }
  }

  private async run(item: UploadItem) {
    let last: UploadProgress = item.progress
    const task = startUpload(item.code, item.file, (progress) => {
      last = progress
      this.patch(item.key, { progress })
      this.report(item.key, progress)
    }, item.folderId, item.fingerprint)
    this.patch(item.key, { task })
    await task.promise
    if (last.state === 'done') {
      notifyToast(`«${item.file.name}» subido`, 'success')
      void deleteHandle(item.code, item.fingerprint)
      setTimeout(() => this.dismiss(item.key), 6000)
    } else if (last.state === 'error') {
      notifyToast(`No se pudo subir «${item.file.name}»: ${last.message ?? 'error'}`, 'error')
    } else if (last.state === 'canceled') {
      this.dismiss(item.key)
    }
  }

  /** Avisa a la sala del avance real, como mucho una vez por segundo. */
  private report(key: number, p: UploadProgress) {
    const item = this.items.find((i) => i.key === key)
    const now = Date.now()
    if (item && p.uploadId && p.state === 'uploading' && now - item.lastReport >= 1000) {
      item.lastReport = now
      rt.notify({ type: 'upload.progress', uploadId: p.uploadId, loaded: p.loaded })
    }
  }

  async cancel(key: number) {
    const item = this.items.find((i) => i.key === key)
    if (!item) return
    if (item.task) await item.task.cancel()
    else this.patch(key, { progress: { ...item.progress, state: 'canceled' } })
    void deleteHandle(item.code, item.fingerprint)
    this.dismiss(key)
  }

  async cancelAll() {
    await Promise.all(this.items.filter(isActive).map((i) => this.cancel(i.key)))
  }

  dismiss(key: number) {
    this.set(this.items.filter((i) => i.key !== key))
  }
}

export const uploads = new UploadManager()
rt.on('account.disabled', () => void uploads.cancelAll())

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(uploads.subscribe, uploads.getSnapshot)
}

/** Subidas de esta sala que el servidor tiene a medias y que este navegador no está subiendo ahora. */
export async function loadInterrupted(code: string): Promise<PendingUpload[]> {
  const list = await api<PendingUpload[]>(`/rooms/${code}/uploads`).catch(() => [] as PendingUpload[])
  return list.filter((p) => !uploads.isUploading(code, p.fingerprint))
}

/** Borra los handles que ya no sirven: ni hay una subida a medias en el servidor ni se está subiendo ahora. */
export async function pruneStaleHandles(code: string) {
  const server = await api<PendingUpload[]>(`/rooms/${code}/uploads`).catch(() => null)
  if (!server) return // sin respuesta no se borra nada
  const keep = new Set(server.map((p) => p.fingerprint))
  uploads.getSnapshot().filter((i) => i.code === code && isActive(i)).forEach((i) => keep.add(i.fingerprint))
  await pruneHandles(code, keep)
}

/** Lee el archivo desde su handle guardado. Devuelve null si no se puede (sin handle, sin permiso o el archivo cambió). */
export async function fileFromHandle(code: string, p: PendingUpload, askPermission: boolean): Promise<File | null> {
  const handle = await getHandle(code, p.fingerprint)
  if (!handle) return null
  try {
    let perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
    if (perm !== 'granted' && askPermission) perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
    if (perm !== 'granted') return null
    const file = await handle.getFile()
    return fingerprintOf(file) === p.fingerprint ? file : null // si el archivo cambió, no es el mismo
  } catch {
    return null // el archivo se movió o se borró
  }
}

const autoTried = new Set<string>()

/**
 * Al entrar en una sala reanuda solas las subidas interrumpidas cuyo archivo se puede abrir sin preguntar
 * (navegador con File System Access y permiso ya concedido).
 */
export async function resumeInterrupted(code: string) {
  for (const p of await loadInterrupted(code)) {
    const id = `${code}|${p.fingerprint}`
    if (autoTried.has(id)) continue
    autoTried.add(id)
    const file = await fileFromHandle(code, p, false)
    if (file) {
      notifyToast(`Reanudando «${p.name}»…`, 'info')
      uploads.add(code, file, (await getHandle(code, p.fingerprint)) ?? undefined)
    }
  }
}

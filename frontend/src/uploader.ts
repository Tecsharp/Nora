import { api, ApiError, getAccessToken, refreshSession } from './api'

export type UploadState = 'queued' | 'preparing' | 'uploading' | 'waiting' | 'finishing' | 'done' | 'error' | 'canceled'

export interface UploadProgress {
  state: UploadState
  loaded: number
  total: number
  /** bytes/s medidos en los últimos segundos */
  speed: number
  /** segundos restantes estimados */
  eta: number | null
  message?: string
  /** Identificador de la subida en el servidor (disponible cuando ya se creó la sesión) */
  uploadId?: string
}

export interface UploadTask {
  cancel: () => Promise<void>
  promise: Promise<void>
}

interface Session {
  id: string
  partSize: number
  partCount: number
  received: { number: number; size: number }[]
}

const CONCURRENCY = 3
const MAX_ATTEMPTS = 12
/** Sin ningún avance durante este tiempo se considera que la conexión está colgada y se reintenta el trozo. */
const STALL_MS = 20_000

class FatalError extends Error {}
class SessionGone extends Error {}
class Canceled extends Error {}

/** Identifica un archivo del cliente para reanudar la misma subida (el servidor la guarda con cada sesión). */
export const fingerprintOf = (f: File, dir = '') => {
  // La carpeta de origen forma parte de la huella: dos archivos iguales en carpetas distintas son subidas distintas.
  let h = 5381
  for (const c of dir) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return `${dir ? `${h.toString(36)}|` : ''}${f.name}:${f.size}:${f.lastModified}`.slice(0, 160)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function waitOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
}

/**
 * Subida por trozos de 8 MiB con reintentos y reanudación: si se corta la red (o se cierra la pestaña) el servidor
 * conserva los trozos recibidos y, al volver a subir el mismo archivo, solo se envían los que faltan.
 */
export function startUpload(code: string, file: File, onUpdate: (p: UploadProgress) => void, folderId?: string | null, fingerprintOverride?: string): UploadTask {
  let canceled = false
  let sessionId: string | null = null
  const xhrs = new Set<XMLHttpRequest>()
  const retryAborts = new WeakSet<XMLHttpRequest>()
  /** Aborta una petición para reintentarla (no es una cancelación del usuario). */
  const abortForRetry = (x: XMLHttpRequest) => {
    retryAborts.add(x)
    x.abort()
  }
  const base = `/rooms/${code}/uploads`

  const run = async () => {
    for (let restart = 0; ; restart++) {
      try {
          await attempt()
          return
        } catch (e) {
          // La sesión puede haber caducado en el servidor: se crea otra una sola vez.
          if (e instanceof SessionGone && restart < 1 && !canceled) continue
          throw e
        }
      }
    }

    async function attempt() {
      const total = file.size
      let doneBytes = 0
      const inflight = new Map<number, number>()
      /** Bytes realmente enviados por la red (incluye reenvíos): es lo que mide la velocidad. */
      let sent = 0
      const lastLoaded = new Map<number, number>()
      const samples: { t: number; sent: number }[] = [{ t: Date.now(), sent: 0 }]
      let state: UploadState = 'preparing'
      let message: string | undefined
      let fatal: Error | null = null
      /** La barra nunca retrocede: si se reenvía un trozo tras un corte, se mantiene hasta que lo alcance. */
      let high = 0

      const loaded = () => Math.min(total, doneBytes + [...inflight.values()].reduce((a, b) => a + b, 0))
      const emit = () => {
        const now = Date.now()
        samples.push({ t: now, sent })
        while (samples.length > 2 && now - samples[1].t > 4000) samples.shift()
        // Velocidad = bytes enviados en los últimos ~4 s. Se recalcula con el reloj, no solo cuando llegan eventos,
        // así que si la red se queda colgada cae a 0 en vez de quedarse con el último valor.
        const base = samples[0]
        const span = now - base.t
        let speed = 0
        if ((state === 'uploading' || state === 'waiting') && span >= 1000) speed = ((sent - base.sent) / span) * 1000
        if (state !== 'uploading' || speed < 1024) speed = 0
        high = Math.max(high, loaded())
        const eta = state === 'uploading' && speed > 0 ? (total - high) / speed : null
        onUpdate({ state, loaded: high, total, speed, eta, message, uploadId: sessionId ?? undefined })
      }
      // Refresco periódico: la velocidad debe actualizarse (y caer a 0) aunque no lleguen eventos de progreso.
      const ticker = setInterval(emit, 1000)
      try {
      const setState = (s: UploadState, m?: string) => {
        state = s
        message = m
        emit()
      }

      setState('preparing')
      const fingerprint = fingerprintOverride ?? fingerprintOf(file)
      // Una carpeta (o un archivo que ya no existe) no se puede leer: es un error definitivo, no hay que reintentarlo
      await file.slice(0, 1).arrayBuffer().catch(() => {
        throw new FatalError(`No se puede leer «${file.name}». Si es una carpeta, usa «Subir carpeta».`)
      })
      const session = await withRetry(() =>
        api<Session>(base, 'POST', { name: file.name, size: file.size, contentType: file.type || undefined, fingerprint, folderId: folderId ?? undefined }),
      )
      sessionId = session.id
      const have = new Set(session.received.map((p) => p.number))
      doneBytes = session.received.reduce((a, p) => a + p.size, 0)
      const pending: number[] = []
      for (let n = 1; n <= session.partCount; n++) if (!have.has(n)) pending.push(n)
      setState('uploading')

      const onOffline = () => xhrs.forEach(abortForRetry)
      window.addEventListener('offline', onOffline)

      const putPart = (n: number, blob: Blob) =>
        new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhrs.add(xhr)
          // Con la red cortada las peticiones en vuelo pueden quedarse colgadas sin fallar: vigilamos que avancen.
          let lastProgress = Date.now()
          const watchdog = setInterval(() => {
            if (Date.now() - lastProgress > STALL_MS) abortForRetry(xhr)
          }, 2000)
          const done = () => {
            clearInterval(watchdog)
            xhrs.delete(xhr)
          }
          xhr.open('PUT', `/api${base}/${session.id}/parts/${n}`)
          xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken() ?? ''}`)
          xhr.setRequestHeader('Content-Type', 'application/octet-stream')
          xhr.upload.onprogress = (e) => {
            lastProgress = Date.now()
            const delta = e.loaded - (lastLoaded.get(n) ?? 0)
            if (delta > 0) sent += delta
            lastLoaded.set(n, e.loaded)
            inflight.set(n, e.loaded)
            emit()
          }
          xhr.onload = () => {
            done()
            if (xhr.status >= 200 && xhr.status < 300) return resolve()
            let msg = `Error ${xhr.status}`
            try {
              msg = JSON.parse(xhr.responseText).message ?? msg
            } catch {
              // cuerpo no JSON
            }
            if (xhr.status === 401) return reject(new ApiError(401, msg))
            if (xhr.status === 404) return reject(new SessionGone(msg))
            if ([400, 403, 409, 413, 507].includes(xhr.status)) return reject(new FatalError(msg))
            reject(new ApiError(xhr.status, msg)) // 5xx, 429…: reintentable
          }
          xhr.onerror = () => {
            done()
            // Si el propio archivo dejó de ser legible, reintentar no sirve de nada
            blob.slice(0, 1).arrayBuffer().then(
              () => reject(new Error('Sin conexión')),
              () => reject(new FatalError(`No se puede leer «${file.name}»`)),
            )
          }
          xhr.ontimeout = () => {
            done()
            reject(new Error('Sin conexión'))
          }
          xhr.onabort = () => {
            done()
            reject(retryAborts.has(xhr) ? new Error('Sin conexión') : new Canceled())
          }
          xhr.timeout = 5 * 60_000
          xhr.send(blob)
        })

      async function uploadPart(n: number) {
        const start = (n - 1) * session.partSize
        const blob = file.slice(start, Math.min(start + session.partSize, total))
        for (let tries = 0; ; tries++) {
          if (canceled) throw new Canceled()
          if (fatal) throw fatal
          try {
            await putPart(n, blob)
            inflight.delete(n)
            lastLoaded.delete(n)
            doneBytes += blob.size
            setState('uploading')
            return
          } catch (e) {
            inflight.delete(n)
            lastLoaded.delete(n)
            if (e instanceof Canceled || e instanceof FatalError || e instanceof SessionGone) throw e
            if (e instanceof ApiError && e.status === 401) {
              if (!(await refreshSession())) throw new FatalError('Tu sesión ha caducado')
              continue
            }
            if (tries + 1 >= MAX_ATTEMPTS) throw new FatalError('No se pudo subir tras varios intentos')
            setState('waiting', navigator.onLine ? `Reintentando (${tries + 1}/${MAX_ATTEMPTS})…` : 'Sin conexión, se reanudará solo…')
            await waitOnline()
            await sleep(Math.min(15_000, 1000 * 2 ** Math.min(tries, 4)) + Math.random() * 400)
          }
        }
      }

      async function worker() {
        while (pending.length && !canceled && !fatal) {
          await uploadPart(pending.shift()!).catch((e) => {
            if (!(e instanceof Canceled)) fatal ??= e
            xhrs.forEach((x) => x.abort())
          })
        }
      }

      try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))
      } finally {
        window.removeEventListener('offline', onOffline)
      }
      if (canceled) throw new Canceled()
      if (fatal) throw fatal

      setState('finishing')
      await withRetry(() => api(`${base}/${session.id}/complete`, 'POST'))
      doneBytes = total
      setState('done')
    } finally {
      clearInterval(ticker)
    }
  }

  /** Reintenta peticiones normales (crear/completar) ante cortes de red; los errores del servidor no se reintentan. */
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let tries = 0; ; tries++) {
      if (canceled) throw new Canceled()
      try {
        return await fn()
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) throw new SessionGone(e.message)
        if (e instanceof ApiError && e.status < 500 && e.status !== 429) throw new FatalError(e.message)
        if (tries + 1 >= 6) throw new FatalError('No se pudo contactar con el servidor')
        await waitOnline()
        await sleep(1000 * 2 ** tries)
      }
    }
  }

  const promise = run().then(
    () => undefined,
    (e) => {
      if (e instanceof Canceled) {
        onUpdate({ state: 'canceled', loaded: 0, total: file.size, speed: 0, eta: null })
        return
      }
      onUpdate({ state: 'error', loaded: 0, total: file.size, speed: 0, eta: null, message: e instanceof Error ? e.message : 'Error al subir' })
    },
  )

  return {
    promise,
    cancel: async () => {
      canceled = true
      xhrs.forEach((x) => x.abort())
      if (sessionId) await api(`${base}/${sessionId}`, 'DELETE').catch(() => {})
    },
  }
}

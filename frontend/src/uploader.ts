import { api, ApiError, getAccessToken, refreshSession } from './api'

export type UploadState = 'preparing' | 'uploading' | 'waiting' | 'finishing' | 'done' | 'error' | 'canceled'

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function waitOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
}

/**
 * Subida por trozos de 8 MiB con reintentos y reanudación: si se corta la red (o se cierra la pestaña) el servidor
 * conserva los trozos recibidos y, al volver a subir el mismo archivo, solo se envían los que faltan.
 */
export function startUpload(code: string, file: File, onUpdate: (p: UploadProgress) => void): UploadTask {
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
    const samples: { t: number; loaded: number }[] = []
    let state: UploadState = 'preparing'
    let message: string | undefined
    let fatal: Error | null = null

    const loaded = () => Math.min(total, doneBytes + [...inflight.values()].reduce((a, b) => a + b, 0))
    const emit = () => {
      const now = Date.now()
      const l = loaded()
      samples.push({ t: now, loaded: l })
      while (samples.length > 2 && now - samples[0].t > 5000) samples.shift()
      let speed = 0
      const first = samples[0]
      if (state === 'uploading' && now - first.t >= 500) speed = Math.max(0, ((l - first.loaded) / (now - first.t)) * 1000)
      onUpdate({ state, loaded: l, total, speed, eta: speed > 0 ? (total - l) / speed : null, message, uploadId: sessionId ?? undefined })
    }
    const setState = (s: UploadState, m?: string) => {
      state = s
      message = m
      emit()
    }

    setState('preparing')
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`.slice(0, 160)
    const session = await withRetry(() =>
      api<Session>(base, 'POST', { name: file.name, size: file.size, contentType: file.type || undefined, fingerprint }),
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
          reject(new Error('Sin conexión'))
        }
        xhr.ontimeout = xhr.onerror
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
          doneBytes += blob.size
          setState('uploading')
          return
        } catch (e) {
          inflight.delete(n)
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

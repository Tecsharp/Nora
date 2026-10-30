import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getAccessToken, refreshSession } from '../api'
import { useAuth } from '../auth'

/**
 * IA con DeepSeek. Las funciones de IA solo existen en la interfaz si el servidor la tiene activada (NORA_AI_ENABLED=true y clave en .env):
 * mientras `enabled` sea false, ningún componente muestra nada de IA.
 */

export interface AiRequest {
  task: string
  text: string
  language?: string
  instruction?: string
  now?: string
}

export interface AiRunOptions {
  /** Cada trozo que llega y el texto acumulado hasta ahora. */
  onChunk?: (chunk: string, full: string) => void
  signal?: AbortSignal
}

interface AiApi {
  enabled: boolean
  model: string
  run: (req: AiRequest, opts?: AiRunOptions) => Promise<string>
  /** Para las tareas que devuelven JSON (extraer tareas, opciones de votación, evento desde texto…). */
  json: <T>(req: AiRequest, opts?: AiRunOptions) => Promise<T>
}

const Ctx = createContext<AiApi>({ enabled: false, model: '', run: async () => '', json: async () => ({}) as never })
export const useAi = () => useContext(Ctx)

/** «Ahora» del usuario en su zona (para que la IA entienda «mañana a las 5»). */
export const aiNow = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())} (${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()]})`
}

async function post(req: AiRequest, signal?: AbortSignal): Promise<Response> {
  const send = () => fetch('/api/ai/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body: JSON.stringify(req),
    signal,
  })
  let res = await send()
  if (res.status === 401 && (await refreshSession())) res = await send()
  return res
}

async function run(req: AiRequest, opts: AiRunOptions = {}): Promise<string> {
  const res = await post(req, opts.signal)
  if (!res.ok || !res.body) {
    const msg = await res.json().then((j: { message?: string }) => j.message).catch(() => undefined)
    throw new Error(msg || 'No se pudo usar la IA')
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 2)
      if (!line.startsWith('data:')) continue
      const ev = JSON.parse(line.slice(5)) as { d?: string; done?: boolean; error?: string }
      if (ev.error) throw new Error(ev.error)
      if (ev.d) {
        full += ev.d
        opts.onChunk?.(ev.d, full)
      }
    }
  }
  return full
}

async function json<T>(req: AiRequest, opts?: AiRunOptions): Promise<T> {
  const out = await run(req, opts)
  const clean = out.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(clean) as T
  } catch {
    throw new Error('La IA no devolvió un resultado válido. Inténtalo de nuevo.')
  }
}

export function AiProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState({ enabled: false, model: '' })

  useEffect(() => {
    if (!user) {
      setState({ enabled: false, model: '' })
      return
    }
    api<{ enabled: boolean; model: string }>('/ai/status').then((s) => setState({ enabled: !!s.enabled, model: s.model ?? '' })).catch(() => setState({ enabled: false, model: '' }))
  }, [user])

  const runCb = useCallback(run, [])
  const jsonCb = useCallback(json, []) as AiApi['json']
  const value = useMemo<AiApi>(() => ({ ...state, run: runCb, json: jsonCb }), [state, runCb, jsonCb])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'

export interface FocusMember { userId: string; name: string; task: string; since: number }
export interface FocusState {
  mode: 'focus' | 'short' | 'long'
  status: 'idle' | 'running' | 'paused'
  endsAt: number | null
  remainingMs: number
  focusMin: number
  shortMin: number
  longMin: number
  auto: boolean
  cycle: number
  members: FocusMember[]
  finished: { mode: string; at: number } | null
  rev: number
  serverNow: number
}

export const MODE_LABEL = { focus: 'Foco', short: 'Descanso corto', long: 'Descanso largo' } as const
const INITIAL: FocusState = { mode: 'focus', status: 'idle', endsAt: null, remainingMs: 25 * 60_000, focusMin: 25, shortMin: 5, longMin: 15, auto: false, cycle: 0, members: [], finished: null, rev: 0, serverNow: Date.now() }

let audio: AudioContext | null = null
if (typeof window !== 'undefined') {
  // los navegadores solo dejan sonar tras un gesto: se prepara en el primer clic o tecla
  const arm = () => {
    try { audio ??= new AudioContext(); void audio.resume() } catch { /* sin audio */ }
    window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm)
  }
  window.addEventListener('pointerdown', arm); window.addEventListener('keydown', arm)
}
/** Tres notas suaves; no hace falta ningún archivo de sonido. */
export function chime() {
  if (!audio) return
  const t0 = audio.currentTime
  ;[660, 880, 1100].forEach((f, i) => {
    const o = audio!.createOscillator()
    const g = audio!.createGain()
    o.type = 'sine'; o.frequency.value = f
    g.gain.setValueAtTime(0, t0 + i * 0.22); g.gain.linearRampToValueAtTime(0.18, t0 + i * 0.22 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.6)
    o.connect(g).connect(audio!.destination); o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.65)
  })
}

const SOUND_KEY = 'nora-focus-sound'

/**
 * Temporizador de Foco compartido. El servidor manda el estado y la hora; cada navegador calcula lo que falta con su desfase de reloj y avisa
 * (sonido, aviso y título de la pestaña) al terminar cada periodo, aunque la herramienta esté cerrada.
 */
export function useFocus(code: string) {
  const toast = useToast()
  const [state, setState] = useState<FocusState>(INITIAL)
  const [now, setNow] = useState(Date.now())
  const offset = useRef(0)
  const lastFinished = useRef<number>(0)
  const ready = useRef(false)
  const [sound, setSoundState] = useState(() => { try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true } })
  const soundRef = useRef(sound)
  soundRef.current = sound
  const baseTitle = useRef(typeof document === 'undefined' ? '' : document.title)

  const apply = useCallback((s: FocusState) => {
    setState((prev) => (s.rev >= prev.rev ? s : prev))
    offset.current = s.serverNow - Date.now()
    if (!ready.current) { ready.current = true; lastFinished.current = s.finished?.at ?? 0; return }
    if (s.finished && s.finished.at > lastFinished.current) {
      lastFinished.current = s.finished.at
      const done = s.finished.mode as FocusState['mode']
      toast(done === 'focus' ? '¡Foco terminado! Toca descansar.' : '¡Descanso terminado! Vuelve al foco.', 'success')
      if (soundRef.current) chime()
    }
  }, [toast])

  useEffect(() => {
    let alive = true
    api<{ focus: FocusState }>(`/rooms/${encodeURIComponent(code)}/live`).then((r) => alive && apply(r.focus)).catch(() => undefined)
    return () => { alive = false }
  }, [code, apply])
  useRealtime('live.changed', (e: { tool: string; state: FocusState }) => { if (e.tool === 'focus') apply(e.state) })
  useRealtime('reconnected', () => { api<{ focus: FocusState }>(`/rooms/${encodeURIComponent(code)}/live`).then((r) => apply(r.focus)).catch(() => undefined) })

  useEffect(() => {
    if (state.status !== 'running') return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [state.status, state.rev])

  const remaining = state.status === 'running' && state.endsAt ? Math.max(0, state.endsAt - (now + offset.current)) : state.remainingMs
  const total = (state.mode === 'focus' ? state.focusMin : state.mode === 'short' ? state.shortMin : state.longMin) * 60_000

  // el título de la pestaña muestra el tiempo mientras corre
  useEffect(() => {
    if (state.status === 'running') document.title = `${fmt(remaining)} · ${MODE_LABEL[state.mode]}`
    else document.title = baseTitle.current
    return () => { document.title = baseTitle.current }
  }, [state.status, state.mode, remaining])

  const send = useCallback(async (body: Record<string, unknown>) => {
    try {
      apply(await api<FocusState>(`/rooms/${encodeURIComponent(code)}/live/focus`, 'POST', body))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cambiar el temporizador', 'error')
    }
  }, [code, apply, toast])

  const setSound = (on: boolean) => {
    setSoundState(on)
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* sin almacenamiento */ }
    if (on) chime()
  }

  return { state, remaining, total, send, sound, setSound, now: now + offset.current }
}
export type FocusApi = ReturnType<typeof useFocus>

export function fmt(ms: number) {
  const s = Math.ceil(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

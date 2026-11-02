import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rt, useRealtime, useRtStatus } from '../realtime'
import { useToast } from '../toast'
import { callSounds } from './sounds'
import { callApi, type CallInfo, type CallState, type Part } from './api'
import type { LocalMedia } from './useLocalMedia'

export type Phase = 'loading' | 'prejoin' | 'joining' | 'waiting' | 'joined' | 'denied' | 'removed' | 'ended' | 'left' | 'error'

interface PeerRec {
  conn: string
  pc: RTCPeerConnection
  polite: boolean
  making: boolean
  ignore: boolean
  /** Quien ofrece los crea al principio; quien responde los toma de la primera oferta (ver `bindSenders`). */
  audio: RTCRtpSender | null
  video: RTCRtpSender | null
  screen: RTCRtpSender | null
  pending: RTCIceCandidateInit[]
  queue: Promise<void>
}

export interface Caption { name: string; text: string; final: boolean; at: number }
export interface FloatingReaction { id: number; name: string; emoji: string; left: number }

interface SpeechRec {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

export const captionsSupported = () => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const LANG_KEY = 'nora-call-cc-lang'

/**
 * Una llamada vista desde este navegador. Hace de puente entre el WebSocket de Nora (quién está, quién espera, mano levantada…) y las conexiones
 * WebRTC directas con cada persona (audio, video y pantalla). Es una malla: cada participante abre una conexión con todos los demás, con la
 * «negociación perfecta» de WebRTC para que dos personas que se llaman a la vez no se pisen.
 */
export function useCall(code: string, media: LocalMedia) {
  const toast = useToast()
  const status = useRtStatus()
  const [phase, setPhaseState] = useState<Phase>('loading')
  const [info, setInfo] = useState<CallInfo | null>(null)
  const [error, setError] = useState('')
  const [state, setState] = useState<CallState | null>(null)
  const [me, setMe] = useState('')
  const [remotes, setRemotes] = useState<Record<string, Record<string, MediaStream>>>({})
  const [screen, setScreen] = useState<MediaStream | null>(null)
  const [reactions, setReactions] = useState<FloatingReaction[]>([])
  const [captions, setCaptions] = useState<Record<string, Caption>>({})
  const [showCaptions, setShowCaptions] = useState(false)
  const [cc, setCc] = useState(false)
  const [ccLang, setCcLang] = useState(() => { try { return localStorage.getItem(LANG_KEY) || navigator.language || 'es-ES' } catch { return 'es-ES' } })
  const [companion, setCompanionState] = useState(false)

  const peers = useRef(new Map<string, PeerRec>())
  const ice = useRef<RTCIceServer[]>(FALLBACK_ICE)
  const phaseRef = useRef<Phase>('loading')
  const meRef = useRef('')
  const stateRef = useRef<CallState | null>(null)
  const mediaRef = useRef(media)
  mediaRef.current = media
  const companionRef = useRef(false)
  companionRef.current = companion
  const camMs = useRef(new MediaStream())
  const screenMs = useRef(new MediaStream())
  const screenTrack = useRef<MediaStreamTrack | null>(null)
  const needJoin = useRef(false)
  const reactionId = useRef(0)

  const setPhase = useCallback((p: Phase) => { phaseRef.current = p; setPhaseState(p) }, [])

  // ---- datos de la llamada ----
  useEffect(() => {
    let alive = true
    callApi.info(code).then((i) => {
      if (!alive) return
      setInfo(i)
      setPhase(i.endedAt ? 'ended' : 'prejoin')
    }).catch((e: Error) => { if (alive) { setError(e.message); setPhase('error') } })
    return () => { alive = false }
  }, [code, setPhase])

  // ---- señalización ----
  const send = useCallback((msg: Record<string, unknown>) => rt.notify({ type: msg.type, code, ...msg }), [code])
  const sendMe = useCallback((p: Record<string, unknown>) => send({ type: 'call.me', ...p }), [send])
  const sendSignal = useCallback((to: string, data: unknown) => send({ type: 'call.signal', to, data }), [send])

  const sendJoin = useCallback(() => {
    const m = mediaRef.current
    send({ type: 'call.join', companion: companionRef.current, mic: m.mic && !companionRef.current, cam: m.cam })
  }, [send])

  // ---- conexiones directas ----
  const applyTracks = useCallback((rec: PeerRec) => {
    const m = mediaRef.current
    rec.audio?.replaceTrack(companionRef.current ? null : m.audioTrack).catch(() => {})
    rec.video?.replaceTrack(m.videoTrack).catch(() => {})
    rec.screen?.replaceTrack(screenTrack.current).catch(() => {})
  }, [])

  /**
   * Quien responde no crea sus transceptores: el navegador solo reutiliza los creados con addTrack, así que los de addTransceiver quedarían
   * sin usar y esa persona no enviaría nada. Toma los que nacen de la oferta (audio, cámara y pantalla, en ese orden) y los pone en ambos sentidos.
   */
  const bindSenders = useCallback((rec: PeerRec) => {
    if (rec.audio) return
    const ts = rec.pc.getTransceivers()
    if (ts.length < 3) return
    const [a, v, s] = ts as [RTCRtpTransceiver, RTCRtpTransceiver, RTCRtpTransceiver]
    for (const t of [a, v, s]) t.direction = 'sendrecv'
    a.sender.setStreams(camMs.current)
    v.sender.setStreams(camMs.current)
    s.sender.setStreams(screenMs.current)
    rec.audio = a.sender; rec.video = v.sender; rec.screen = s.sender
    applyTracks(rec)
  }, [applyTracks])

  const handleSignal = useCallback(async (rec: PeerRec, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; restart?: boolean }) => {
    const pc = rec.pc
    if (data.restart) { if (!rec.polite) pc.restartIce(); return }
    if (data.description) {
      const d = data.description
      const collision = d.type === 'offer' && (rec.making || pc.signalingState !== 'stable')
      rec.ignore = !rec.polite && collision
      if (rec.ignore) return
      await pc.setRemoteDescription(d)
      if (d.type === 'offer') bindSenders(rec)
      for (const c of rec.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      if (d.type === 'offer') {
        await pc.setLocalDescription()
        sendSignal(rec.conn, { description: pc.localDescription })
      }
    } else if (data.candidate) {
      if (!pc.remoteDescription) { rec.pending.push(data.candidate); return }
      try { await pc.addIceCandidate(data.candidate) } catch (e) { if (!rec.ignore) console.warn('ICE', e) }
    }
  }, [sendSignal, bindSenders])

  const createPeer = useCallback((conn: string) => {
    if (peers.current.has(conn)) return peers.current.get(conn)!
    const pc = new RTCPeerConnection({ iceServers: ice.current, bundlePolicy: 'max-bundle' })
    const polite = meRef.current > conn
    const t = (kind: 'audio' | 'video', ms: MediaStream) => (polite ? null : pc.addTransceiver(kind, { direction: 'sendrecv', streams: [ms] }).sender)
    const rec: PeerRec = {
      conn, pc, polite, making: false, ignore: false, pending: [], queue: Promise.resolve(),
      audio: t('audio', camMs.current), video: t('video', camMs.current), screen: t('video', screenMs.current),
    }
    peers.current.set(conn, rec)
    // Solo una de las dos partes (la «no educada») ofrece: así nunca se cruzan dos ofertas. Las pistas cambian con replaceTrack, sin renegociar.
    pc.onnegotiationneeded = async () => {
      if (rec.polite) return
      try {
        rec.making = true
        await pc.setLocalDescription()
        sendSignal(conn, { description: pc.localDescription })
      } catch (e) { console.warn('negociación', e) } finally { rec.making = false }
    }
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(conn, { candidate: e.candidate }) }
    pc.oniceconnectionstatechange = () => {
      console.debug('[llamada]', conn.slice(0, 6), 'ice', pc.iceConnectionState)
      if (pc.iceConnectionState === 'failed') {
        if (rec.polite) sendSignal(conn, { restart: true }) // quien ofrece es quien reinicia ICE
        else pc.restartIce()
      }
    }
    pc.ontrack = (e) => {
      const ms = e.streams[0] ?? new MediaStream([e.track])
      setRemotes((r) => (r[conn]?.[ms.id] === ms ? r : { ...r, [conn]: { ...(r[conn] ?? {}), [ms.id]: ms } }))
    }
    applyTracks(rec)
    return rec
  }, [applyTracks, sendSignal])

  const closePeer = useCallback((conn: string) => {
    const rec = peers.current.get(conn)
    if (!rec) return
    peers.current.delete(conn)
    rec.pc.onnegotiationneeded = rec.pc.onicecandidate = rec.pc.ontrack = rec.pc.oniceconnectionstatechange = null
    try { rec.pc.close() } catch { /* ya cerrada */ }
    setRemotes((r) => { if (!(conn in r)) return r; const { [conn]: _gone, ...rest } = r; void _gone; return rest })
  }, [])

  const closeAll = useCallback(() => {
    for (const c of [...peers.current.keys()]) closePeer(c)
    screenTrack.current?.stop()
    screenTrack.current = null
    setScreen(null)
  }, [closePeer])

  const applyState = useCallback((st: CallState) => {
    stateRef.current = st
    setState(st)
    if (!meRef.current) return
    const others = st.parts.filter((p) => p.conn !== meRef.current)
    for (const p of others) createPeer(p.conn)
    for (const c of [...peers.current.keys()]) if (!others.some((p) => p.conn === c)) closePeer(c)
  }, [createPeer, closePeer])

  // mis pistas cambian (cámara, micrófono, pantalla, modo complementario) → todas las conexiones las usan sin renegociar
  useEffect(() => { for (const rec of peers.current.values()) applyTracks(rec) }, [media.audioTrack, media.videoTrack, companion, screen, applyTracks])

  // ---- eventos del servidor ----
  const mine = (d: { code?: string }) => d?.code === code
  useRealtime('call.joined', (d) => {
    if (!mine(d)) return
    meRef.current = d.me
    setMe(d.me)
    setPhase('joined')
    applyState(d.state)
  })
  useRealtime('call.waiting', (d) => { if (mine(d)) setPhase('waiting') })
  useRealtime('call.denied', (d) => { if (mine(d)) { setPhase('denied'); closeAll() } })
  useRealtime('call.state', (d) => { if (mine(d) && phaseRef.current === 'joined') applyState(d) })
  useRealtime('call.signal', (d) => {
    if (!mine(d) || phaseRef.current !== 'joined') return
    let rec = peers.current.get(d.from)
    if (!rec && stateRef.current?.parts.some((p) => p.conn === d.from)) rec = createPeer(d.from)
    if (!rec) return
    const r = rec
    r.queue = r.queue.then(() => handleSignal(r, d.data)).catch((e) => console.warn('señal', e))
  })
  useRealtime('call.reaction', (d) => {
    if (!mine(d)) return
    const id = ++reactionId.current
    setReactions((l) => [...l.slice(-12), { id, name: d.name, emoji: d.emoji, left: 3 + Math.random() * 12 }])
    setTimeout(() => setReactions((l) => l.filter((x) => x.id !== id)), 3600)
  })
  useRealtime('call.caption', (d) => { if (mine(d)) setCaptions((c) => ({ ...c, [d.from]: { name: d.name, text: d.text, final: !!d.final, at: Date.now() } })) })
  useRealtime('call.mute', (d) => {
    if (!mine(d)) return
    void mediaRef.current.setMic(false)
    sendMe({ mic: false })
    toast('El anfitrión silenció tu micrófono', 'info')
  })
  useRealtime('call.removed', (d) => { if (mine(d)) { callSounds.exit(); closeAll(); mediaRef.current.stopAll(); setPhase('removed') } })
  useRealtime('call.ended', (d) => { if (mine(d)) { callSounds.exit(); closeAll(); mediaRef.current.stopAll(); setPhase('ended') } })
  useRealtime('call.error', (d) => {
    if (d.code && d.code !== code) return
    if (phaseRef.current === 'joining' || phaseRef.current === 'waiting') { setError(d.message); setPhase('error') }
    else toast(d.message, 'warning')
  })
  useRealtime('reconnected', () => {
    if (phaseRef.current !== 'joined' && phaseRef.current !== 'waiting') return
    for (const c of [...peers.current.keys()]) closePeer(c) // la conexión de Nora cambió de identidad: se vuelve a entrar
    meRef.current = ''
    setPhase('joining')
    sendJoin()
  })

  // entrar cuando la conexión con Nora esté lista
  useEffect(() => {
    if (needJoin.current && status === 'open') { needJoin.current = false; sendJoin() }
  }, [status, sendJoin])

  // ---- acciones ----
  const join = useCallback(async (opts: { companion: boolean }) => {
    companionRef.current = opts.companion
    setCompanionState(opts.companion)
    setError('')
    setPhase('joining')
    try { ice.current = (await callApi.ice()).iceServers } catch { ice.current = FALLBACK_ICE }
    if (rt.status === 'open') sendJoin()
    else needJoin.current = true
  }, [sendJoin, setPhase])

  const leave = useCallback(() => {
    needJoin.current = false
    if (phaseRef.current === 'joined' || phaseRef.current === 'waiting') send({ type: 'call.leave' })
    closeAll()
    mediaRef.current.stopAll()
    setCc(false)
    setState(null)
    meRef.current = ''
    setMe('')
    setPhase('left')
  }, [send, closeAll, setPhase])

  const toggleMic = useCallback(async () => {
    if (companionRef.current) return
    const on = !mediaRef.current.mic
    if (await mediaRef.current.setMic(on)) sendMe({ mic: on })
  }, [sendMe])

  const toggleCam = useCallback(async () => {
    const on = !mediaRef.current.cam
    if (await mediaRef.current.setCam(on)) sendMe({ cam: on })
  }, [sendMe])

  const setCompanion = useCallback(async (on: boolean) => {
    companionRef.current = on
    setCompanionState(on)
    if (on) await mediaRef.current.setMic(false)
    if (phaseRef.current === 'joined') sendMe({ companion: on, mic: false })
  }, [sendMe])

  const startScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { toast('Este navegador no permite compartir pantalla', 'warning'); return }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false })
      const track = s.getVideoTracks()[0]!
      try { track.contentHint = 'detail' } catch { /* no todos los navegadores */ }
      screenTrack.current?.stop()
      screenTrack.current = track
      track.onended = () => stopScreen()
      setScreen(new MediaStream([track]))
      sendMe({ screen: screenMs.current.id })
    } catch { /* cancelado */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMe, toast])

  const stopScreen = useCallback(() => {
    screenTrack.current?.stop()
    screenTrack.current = null
    setScreen(null)
    sendMe({ screen: null })
  }, [sendMe])

  const myPart = useMemo(() => state?.parts.find((p) => p.conn === me) ?? null, [state, me])
  const toggleHand = useCallback(() => sendMe({ hand: !myPart?.hand }), [sendMe, myPart])
  const react = useCallback((emoji: string) => send({ type: 'call.reaction', emoji }), [send])
  const admit = useCallback((conn: string, allow: boolean) => send({ type: 'call.admit', conn, allow }), [send])
  const host = useCallback((action: 'mute' | 'muteAll' | 'remove' | 'lowerHand' | 'access' | 'end', extra: Record<string, unknown> = {}) => send({ type: 'call.host', action, ...extra }), [send])

  // ---- subtítulos (el navegador transcribe la voz de su persona y la reparte) ----
  const setLang = useCallback((l: string) => { setCcLang(l); try { localStorage.setItem(LANG_KEY, l) } catch { /* sin almacenamiento */ } }, [])
  /** Un solo botón: activa los subtítulos (verlos y transcribir mi voz para los demás) o los apaga. */
  const toggleCaptions = useCallback(() => {
    const turnOn = !showCaptions
    setShowCaptions(turnOn)
    if (turnOn && !captionsSupported()) {
      toast('Este navegador no puede transcribir tu voz (usa Chrome, Edge o Safari); verás los subtítulos de quien sí pueda.', 'info')
      return
    }
    if (cc !== turnOn) { setCc(turnOn); sendMe({ cc: turnOn }) }
  }, [showCaptions, cc, sendMe, toast])

  useEffect(() => {
    if (phase !== 'joined' || !cc || !media.mic || companion || !captionsSupported()) return
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
    const Rec = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!
    const r = new Rec()
    r.lang = ccLang
    r.continuous = true
    r.interimResults = true
    let alive = true
    let last = 0
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!
        const now = Date.now()
        if (!res.isFinal && now - last < 350) continue // los parciales se espacian
        last = now
        const text = res[0].transcript.trim()
        if (text) send({ type: 'call.caption', text, final: res.isFinal })
      }
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
        alive = false
        toast(e.error === 'network' ? 'No se pudo conectar con el servicio de transcripción de tu navegador' : 'Permite el micrófono para los subtítulos', 'warning')
        setCc(false)
        sendMe({ cc: false })
      }
    }
    r.onend = () => { if (alive) setTimeout(() => { if (alive) { try { r.start() } catch { /* ya en marcha */ } } }, 250) }
    try { r.start() } catch { /* ya en marcha */ }
    return () => { alive = false; r.onend = null; r.onresult = null; r.onerror = null; try { r.stop() } catch { /* parado */ } }
  }, [phase, cc, media.mic, companion, ccLang, send, sendMe, toast])

  // se olvidan los subtítulos viejos
  useEffect(() => {
    const t = setInterval(() => setCaptions((c) => {
      const now = Date.now()
      const keep = Object.entries(c).filter(([, v]) => now - v.at < (v.final ? 5000 : 3500))
      return keep.length === Object.keys(c).length ? c : Object.fromEntries(keep)
    }), 1000)
    return () => clearInterval(t)
  }, [])

  // al cerrar la página se suelta todo
  useEffect(() => () => { for (const c of [...peers.current.keys()]) { try { peers.current.get(c)?.pc.close() } catch { /* nada */ } } screenTrack.current?.stop() }, [])

  const remoteCam = useCallback((p: Part): MediaStream | null => {
    const m = remotes[p.conn]
    return m ? Object.values(m).find((s) => s.id !== p.screen) ?? null : null
  }, [remotes])
  const remoteScreen = useCallback((p: Part): MediaStream | null => (p.screen ? remotes[p.conn]?.[p.screen] ?? null : null), [remotes])

  return {
    phase, info, error, state, me, myPart, isHost: !!myPart?.host, companion, remotes, screen, reactions, captions, showCaptions, cc, ccLang,
    join, leave, toggleMic, toggleCam, setCompanion, startScreen, stopScreen, toggleHand, react, admit, host, setLang, toggleCaptions,
    remoteCam, remoteScreen, setPhase,
  }
}

export type CallApi = ReturnType<typeof useCall>

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { rt, useRealtime } from '../realtime'
import { useToast } from '../toast'

/**
 * Asistencia: ver (y, con el agente de escritorio, controlar) la pantalla de otra persona de la sala.
 * La pantalla viaja directa entre los dos navegadores (WebRTC); el servidor de Nora solo hace de señalización y comprueba los permisos.
 * Quien comparte siempre decide: acepta cada petición, elige qué pantalla enseña y puede cortar la sesión o el control cuando quiera.
 */

export interface Person {
  id: string
  name: string
}
export type Mode = 'view' | 'control'
export type ControlState = 'none' | 'asked' | 'granted'

export interface AssistSession {
  id: string
  role: 'viewer' | 'sharer'
  peer: Person
  mode: Mode
  control: ControlState
  controller: string
  stream: MediaStream | null
  state: 'connecting' | 'live'
}

export interface Incoming {
  id: string
  kind: 'request' | 'invite' | 'control'
  from: Person
  mode: Mode
}

export interface AgentInfo {
  online: boolean
  os?: string
  version?: string
  screen?: string
}

interface Api {
  sessions: AssistSession[]
  incoming: Incoming[]
  agent: AgentInfo
  /** Pido ver (o controlar) la pantalla de otra persona. */
  ask: (to: Person, mode: Mode) => void
  /** Ofrezco mi pantalla a otra persona. */
  share: (to: Person) => Promise<void>
  accept: (i: Incoming) => Promise<void>
  decline: (i: Incoming) => void
  end: (id: string) => void
  requestControl: (id: string) => void
  revokeControl: (id: string) => void
  input: (id: string, e: Record<string, unknown>) => void
}

const noop = () => {}
const Ctx = createContext<Api>({
  sessions: [], incoming: [], agent: { online: false }, ask: noop, share: async () => {}, accept: async () => {}, decline: noop, end: noop,
  requestControl: noop, revokeControl: noop, input: noop,
})
export const useAssist = () => useContext(Ctx)

export const screenSharingSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof RTCPeerConnection !== 'undefined'

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export function AssistProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [sessions, setSessions] = useState<AssistSession[]>([])
  const [incoming, setIncoming] = useState<Incoming[]>([])
  const [agent, setAgent] = useState<AgentInfo>({ online: false })
  const pcs = useRef(new Map<string, RTCPeerConnection>())
  const queued = useRef(new Map<string, RTCIceCandidateInit[]>())
  const shared = useRef<MediaStream | null>(null) // mi pantalla, compartida con una o varias personas
  const pendingInvites = useRef(new Set<string>()) // invitaciones mías que aún no aceptaron
  const inviting = useRef(false)
  const sessionsRef = useRef<AssistSession[]>([])
  sessionsRef.current = sessions
  const incomingRef = useRef<Incoming[]>([])
  incomingRef.current = incoming

  const patch = useCallback((id: string, p: Partial<AssistSession>) => setSessions((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s))), [])
  const send = (msg: object) => rt.notify(msg)

  const stopShared = useCallback(() => {
    shared.current?.getTracks().forEach((t) => t.stop())
    shared.current = null
  }, [])

  /** Cierra todo lo de una sesión (conexión y, si ya nadie más ve mi pantalla, el uso compartido). */
  const drop = useCallback((id: string) => {
    pcs.current.get(id)?.close()
    pcs.current.delete(id)
    queued.current.delete(id)
    setSessions((l) => l.filter((s) => s.id !== id))
    // si nadie más está viendo mi pantalla se deja de compartir (una invitación pendiente la conserva)
    setTimeout(() => !sessionsRef.current.some((s) => s.role === 'sharer') && !pendingInvites.current.size && stopShared(), 0)
  }, [stopShared])

  const grabScreen = useCallback(async (needMonitor: boolean): Promise<MediaStream | null> => {
    let s = shared.current
    if (s && !s.getVideoTracks().some((t) => t.readyState === 'live')) s = shared.current = null
    if (!s) {
      try {
        s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, cursor: 'always' } as MediaTrackConstraints, audio: false })
      } catch {
        return null // canceló el selector
      }
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        // lo dejó de compartir desde la barra del navegador
        sessionsRef.current.filter((x) => x.role === 'sharer').forEach((x) => send({ type: 'assist.end', session: x.id }))
        pendingInvites.current.forEach((id) => send({ type: 'assist.end', session: id }))
        pendingInvites.current.clear()
        stopShared()
      })
      shared.current = s
    }
    if (needMonitor && (s.getVideoTracks()[0]?.getSettings() as { displaySurface?: string }).displaySurface !== 'monitor') {
      toast('Para que alguien pueda controlar tu equipo comparte la pantalla completa (no una ventana ni una pestaña).', 'warning')
      if (!sessionsRef.current.some((x) => x.role === 'sharer')) stopShared()
      return null
    }
    return s
  }, [stopShared, toast])

  const iceServers = async (): Promise<RTCIceServer[]> => {
    try {
      const r = await api<{ iceServers: RTCIceServer[] }>('/assist/ice')
      return r.iceServers.length ? r.iceServers : FALLBACK_ICE
    } catch {
      return FALLBACK_ICE
    }
  }

  const connect = useCallback(async (id: string, role: 'viewer' | 'sharer') => {
    const pc = new RTCPeerConnection({ iceServers: await iceServers() })
    pcs.current.set(id, pc)
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'assist.signal', session: id, payload: { candidate: e.candidate.toJSON() } })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') patch(id, { state: 'live' })
      if (pc.connectionState === 'failed') {
        toast('No se pudo establecer la conexión de la pantalla (la red lo impide). Un administrador puede activar un servidor TURN.', 'error')
        send({ type: 'assist.end', session: id })
      }
    }
    if (role === 'viewer') {
      pc.ontrack = (e) => patch(id, { stream: e.streams[0] ?? new MediaStream([e.track]) })
      return
    }
    const stream = shared.current
    if (!stream) return send({ type: 'assist.end', session: id })
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    await pc.setLocalDescription(await pc.createOffer())
    send({ type: 'assist.signal', session: id, payload: { sdp: pc.localDescription?.toJSON() } })
  }, [patch, toast])

  useRealtime('assist.request', (d: { session: string; from: Person; mode: Mode }) => setIncoming((l) => [...l, { id: d.session, kind: 'request', from: d.from, mode: d.mode }]))
  useRealtime('assist.invite', (d: { session: string; from: Person }) => setIncoming((l) => [...l, { id: d.session, kind: 'invite', from: d.from, mode: 'view' }]))
  useRealtime('assist.taken', (d: { session: string }) => setIncoming((l) => l.filter((i) => i.id !== d.session)))
  useRealtime('assist.pending', (d: { session: string }) => {
    if (inviting.current) {
      inviting.current = false
      pendingInvites.current.add(d.session)
    }
    toast('Petición enviada. Esperando a que la acepte…', 'info')
  })
  useRealtime('assist.declined', (d: { session: string; by: string }) => {
    pendingInvites.current.delete(d.session)
    toast(d.by ? `${d.by} rechazó la asistencia` : 'No hubo respuesta a la petición de asistencia', 'warning')
    setTimeout(() => !sessionsRef.current.some((s) => s.role === 'sharer') && !pendingInvites.current.size && stopShared(), 0)
  })
  useRealtime('assist.error', (d: { message: string }) => toast(d.message, 'error'))
  useRealtime('assist.agent', (d: AgentInfo) => setAgent(d))
  useRealtime('assist.started', (d: { session: string; role: 'viewer' | 'sharer'; peer: Person; mode: Mode }) => {
    pendingInvites.current.delete(d.session)
    setIncoming((l) => l.filter((i) => i.id !== d.session))
    setSessions((l) => [...l, { id: d.session, role: d.role, peer: d.peer, mode: d.mode, control: 'none', controller: '', stream: null, state: 'connecting' }])
    void connect(d.session, d.role)
    if (d.role === 'viewer' && d.mode === 'control') {
      send({ type: 'assist.control', session: d.session, action: 'request' })
      setSessions((l) => l.map((s) => (s.id === d.session ? { ...s, control: 'asked' } : s)))
    }
  })
  useRealtime('assist.signal', async (d: { session: string; payload: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
    const pc = pcs.current.get(d.session)
    try {
      if (d.payload.sdp) {
        if (!pc) return
        await pc.setRemoteDescription(d.payload.sdp)
        for (const c of queued.current.get(d.session) ?? []) await pc.addIceCandidate(c)
        queued.current.delete(d.session)
        if (d.payload.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer())
          send({ type: 'assist.signal', session: d.session, payload: { sdp: pc.localDescription?.toJSON() } })
        }
      } else if (d.payload.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(d.payload.candidate)
        else queued.current.set(d.session, [...(queued.current.get(d.session) ?? []), d.payload.candidate])
      }
    } catch {
      // un candidato tardío o repetido: no importa
    }
  })
  useRealtime('assist.control', (d: { session: string; action: string; controller?: string; reason?: string }) => {
    const s = sessionsRef.current.find((x) => x.id === d.session)
    if (d.action === 'request') {
      if (s) setIncoming((l) => [...l, { id: d.session, kind: 'control', from: s.peer, mode: 'control' }])
    } else if (d.action === 'granted') {
      patch(d.session, { control: 'granted', controller: d.controller ?? s?.peer.name ?? '' })
      if (s?.role === 'viewer') toast('Ya puedes controlar su equipo. Haz clic en la pantalla para empezar.', 'success')
    } else if (d.action === 'denied') {
      patch(d.session, { control: 'none' })
      toast(`${s?.peer.name ?? 'La otra persona'} no permitió el control`, 'warning')
    } else if (d.action === 'revoked') {
      patch(d.session, { control: 'none', controller: '' })
      toast(d.reason ?? 'Se terminó el control', 'info')
    }
  })
  useRealtime('assist.ended', (d: { session: string; reason: string }) => {
    setIncoming((l) => l.filter((i) => i.id !== d.session))
    pendingInvites.current.delete(d.session)
    if (sessionsRef.current.some((s) => s.id === d.session)) toast(d.reason || 'La asistencia terminó', 'info')
    drop(d.session)
  })

  // sin conexión en vivo no hay asistencia (el servidor ya las cerró)
  useEffect(() => rt.onStatus((s) => {
    if (s !== 'open') {
      sessionsRef.current.forEach((x) => drop(x.id))
      setIncoming([])
      stopShared()
    }
  }), [drop, stopShared])

  useEffect(() => {
    api<AgentInfo>('/assist/agent').then(setAgent).catch(() => undefined)
    return () => {
      sessionsRef.current.forEach((x) => send({ type: 'assist.end', session: x.id }))
      pcs.current.forEach((pc) => pc.close())
      pcs.current.clear()
      stopShared()
    }
  }, [stopShared])

  const value = useMemo<Api>(() => ({
    sessions,
    incoming,
    agent,
    ask: (to, mode) => send({ type: 'assist.request', to: to.id, mode }),
    share: async (to) => {
      const s = await grabScreen(false)
      if (!s) return
      inviting.current = true // la confirmación (`assist.pending`) trae el id de la invitación
      send({ type: 'assist.invite', to: to.id })
    },
    accept: async (i) => {
      if (i.kind === 'invite') {
        send({ type: 'assist.respond', session: i.id, accept: true })
      } else if (i.kind === 'request') {
        const s = await grabScreen(i.mode === 'control')
        if (!s) {
          send({ type: 'assist.respond', session: i.id, accept: false })
          setIncoming((l) => l.filter((x) => x.id !== i.id))
          return
        }
        send({ type: 'assist.respond', session: i.id, accept: true })
      } else {
        const s = await grabScreen(true)
        send({ type: 'assist.control', session: i.id, action: s ? 'grant' : 'deny' })
      }
      setIncoming((l) => l.filter((x) => x.id !== i.id))
    },
    decline: (i) => {
      if (i.kind === 'control') send({ type: 'assist.control', session: i.id, action: 'deny' })
      else send({ type: 'assist.respond', session: i.id, accept: false })
      setIncoming((l) => l.filter((x) => x.id !== i.id))
    },
    end: (id) => send({ type: 'assist.end', session: id }),
    requestControl: (id) => {
      send({ type: 'assist.control', session: id, action: 'request' })
      patch(id, { control: 'asked' })
    },
    revokeControl: (id) => send({ type: 'assist.control', session: id, action: 'revoke' }),
    input: (id, e) => send({ type: 'assist.input', session: id, e }),
  }), [sessions, incoming, agent, grabScreen, patch])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

import { api } from '../api'

export interface Part {
  /** Identifica la pestaña dentro de la llamada (una misma persona puede estar con la laptop y, de complemento, con el celular). */
  conn: string
  userId: string
  name: string
  host: boolean
  companion: boolean
  mic: boolean
  cam: boolean
  cc: boolean
  /** Id del flujo de pantalla que está presentando, si presenta. */
  screen: string | null
  /** Momento en que levantó la mano (sirve para ordenar la lista). */
  hand: number | null
}

export interface Waiting { conn: string; userId: string; name: string }

export interface CallState {
  code: string
  title: string
  access: 'HOST' | 'OPEN'
  conversationId: string | null
  startedAt: number
  max: number
  parts: Part[]
  lobby: Waiting[]
  /** Personas invitadas que aún no están dentro (las de la cita del calendario o, si no hay cita, las de la sala). */
  invited: { userId: string; name: string }[]
  invitedKind: 'event' | 'room'
}

export interface CallInfo {
  code: string
  title: string
  access: 'HOST' | 'OPEN'
  hostId: string
  hostName: string
  roomCode: string | null
  roomName: string | null
  conversationId: string | null
  createdAt: string
  endedAt: string | null
  people: string[]
  count: number
  max: number
  /** Llamada programada desde un evento del calendario. */
  scheduledAt: string | null
  scheduledEnd: string | null
}

export const callApi = {
  info: (code: string) => api<CallInfo>(`/calls/${encodeURIComponent(code)}`),
  list: (room: string) => api<{ active: CallInfo[]; recent: CallInfo[]; max: number }>(`/rooms/${encodeURIComponent(room)}/calls`),
  create: (room: string, body: { title: string; access: 'HOST' | 'OPEN' }) => api<CallInfo>(`/rooms/${encodeURIComponent(room)}/calls`, 'POST', body),
  end: (code: string) => api<CallInfo>(`/calls/${encodeURIComponent(code)}/end`, 'POST'),
  chat: (code: string) => api<{ conversationId: string }>(`/calls/${encodeURIComponent(code)}/chat`, 'POST'),
  ice: () => api<{ iceServers: RTCIceServer[] }>('/assist/ice'),
}

export const REACTIONS = ['👍', '👏', '❤️', '🎉', '😂', '😮', '😢', '🤔', '🔥', '🙏']

export const callUrl = (code: string) => `${window.location.origin}/call/${code}`

/** Lo que el usuario escribe (con o sin guiones, en mayúsculas…) → abc-defg-hij. */
export function normalizeCode(raw: string): string {
  const letters = raw.toLowerCase().replace(/^.*\/call\//, '').replace(/[^a-z]/g, '')
  return letters.length === 10 ? `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}` : raw.trim().toLowerCase()
}

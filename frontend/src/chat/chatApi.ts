import { api } from '../api'

export type ConvKind = 'ROOM' | 'GROUP' | 'DM'
export type Policy = 'ALL' | 'ADMINS'

export interface ChatMember { userId: string; role: 'ADMIN' | 'MEMBER' }
export interface LastMessage { id: string; authorId: string | null; authorName: string; kind: 'TEXT' | 'SYSTEM'; text: string; createdAt: string }

export interface Conv {
  id: string
  kind: ConvKind
  name: string | null
  description: string
  color: string | null
  createdBy: string | null
  postPolicy: Policy
  addPolicy: Policy
  createdAt: string
  lastMessageAt: string
  last: LastMessage | null
  members: ChatMember[]
  role: 'ADMIN' | 'MEMBER'
  muted: boolean
  pinned: boolean
  unread: number
  lastReadAt: string | null
  otherUserId: string | null
}

export interface Message {
  id: string
  conv: string
  authorId: string | null
  authorName: string
  kind: 'TEXT' | 'SYSTEM'
  text: string
  replyTo: string | null
  reactions: Record<string, string[]>
  edited: boolean
  createdAt: string
  updatedAt: string
}

export const GROUP_COLORS = ['#7c6af7', '#4cc38a', '#e7b35e', '#ee8fae', '#5cc4b4', '#f09d72', '#74a9f5', '#f2837b']

export const base = (code: string) => `/rooms/${encodeURIComponent(code)}/chat`

export const chatApi = {
  list: (code: string) => api<Conv[]>(`${base(code)}/conversations`),
  messages: (code: string, conv: string, before?: string, limit = 50) =>
    api<Message[]>(`${base(code)}/conversations/${conv}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  send: (code: string, conv: string, text: string, replyTo?: string) => api<Message>(`${base(code)}/conversations/${conv}/messages`, 'POST', { text, replyTo }),
  edit: (code: string, conv: string, id: string, text: string) => api<Message>(`${base(code)}/conversations/${conv}/messages/${id}`, 'PATCH', { text }),
  remove: (code: string, conv: string, id: string) => api(`${base(code)}/conversations/${conv}/messages/${id}`, 'DELETE'),
  react: (code: string, conv: string, id: string, emoji: string) => api<Message>(`${base(code)}/conversations/${conv}/messages/${id}/react`, 'POST', { emoji }),
  read: (code: string, conv: string) => api(`${base(code)}/conversations/${conv}/read`, 'POST'),
  dm: (code: string, userId: string) => api<Conv>(`${base(code)}/dm`, 'POST', { userId }),
  createGroup: (code: string, body: { name: string; description?: string; color?: string; members: string[] }) => api<Conv>(`${base(code)}/conversations`, 'POST', body),
  updateGroup: (code: string, conv: string, body: Partial<Pick<Conv, 'name' | 'description' | 'color' | 'postPolicy' | 'addPolicy'>>) => api<Conv>(`${base(code)}/conversations/${conv}`, 'PATCH', body),
  deleteGroup: (code: string, conv: string) => api(`${base(code)}/conversations/${conv}`, 'DELETE'),
  addMembers: (code: string, conv: string, userIds: string[]) => api<ChatMember[]>(`${base(code)}/conversations/${conv}/members`, 'POST', { userIds }),
  removeMember: (code: string, conv: string, userId: string) => api(`${base(code)}/conversations/${conv}/members/${userId}`, 'DELETE'),
  setRole: (code: string, conv: string, userId: string, role: 'ADMIN' | 'MEMBER') => api<ChatMember[]>(`${base(code)}/conversations/${conv}/members/${userId}`, 'PATCH', { role }),
  prefs: (code: string, conv: string, body: { muted?: boolean; pinned?: boolean }) => api<Conv>(`${base(code)}/conversations/${conv}/me`, 'PATCH', body),
}

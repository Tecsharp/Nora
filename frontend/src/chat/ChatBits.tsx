import { useMemo, useState } from 'react'
import { Hash, Search, Users } from 'lucide-react'
import type { Participant } from '../api'
import Avatar from '../components/Avatar'
import type { Conv } from './chatApi'
import { useChat } from './ChatProvider'

/** Avatar de una conversación: la persona en los directos, un círculo de color con la inicial en los grupos y # en la general. */
export function ConvAvatar({ conv, size = 40 }: { conv: Conv; size?: number }) {
  const { room, online } = useChat()
  if (conv.kind === 'DM') {
    const p = room.participants.find((x) => x.userId === conv.otherUserId)
    return <Avatar name={p?.displayName ?? '?'} userId={p?.userId} version={p?.avatarVersion} online={!!p && online.has(p.userId)} size={size} />
  }
  const color = conv.kind === 'ROOM' ? 'var(--accent)' : conv.color ?? 'var(--accent)'
  return (
    <span className="conv-av" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.42, background: color }}>
      {conv.kind === 'ROOM' ? <Hash size={size * 0.5} /> : (conv.name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Subtítulo bajo el nombre: quién escribe, cuántas personas hay o si la otra persona está conectada. */
export function useConvSubtitle(conv: Conv): string {
  const { room, online, typing } = useChat()
  const t = typing(conv.id)
  if (t.length) return t.length === 1 ? `${t[0]} está escribiendo…` : `${t.slice(0, 2).join(' y ')} están escribiendo…`
  if (conv.kind === 'DM') return conv.otherUserId && online.has(conv.otherUserId) ? 'Conectado' : 'Desconectado'
  if (conv.kind === 'GROUP') return `${conv.members.length} ${conv.members.length === 1 ? 'persona' : 'personas'}`
  const on = room.participants.filter((p) => online.has(p.userId)).length
  return `${room.participants.length} en la sala · ${on} ${on === 1 ? 'conectada' : 'conectadas'}`
}

export function relTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 6) return d.toLocaleDateString('es', { weekday: 'short' })
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

/** Lista de personas de la sala con buscador y selección (varias o una). */
export function PersonPicker({ people, selected, onToggle, single, empty = 'No hay a quién elegir' }: {
  people: Participant[]
  selected: Set<string>
  onToggle: (id: string) => void
  single?: boolean
  empty?: string
}) {
  const { online } = useChat()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return people.filter((p) => !s || p.displayName.toLowerCase().includes(s)).sort((a, b) => Number(online.has(b.userId)) - Number(online.has(a.userId)) || a.displayName.localeCompare(b.displayName))
  }, [people, q, online])
  return (
    <div className="pp">
      <label className="kb-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…" aria-label="Buscar persona" /></label>
      <ul className="pp-list">
        {shown.map((p) => (
          <li key={p.userId}>
            <button type="button" className={`pp-row ${selected.has(p.userId) ? 'on' : ''}`} onClick={() => onToggle(p.userId)} aria-pressed={selected.has(p.userId)}>
              <Avatar name={p.displayName} userId={p.userId} version={p.avatarVersion} online={online.has(p.userId)} size={32} />
              <span className="truncate">{p.displayName}</span>
              <span className={single ? 'pp-radio' : 'pp-check'} aria-hidden="true" />
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small pp-empty"><Users size={16} /> {empty}</li>}
      </ul>
    </div>
  )
}

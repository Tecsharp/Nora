import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Room } from '../api'
import { useRealtime } from '../realtime'
import Avatar from '../components/Avatar'

export interface Busy { start: string; end: string; allDay: boolean; eventId: string | null; title: string | null }
export interface PersonAvail { userId: string; displayName: string; avatarVersion: number; busy: Busy[] }

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16))
export const isoAt = (day: string, m: number) => `${day}T${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

/** Los huecos ocupados de las personas de la sala entre dos fechas (sin detalles de lo que hacen), al día con los cambios en vivo. */
export function useAvailability(code: string, from: string, to: string) {
  const [users, setUsers] = useState<PersonAvail[]>([])
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = useCallback(() => {
    api<{ users: PersonAvail[] }>(`/rooms/${encodeURIComponent(code)}/availability?from=${from}&to=${to}`)
      .then((r) => setUsers(r.users)).catch(() => {}).finally(() => setLoading(false))
  }, [code, from, to])
  useEffect(() => { setLoading(true); load() }, [load])
  const soon = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, 300) }, [load])
  useRealtime('availability.changed', soon)
  useRealtime('reconnected', load)
  return { users, loading }
}

/** Tramos ocupados (en minutos) de una persona en un día concreto. */
export function busyOn(p: PersonAvail, day: string): { from: number; to: number; b: Busy }[] {
  const out: { from: number; to: number; b: Busy }[] = []
  for (const b of p.busy) {
    const sd = b.start.slice(0, 10), ed = b.end.slice(0, 10)
    if (sd > day || ed < day) continue
    const from = b.allDay || sd < day ? 0 : mins(b.start)
    const to = b.allDay || ed > day ? 1440 : Math.max(mins(b.end), from + 15)
    out.push({ from, to, b })
  }
  return out
}

/** Primeros huecos en que todas las personas elegidas están libres (días laborables, de 8:00 a 19:00, cada 30 minutos). */
export function findSlots(users: PersonAvail[], ids: string[], firstDay: string, days: number, dur: number, max = 5): { day: string; start: number; end: number }[] {
  const chosen = users.filter((u) => ids.includes(u.userId))
  const out: { day: string; start: number; end: number }[] = []
  const now = new Date()
  for (let i = 0; i < days && out.length < max; i++) {
    const d = addDays(new Date(`${firstDay}T00:00:00`), i)
    const wd = d.getDay()
    if (wd === 0 || wd === 6) continue
    const day = ymd(d)
    const busy = chosen.flatMap((u) => busyOn(u, day))
    const minStart = day === ymd(now) ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30 : 0
    for (let m = Math.max(8 * 60, minStart); m + dur <= 19 * 60 && out.length < max; m += 30) {
      if (!busy.some((b) => b.from < m + dur && b.to > m)) { out.push({ day, start: m, end: m + dur }); m += dur - 30 }
    }
  }
  return out
}

interface GridProps {
  users: PersonAvail[]
  ids: string[]
  meId?: string
  day: string
  /** Franja propuesta (la del evento que se está creando). */
  proposal?: { start: string; end: string } | null
  from?: number
  to?: number
  /** Presionar un espacio vacío propone una reunión a esa hora. */
  onPick?: (day: string, minute: number) => void
  onOpenEvent?: (id: string) => void
}

/** Cuadrícula de disponibilidad: una fila por persona y las horas del día; en gris lo que tiene ocupado. */
export function AvailabilityGrid({ users, ids, meId, day, proposal, from = 7 * 60, to = 21 * 60, onPick, onOpenEvent }: GridProps) {
  const rows = users.filter((u) => ids.includes(u.userId)).sort((a, b) => (a.userId === meId ? -1 : b.userId === meId ? 1 : a.displayName.localeCompare(b.displayName)))
  const span = to - from
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => from / 60 + i)
  const pct = (m: number) => `${Math.max(0, Math.min(100, ((m - from) / span) * 100))}%`
  const prop = proposal && proposal.start.slice(0, 10) === day ? { a: mins(proposal.start), b: proposal.end.slice(0, 10) === day ? mins(proposal.end) : 1440 } : null
  return (
    <div className="av" role="table" aria-label="Disponibilidad">
      <div className="av-head" role="row">
        <span className="av-who" />
        <div className="av-track">{hours.map((h) => <span key={h} style={{ left: pct(h * 60) }}>{pad(h)}</span>)}</div>
      </div>
      {rows.map((u) => {
        const busy = busyOn(u, day)
        const clash = prop ? busy.some((x) => x.from < prop.b && x.to > prop.a) : false
        return (
          <div key={u.userId} className={`av-row ${clash ? 'clash' : ''}`} role="row">
            <span className="av-who" title={u.displayName}><Avatar name={u.displayName} userId={u.userId} version={u.avatarVersion} size={22} /><b>{u.userId === meId ? 'Tú' : u.displayName.split(' ')[0]}</b></span>
            <div className={`av-track ${onPick ? 'pick' : ''}`}
              onClick={(e) => {
                if (!onPick || (e.target as HTMLElement).closest('.av-busy')) return
                const r = e.currentTarget.getBoundingClientRect()
                onPick(day, Math.max(from, Math.min(to - 30, Math.round((from + ((e.clientX - r.left) / r.width) * span) / 30) * 30)))
              }}>
              {hours.map((h) => <i key={h} className="av-line" style={{ left: pct(h * 60) }} />)}
              {prop && <div className="av-prop" style={{ left: pct(prop.a), width: `calc(${pct(prop.b)} - ${pct(prop.a)})` }} />}
              {busy.map((x, i) => (
                <button key={i} type="button" className={`av-busy ${x.b.allDay ? 'all' : ''} ${x.b.title ? 'known' : ''}`} style={{ left: pct(x.from), width: `calc(${pct(x.to)} - ${pct(x.from)})` }}
                  title={x.b.title ? `${x.b.title} · ${x.b.start.slice(11)}–${x.b.end.slice(11)}` : 'Ocupado'} onClick={(e) => { e.stopPropagation(); if (x.b.eventId && onOpenEvent) onOpenEvent(x.b.eventId) }}>
                  <span>{x.b.title ?? 'Ocupado'}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const roomPeople = (room: Room) => room.participants.map((p) => p.userId)

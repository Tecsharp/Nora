import { useFocusTarget, type FocusTarget } from './focus'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Download, HelpCircle, ListTodo, MapPin, Pencil, Plus, Sparkles, Trash2, Users, X } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { aiNow, useAi } from '../ai/AiProvider'
import { useItems, type Item } from './useItems'

type Rsvp = 'yes' | 'no' | 'maybe'
interface EventData {
  title: string
  description: string
  location: string
  allDay: boolean
  start: string // AAAA-MM-DDThh:mm (hora local de quien mira)
  end: string
  color: string | null
  rsvp?: Record<string, Rsvp>
}
type Ev = Item<EventData>

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const COLORS = ['#7c6af7', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => new Date(`${s}:00`)
const day = (s: string) => s.slice(0, 10)
const hhmm = (s: string) => s.slice(11, 16)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))
const nice = (d: Date) => d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
const when = (e: EventData) => {
  const s = parse(e.start)
  const same = day(e.start) === day(e.end)
  if (e.allDay) return same ? `${nice(s)} · Todo el día` : `${nice(s)} → ${nice(parse(e.end))}`
  return same ? `${nice(s)} · ${hhmm(e.start)}–${hhmm(e.end)}` : `${nice(s)} ${hhmm(e.start)} → ${nice(parse(e.end))} ${hhmm(e.end)}`
}
const dayLabel = (s: string) => {
  const t = ymd(new Date())
  if (s === t) return 'Hoy'
  if (s === ymd(addDays(new Date(), 1))) return 'Mañana'
  return nice(new Date(`${s}T00:00:00`))
}
const spans = (e: EventData): string[] => {
  const out: string[] = []
  for (let d = new Date(`${day(e.start)}T00:00:00`), i = 0; ymd(d) <= day(e.end) && i < 62; d = addDays(d, 1), i++) out.push(ymd(d))
  return out
}

const ics = (list: Ev[], name: string) => {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
  const stamp = (s: string) => s.replace(/[-:]/g, '').slice(0, 15)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nora//Calendario//ES', `X-WR-CALNAME:${esc(name)}`]
  for (const ev of list) {
    const d = ev.data
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@nora`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`)
    if (d.allDay) lines.push(`DTSTART;VALUE=DATE:${day(d.start).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${ymd(addDays(new Date(`${day(d.end)}T00:00:00`), 1)).replace(/-/g, '')}`)
    else lines.push(`DTSTART:${stamp(d.start)}00`, `DTEND:${stamp(d.end)}00`)
    lines.push(`SUMMARY:${esc(d.title)}`)
    if (d.description) lines.push(`DESCRIPTION:${esc(d.description)}`)
    if (d.location) lines.push(`LOCATION:${esc(d.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
const download = (name: string, text: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function CalendarTool({ room, focus }: { room: Room; focus?: FocusTarget | null }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const ai = useAi()
  const { items, loading, error, create, update, remove, act } = useItems<EventData>(room.code, 'event')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }) // cualquier día del periodo que se mira
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>(() => { try { return (localStorage.getItem('nora-cal-view') as 'month' | 'week' | 'day' | 'agenda') || 'week' } catch { return 'week' } })
  const changeView = (v: 'month' | 'week' | 'day' | 'agenda') => { setView(v); try { localStorage.setItem('nora-cal-view', v) } catch { /* sin almacenamiento */ } }
  const [openState, setOpen] = useState<{ id?: string; draft?: Partial<EventData>; edit: boolean } | null>(null)
  // el evento abierto se lee siempre de la lista en vivo: así las respuestas que llegan se ven al instante
  const open = openState ? { ...openState, ev: openState.id ? items.find((x) => x.id === openState.id) : undefined } : null
  const [aiOpen, setAiOpen] = useState(false)
  // desde una notificación: se va al día del evento y se abre su ficha
  useFocusTarget(focus, !loading, (f) => {
    const ev = items.find((x) => x.id === f.item)
    if (!ev) return
    const [y, m, d] = ev.data.start.slice(0, 10).split('-').map(Number)
    setCursor(new Date(y!, m! - 1, d!))
    setOpen({ id: ev.id, edit: false })
  })
  useEffect(() => { if (openState?.id && !open?.ev && !loading) setOpen(null) }) // lo borraron mientras estaba abierto
  const people = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])
  const todayKey = ymd(new Date())

  const cells = useMemo(() => {
    const first = monday(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
    return Array.from({ length: 42 }, (_, i) => addDays(first, i))
  }, [cursor.getFullYear(), cursor.getMonth()]) // eslint-disable-line react-hooks/exhaustive-deps
  const weekDays = useMemo(() => { const m = monday(cursor); return Array.from({ length: 7 }, (_, i) => addDays(m, i)) }, [cursor])
  const shiftBy = (dir: number) => setCursor((c) => view === 'month' || view === 'agenda' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, (view === 'week' ? 7 : 1) * dir))
  const title = view === 'week'
    ? (() => { const a = weekDays[0]!; const z = weekDays[6]!; return a.getMonth() === z.getMonth() ? `${a.getDate()} – ${z.getDate()} de ${MONTHS[z.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} – ${z.getDate()} ${MONTHS[z.getMonth()].slice(0, 3)}` })()
    : view === 'day' ? `${cursor.getDate()} de ${MONTHS[cursor.getMonth()]}` : MONTHS[cursor.getMonth()]
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>()
    for (const e of items) for (const k of spans(e.data)) m.set(k, [...(m.get(k) ?? []), e])
    for (const [, l] of m) l.sort((a, b) => Number(b.data.allDay) - Number(a.data.allDay) || a.data.start.localeCompare(b.data.start))
    return m
  }, [items])
  const agenda = useMemo(() => {
    const out = new Map<string, Ev[]>()
    for (const [k, l] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) if (k >= todayKey) out.set(k, l)
    return [...out.entries()].slice(0, 60)
  }, [byDay, todayKey])
  const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, 'error')

  const newOn = (k: string) => setOpen({ edit: true, draft: { title: '', description: '', location: '', allDay: false, start: `${k}T09:00`, end: `${k}T10:00`, color: COLORS[0]! } })

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="row">
          <button className="icon-btn" aria-label="Anterior" onClick={() => shiftBy(-1)}><ChevronLeft size={18} /></button>
          <h3 className="cal-title">{title} <span>{cursor.getFullYear()}</span></h3>
          <button className="icon-btn" aria-label="Siguiente" onClick={() => shiftBy(1)}><ChevronRight size={18} /></button>
          <button className="btn sm" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setCursor(d) }}>Hoy</button>
        </div>
        <span className="spacer" />
        <div className="seg" role="tablist" aria-label="Vista">
          <button role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'on' : ''} onClick={() => changeView('day')}>Día</button>
          <button role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'on' : ''} onClick={() => changeView('week')}>Semana</button>
          <button role="tab" aria-selected={view === 'month'} className={view === 'month' ? 'on' : ''} onClick={() => changeView('month')}><CalendarDays size={13} /> Mes</button>
          <button role="tab" aria-selected={view === 'agenda'} className={view === 'agenda' ? 'on' : ''} onClick={() => changeView('agenda')}><ListTodo size={13} /> Agenda</button>
        </div>
        <button className="btn sm ghost" disabled={!items.length} title="Descargar todos los eventos (.ics) para tu calendario" onClick={() => download(`${room.name}.ics`, ics(items, room.name))}><Download size={14} /> .ics</button>
        {canWrite && ai.enabled && <button className="btn ai sm" onClick={() => setAiOpen(true)}><Sparkles size={14} /> Crear desde texto</button>}
        {canWrite && <button className="btn primary sm" onClick={() => newOn(todayKey)}><Plus size={15} /> Nuevo evento</button>}
      </div>
      {error && <p className="error small center-text">{error}</p>}

      {view === 'week' || view === 'day' ? (
        <TimeGrid days={view === 'week' ? weekDays : [cursor]} byDay={byDay} todayKey={todayKey} canWrite={canWrite}
          onOpen={(e) => setOpen({ id: e.id, edit: false })}
          onCreate={(start, end, allDay) => setOpen({ edit: true, draft: { title: '', description: '', location: '', allDay, start, end, color: COLORS[0]! } })} />
      ) : view === 'month' ? (
        <div className="cal-month">
          <div className="cal-week head">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="cal-grid">
            {cells.map((d) => {
              const k = ymd(d)
              const evs = byDay.get(k) ?? []
              return (
                <div key={k} className={`cal-cell ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${k === todayKey ? 'today' : ''}`} onClick={() => canWrite && newOn(k)}>
                  <span className="cal-num">{d.getDate()}</span>
                  {evs.slice(0, 3).map((e) => (
                    <button key={e.id} className={`cal-chip ${e.data.allDay ? 'allday' : ''}`} style={{ ['--c' as string]: e.data.color ?? COLORS[0] }} onClick={(ev) => { ev.stopPropagation(); setOpen({ id: e.id, edit: false }) }} title={`${e.data.title} · ${when(e.data)}`}>
                      {!e.data.allDay && day(e.data.start) === k && <b>{hhmm(e.data.start)}</b>} <span>{e.data.title}</span>
                    </button>
                  ))}
                  {evs.length > 3 && <button className="cal-more" onClick={(ev) => { ev.stopPropagation(); setCursor(d); changeView('day') }}>+{evs.length - 3} más</button>}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="cal-agenda">
          {!agenda.length && !loading && (
            <div className="cal-empty"><CalendarDays size={32} /><strong>No hay eventos próximos</strong>
              <span className="small">{canWrite ? 'Crea una reunión, una entrega o un recordatorio para que todo el equipo lo vea.' : 'Cuando alguien cree un evento aparecerá aquí.'}</span>
              {canWrite && <button className="btn primary" onClick={() => newOn(todayKey)}><CalendarPlus size={15} /> Nuevo evento</button>}</div>
          )}
          {agenda.map(([k, evs]) => (
            <section key={k} className="cal-day">
              <h4 className={k === todayKey ? 'today' : ''}>{dayLabel(k)}<small>{k}</small></h4>
              {evs.map((e) => {
                const mine = e.data.rsvp?.[user?.id ?? '']
                return (
                  <article key={e.id} className="cal-item" style={{ ['--c' as string]: e.data.color ?? COLORS[0] }} onClick={() => setOpen({ id: e.id, edit: false })}>
                    <span className="cal-time">{e.data.allDay ? 'Todo el día' : `${hhmm(e.data.start)}`}<small>{e.data.allDay ? '' : hhmm(e.data.end)}</small></span>
                    <div className="cal-item-main"><strong>{e.data.title}</strong>
                      {e.data.location && <span className="muted small"><MapPin size={12} /> {e.data.location}</span>}</div>
                    <span className="cal-going"><Users size={13} /> {Object.values(e.data.rsvp ?? {}).filter((v) => v === 'yes').length}</span>
                    <span className={`cal-rsvp ${mine ?? ''}`}>{mine === 'yes' ? 'Voy' : mine === 'maybe' ? 'Quizás' : mine === 'no' ? 'No voy' : 'Sin responder'}</span>
                  </article>
                )
              })}
            </section>
          ))}
        </div>
      )}

      {open && <EventDialog key={open.ev?.id ?? 'new'} ev={open.ev} draft={open.draft} startEditing={open.edit} room={room} people={people} meId={user?.id}
        canEdit={canWrite && (!open.ev || open.ev.authorId === user?.id || staff)} onClose={() => setOpen(null)}
        onSave={async (d) => { if (open.ev) await update(open.ev.id, { ...open.ev.data, ...d }); else await create(d) }}
        onRsvp={(s) => open.ev && act(open.ev.id, 'rsvp', { status: s }).catch((e) => fail(e, 'No se pudo responder'))}
        onDelete={async () => {
          if (!open.ev) return
          if (!(await dialogs.confirm({ title: '¿Borrar el evento?', message: <>«{open.ev.data.title}» desaparecerá del calendario de todas las personas.</>, confirmLabel: 'Borrar', tone: 'danger', icon: 'trash' }))) return
          try { await remove(open.ev.id); setOpen(null) } catch (e) { fail(e, 'No se pudo borrar') }
        }} />}
      {aiOpen && <AiEventDialog onClose={() => setAiOpen(false)} onPick={(d) => { setAiOpen(false); setOpen({ edit: true, draft: d }) }} />}
    </div>
  )
}

const HOUR = 52 // px por hora en la cuadrícula
const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16))
const iso = (k: string, m: number) => `${k}T${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

interface Seg { ev: Ev; from: number; to: number; lane: number; lanes: number }

/** Reparte en columnas los eventos de un día que se pisan (como hace Google Calendar). */
function layout(evs: Ev[], k: string): Seg[] {
  const segs = evs.filter((e) => !e.data.allDay).map((e) => {
    const from = day(e.data.start) === k ? mins(e.data.start) : 0
    let to = day(e.data.end) === k ? mins(e.data.end) : 1440
    if (to - from < 30) to = Math.min(1440, from + 30)
    return { ev: e, from, to, lane: 0, lanes: 1 }
  }).sort((a, b) => a.from - b.from || b.to - a.to)
  let cluster: Seg[] = []
  let clusterEnd = 0
  const flush = () => { const n = Math.max(1, ...cluster.map((c) => c.lane + 1)); cluster.forEach((c) => { c.lanes = n }); cluster = [] }
  for (const sg of segs) {
    if (cluster.length && sg.from >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.to > sg.from).map((c) => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    sg.lane = lane
    cluster.push(sg)
    clusterEnd = Math.max(clusterEnd, sg.to)
  }
  flush()
  return segs
}

function TimeGrid({ days, byDay, todayKey, canWrite, onOpen, onCreate }: {
  days: Date[]; byDay: Map<string, Ev[]>; todayKey: string; canWrite: boolean; onOpen: (e: Ev) => void; onCreate: (start: string, end: string, allDay: boolean) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  const [drag, setDrag] = useState<{ k: string; a: number; b: number } | null>(null)
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  // al abrir, la cuadrícula se coloca un poco antes de la hora actual (o a las 7:00 si es de madrugada)
  useEffect(() => {
    const m = days.some((d) => ymd(d) === todayKey) ? now.getHours() * 60 : 7 * 60
    scroller.current?.scrollTo({ top: Math.max(0, ((m - 60) / 60) * HOUR) })
  }, [days.length, days[0]?.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const minuteAt = (e: { clientY: number }, col: HTMLElement, snap = 15) => {
    const r = col.getBoundingClientRect()
    return Math.max(0, Math.min(1440, Math.round(((e.clientY - r.top) / HOUR) * 60 / snap) * snap))
  }
  const allDay = days.flatMap((d) => (byDay.get(ymd(d)) ?? []).filter((e) => e.data.allDay))
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR

  return (
    <div className="tg" style={{ ['--cols' as string]: days.length }}>
      <div className="tg-scroll" ref={scroller}>
        <div className="tg-sticky">
      <div className="tg-head">
          <span className="tg-gutter" />
          {days.map((d) => (
            <div key={ymd(d)} className={`tg-dayhead ${ymd(d) === todayKey ? 'today' : ''}`}><small>{WEEKDAYS[(d.getDay() + 6) % 7]}</small><b>{d.getDate()}</b></div>
          ))}
        </div>
        {allDay.length > 0 || canWrite ? (
          <div className="tg-allday">
            <span className="tg-gutter small muted">Todo el día</span>
            {days.map((d) => {
              const k = ymd(d)
              return (
                <div key={k} className="tg-allcell" onClick={() => canWrite && onCreate(`${k}T00:00`, `${k}T00:00`, true)}>
                  {(byDay.get(k) ?? []).filter((e) => e.data.allDay).map((e) => (
                    <button key={e.id} className="cal-chip allday" style={{ ['--c' as string]: e.data.color ?? COLORS[0] }} title={`${e.data.title} · ${when(e.data)}`} onClick={(ev) => { ev.stopPropagation(); onOpen(e) }}><span>{e.data.title}</span></button>
                  ))}
                </div>
              )
            })}
          </div>
        ) : null}
        </div>
        <div className="tg-body" style={{ height: HOUR * 24 }}>
          <div className="tg-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR }}>{h === 0 ? '' : `${pad(h)}:00`}</span>)}</div>
          {days.map((d) => {
            const k = ymd(d)
            const segs = layout(byDay.get(k) ?? [], k)
            return (
              <div key={k} className={`tg-col ${k === todayKey ? 'today' : ''}`}
                onPointerDown={(e) => {
                  if (!canWrite || e.button !== 0 || (e.target as HTMLElement).closest('.tg-ev')) return
                  const a = minuteAt(e, e.currentTarget)
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setDrag({ k, a, b: a + 30 })
                }}
                onPointerMove={(e) => { if (drag?.k === k) setDrag({ ...drag, b: Math.max(drag.a + 15, minuteAt(e, e.currentTarget)) }) }}
                onPointerUp={() => {
                  if (drag?.k === k) {
                    const dd = drag
                    setDrag(null)
                    onCreate(iso(k, dd.a), iso(k, Math.min(1439, dd.b)), false)
                  }
                }}
                onPointerCancel={() => setDrag(null)}>
                {Array.from({ length: 24 }, (_, h) => <i key={h} className="tg-line" style={{ top: h * HOUR }} />)}
                {segs.map((sg) => (
                  <button key={sg.ev.id} className="tg-ev" style={{ ['--c' as string]: sg.ev.data.color ?? COLORS[0], top: (sg.from / 60) * HOUR, height: Math.max(20, ((sg.to - sg.from) / 60) * HOUR - 2), left: `${(sg.lane / sg.lanes) * 100}%`, width: `calc(${100 / sg.lanes}% - 3px)` }}
                    title={`${sg.ev.data.title} · ${when(sg.ev.data)}`} onClick={(e) => { e.stopPropagation(); onOpen(sg.ev) }}>
                    <b>{sg.ev.data.title}</b>
                    {sg.to - sg.from >= 45 && <span>{hhmm(sg.ev.data.start)}–{hhmm(sg.ev.data.end)}</span>}
                  </button>
                ))}
                {drag?.k === k && <div className="tg-ghost" style={{ top: (drag.a / 60) * HOUR, height: ((drag.b - drag.a) / 60) * HOUR }}><span>{hhmm(iso(k, drag.a))} – {hhmm(iso(k, Math.min(1439, drag.b)))}</span></div>}
                {k === todayKey && <div className="tg-now" style={{ top: nowTop }}><i /></div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EventDialog({ ev, draft, startEditing, room, people, meId, canEdit, onClose, onSave, onRsvp, onDelete }: {
  ev?: Ev; draft?: Partial<EventData>; startEditing: boolean; room: Room; people: Map<string, Room['participants'][number]>; meId?: string; canEdit: boolean
  onClose: () => void; onSave: (d: EventData) => Promise<void>; onRsvp: (s: Rsvp | 'none') => void; onDelete: () => void
}) {
  const toast = useToast()
  const [edit, setEdit] = useState(startEditing)
  const [d, setD] = useState<EventData>({ title: '', description: '', location: '', allDay: false, start: '', end: '', color: COLORS[0]!, ...(ev?.data ?? {}), ...(draft ?? {}) })
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof EventData>(k: K, v: EventData[K]) => setD((x) => ({ ...x, [k]: v }))
  const rsvp = ev?.data.rsvp ?? {}
  const mine = rsvp[meId ?? '']
  const lists: [Rsvp, string][] = [['yes', 'Van'], ['maybe', 'Quizás'], ['no', 'No van']]
  useEffect(() => { if (!edit) setD({ title: '', description: '', location: '', allDay: false, start: '', end: '', color: COLORS[0]!, ...(ev?.data ?? {}), ...(draft ?? {}) }) }, [ev?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!d.title.trim()) return toast('El evento necesita un título', 'warning')
    if (d.end < d.start) return toast('El evento no puede terminar antes de empezar', 'warning')
    setSaving(true)
    try {
      await onSave({ ...d, title: d.title.trim(), start: d.allDay ? `${day(d.start)}T00:00` : d.start, end: d.allDay ? `${day(d.end)}T00:00` : d.end })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
      setSaving(false)
    }
  }
  const link = /https?:\/\/\S+/.exec(d.location)?.[0]

  if (edit) {
    return (
      <Modal title={ev ? 'Editar evento' : 'Nuevo evento'} icon={<CalendarPlus size={20} />} onClose={onClose}
        footer={<>{ev && <button className="btn danger" onClick={onDelete}><Trash2 size={15} /> Borrar</button>}<span className="grow" /><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={saving || !d.title.trim()} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar'}</button></>}>
        <div className="stack">
          <input autoFocus className="kb-title-input" value={d.title} maxLength={150} placeholder="Título del evento" aria-label="Título" onChange={(e) => set('title', e.target.value)} />
          <label className="check"><input type="checkbox" checked={d.allDay} onChange={(e) => set('allDay', e.target.checked)} /> Todo el día</label>
          <div className="grid-2">
            <label className="stack tight"><span className="small muted">Empieza</span>
              <input type={d.allDay ? 'date' : 'datetime-local'} value={d.allDay ? day(d.start) : d.start} onChange={(e) => { const v = e.target.value; setD((x) => ({ ...x, start: d.allDay ? `${v}T00:00` : v, end: x.end < v ? (d.allDay ? `${v}T00:00` : v) : x.end })) }} /></label>
            <label className="stack tight"><span className="small muted">Termina</span>
              <input type={d.allDay ? 'date' : 'datetime-local'} min={d.allDay ? day(d.start) : d.start} value={d.allDay ? day(d.end) : d.end} onChange={(e) => set('end', d.allDay ? `${e.target.value}T00:00` : e.target.value)} /></label>
          </div>
          <label className="stack tight"><span className="small muted">Lugar o enlace de la reunión</span><input value={d.location} maxLength={200} placeholder="Sala 2, o https://…" onChange={(e) => set('location', e.target.value)} /></label>
          <label className="stack tight"><span className="small muted">Descripción</span><textarea rows={4} value={d.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} /></label>
          <div className="stack tight"><span className="small muted">Color</span>
            <div className="cal-colors">{COLORS.map((c) => <button key={c} type="button" className={d.color === c ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => set('color', c)}>{d.color === c && <Check size={13} />}</button>)}</div></div>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="Evento" icon={<CalendarDays size={20} />} onClose={onClose}
      footer={<>{ev && <button className="btn ghost" onClick={() => download(`${d.title}.ics`, ics([ev], room.name))}><Download size={15} /> Añadir a mi calendario</button>}<span className="grow" />{canEdit && <button className="btn" onClick={() => setEdit(true)}><Pencil size={15} /> Editar</button>}<button className="btn ghost" onClick={onClose}>Cerrar</button></>}>
      <div className="cal-view" style={{ ['--c' as string]: d.color ?? COLORS[0] }}>
        <h3><i />{d.title}</h3>
        <p className="cal-when"><CalendarDays size={15} /> {when(d)}</p>
        {d.location && <p className="cal-when"><MapPin size={15} /> {link ? <a href={link} target="_blank" rel="noopener noreferrer">{d.location}</a> : d.location}</p>}
        {d.description && <p className="cal-desc">{d.description}</p>}
        <div className="cal-rsvp-box">
            <span className="small muted">¿Vas?</span>
            <div className="seg">
              {([['yes', 'Voy'], ['maybe', 'Quizás'], ['no', 'No voy']] as [Rsvp, string][]).map(([s, label]) => (
                <button key={s} className={mine === s ? 'on' : ''} onClick={() => onRsvp(mine === s ? 'none' : s)}>{s === 'yes' ? <Check size={13} /> : s === 'maybe' ? <HelpCircle size={13} /> : <X size={13} />} {label}</button>
              ))}
            </div>
        </div>
        <div className="cal-people">
          {lists.map(([s, label]) => {
            const ids = Object.entries(rsvp).filter(([, v]) => v === s).map(([u]) => u)
            if (!ids.length) return null
            return (
              <div key={s}><span className="small muted">{label} · {ids.length}</span>
                <div className="cal-avatars">{ids.map((u) => { const p = people.get(u); return <span key={u} className="cal-who" title={p?.displayName}><Avatar name={p?.displayName ?? '?'} userId={u} version={p?.avatarVersion} size={26} /><span className="small">{u === meId ? 'Tú' : p?.displayName.split(' ')[0]}</span></span> })}</div></div>
            )
          })}
          {!Object.keys(rsvp).length && <span className="muted small">Nadie ha respondido todavía.</span>}
        </div>
        {ev && <p className="muted small">Creado por {ev.authorName}</p>}
      </div>
    </Modal>
  )
}

function AiEventDialog({ onClose, onPick }: { onClose: () => void; onPick: (d: Partial<EventData>) => void }) {
  const ai = useAi()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await ai.json<Partial<EventData>>({ task: 'event_from_text', text, now: aiNow() })
      const ok = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)
      if (!r.title || !ok(r.start)) throw new Error('No se pudo entender la fecha y hora. Prueba con algo como «jueves a las 17:00 reunión con Ana».')
      onPick({ title: String(r.title).slice(0, 150), description: String(r.description ?? '').slice(0, 2000), location: String(r.location ?? '').slice(0, 200), allDay: !!r.allDay, start: r.start!, end: ok(r.end) ? r.end! : r.start!, color: COLORS[0]! })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo usar la IA', 'error')
      setBusy(false)
    }
  }
  return (
    <Modal title="Crear evento con IA" icon={<Sparkles size={20} />} onClose={onClose}
      footer={<><span className="grow" /><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn ai" disabled={busy || text.trim().length < 4} onClick={() => void run()}><Sparkles size={15} /> {busy ? 'Entendiendo…' : 'Crear evento'}</button></>}>
      <div className="stack">
        <p className="muted small">Cuéntalo con tus palabras y podrás revisar el evento antes de guardarlo.</p>
        <textarea autoFocus rows={4} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ej.: mañana a las 17:00 reunión de equipo en la sala 2, dura una hora y media" />
      </div>
    </Modal>
  )
}

/** Eventos de hoy (para la insignia de la herramienta) y aviso 10 minutos antes de los que empiezan. */
export function useCalendarWatch(code: string, meId: string | undefined) {
  const toast = useToast()
  const { items } = useItems<EventData>(code, 'event')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
  const todayKey = ymd(new Date(now))
  const today = items.filter((e) => spans(e.data).includes(todayKey) && e.data.rsvp?.[meId ?? ''] !== 'no').length
  useEffect(() => {
    for (const e of items) {
      if (e.data.allDay || e.data.rsvp?.[meId ?? ''] === 'no') continue
      const ms = parse(e.data.start).getTime() - now
      if (ms > 0 && ms <= 10 * 60_000) {
        const key = `nora-cal-notified:${e.id}:${e.data.start}`
        try {
          if (localStorage.getItem(key)) continue
          localStorage.setItem(key, '1')
        } catch { /* sin almacenamiento: se avisa igual */ }
        toast(`«${e.data.title}» empieza en ${Math.max(1, Math.round(ms / 60_000))} min${e.data.location ? ` · ${e.data.location}` : ''}`, 'info')
      }
    }
  }, [items, now, meId, toast])
  return { today }
}


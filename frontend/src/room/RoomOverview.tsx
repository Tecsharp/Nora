import { useMemo, type ReactNode } from 'react'
import { AlertCircle, CalendarDays, Check, FileText, FolderOpen, KanbanSquare, MessageSquare, SquareCheckBig } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import { useChat } from '../chat/ChatProvider'
import { remaining } from '../time'
import { useItems } from '../tools/useItems'
import { useRoomFiles } from '../tools/media'
import { TOOLS } from './tools'

interface Task { title: string; status: string; priority: string; assignee: string | null; due: string | null }
interface Ev { title: string; start: string; end: string; allDay: boolean; color: string | null }
interface Poll { question: string; closed: boolean; closesAt: number | null; mine?: string[]; total: number }

const WEEKDAY = new Intl.DateTimeFormat('es', { weekday: 'short' })
const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function whenLabel(start: string, allDay: boolean): string {
  const today = key(new Date())
  const tomorrow = key(new Date(Date.now() + 86_400_000))
  const day = start.slice(0, 10)
  const [y, m, d] = day.split('-').map(Number)
  const label = day === today ? 'Hoy' : day === tomorrow ? 'Mañana' : `${WEEKDAY.format(new Date(y!, m! - 1, d!))} ${d}/${m}`
  return allDay ? `${label} · todo el día` : `${label} · ${start.slice(11, 16)}`
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'ahora'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

function Section({ title, icon, tool, empty, children, count, onOpen }: { title: string; icon: ReactNode; tool: string; empty: string; children: ReactNode; count: number; onOpen: (tool: string) => void }) {
  return (
    <section className="ws-sec">
      <h3 className="ws-sec-title">{icon}{title}<button className="ws-link" onClick={() => onOpen(tool)}>Abrir</button></h3>
      {count === 0 ? <p className="ws-empty">{empty}</p> : <ul className="ws-rows">{children}</ul>}
    </section>
  )
}

interface Props {
  room: Room
  owner: boolean
  requests: number
  onOpen: (tool: string, item?: string, file?: string) => void
  onExtend: () => void
}

/** Pantalla de inicio de la sala: lo tuyo y lo que viene, en listas, sin ruido. Cada fila lleva al sitio exacto. */
export default function RoomOverview({ room, owner, requests, onOpen, onExtend }: Props) {
  const { user } = useAuth()
  const chat = useChat()
  const tasks = useItems<Task>(room.code, 'task')
  const events = useItems<Ev>(room.code, 'event')
  const polls = useItems<Poll>(room.code, 'poll')
  const { files } = useRoomFiles(room.code)

  const myTasks = useMemo(() => tasks.items.filter((t) => t.data.assignee === user?.id && t.data.status !== 'done')
    .sort((a, b) => (a.data.due ?? '9999').localeCompare(b.data.due ?? '9999')).slice(0, 6), [tasks.items, user?.id])
  const upcoming = useMemo(() => {
    const now = `${key(new Date())}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`
    return events.items.filter((e) => e.data.end >= now || e.data.start.slice(0, 10) >= key(new Date())).sort((a, b) => a.data.start.localeCompare(b.data.start)).slice(0, 5)
  }, [events.items])
  const openPolls = useMemo(() => polls.items.filter((p) => !p.data.closed && (!p.data.closesAt || p.data.closesAt > Date.now())).slice(0, 4), [polls.items])
  const recent = useMemo(() => [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [files])
  const unreadConvs = chat.convs.filter((c) => c.unread > 0 && !c.muted).slice(0, 5)
  const todayStr = key(new Date())

  return (
    <div className="ws-page">
      <header className="ws-page-head">
        <p>
          {remaining(room.expiresAt)}{room.settings.keepWhenExpired ? ' · se conservará al expirar' : ''}
          {owner && <button className="ws-link inline" onClick={onExtend}>Cambiar duración</button>}
        </p>
      </header>

      {owner && requests > 0 && (
        <button className="ws-alert" onClick={() => onOpen('people')}>
          <AlertCircle size={16} /> {requests === 1 ? '1 persona quiere entrar' : `${requests} personas quieren entrar`} a la sala <span>Revisar</span>
        </button>
      )}

      <div className="ws-quick" role="group" aria-label="Accesos rápidos">
        {['files', 'chat', 'actions', 'calendar', 'board'].map((id) => {
          const t = TOOLS.find((x) => x.id === id)!
          return <button key={id} className="ws-quick-btn" onClick={() => onOpen(id)}><t.icon size={15} /> {t.label}</button>
        })}
      </div>

      <div className="ws-cols">
        <div className="ws-col">
          <Section onOpen={onOpen} title="Tus tareas" icon={<KanbanSquare size={15} />} tool="actions" count={myTasks.length} empty={tasks.loading ? 'Cargando…' : 'No tienes tareas pendientes asignadas.'}>
            {myTasks.map((t) => {
              const late = !!t.data.due && t.data.due.slice(0, 10) < todayStr
              return (
                <li key={t.id}>
                  <button className="ws-row link" onClick={() => onOpen('actions', t.id)}>
                    <span className={`ws-dot p-${t.data.priority}`} aria-hidden="true" />
                    <span className="ws-row-main"><b className="truncate">{t.data.title}</b><small>{t.data.status === 'doing' ? 'En curso' : t.data.status === 'review' ? 'En revisión' : 'Por hacer'}</small></span>
                    {t.data.due && <span className={`ws-meta ${late ? 'late' : ''}`}>{late ? 'Vencida · ' : ''}{t.data.due.slice(5, 10).split('-').reverse().join('/')}</span>}
                  </button>
                </li>
              )
            })}
          </Section>

          <Section onOpen={onOpen} title="Próximos eventos" icon={<CalendarDays size={15} />} tool="calendar" count={upcoming.length} empty={events.loading ? 'Cargando…' : 'No hay eventos próximos.'}>
            {upcoming.map((e) => (
              <li key={e.id}>
                <button className="ws-row link" onClick={() => onOpen('calendar', e.id)}>
                  <span className="ws-bar-c" style={{ background: e.data.color ?? 'var(--accent)' }} aria-hidden="true" />
                  <span className="ws-row-main"><b className="truncate">{e.data.title}</b><small>{whenLabel(e.data.start, e.data.allDay)}</small></span>
                </button>
              </li>
            ))}
          </Section>

          <Section onOpen={onOpen} title="Votaciones abiertas" icon={<SquareCheckBig size={15} />} tool="polls" count={openPolls.length} empty={polls.loading ? 'Cargando…' : 'No hay votaciones abiertas.'}>
            {openPolls.map((p) => {
              const voted = (p.data.mine?.length ?? 0) > 0
              return (
                <li key={p.id}>
                  <button className="ws-row link" onClick={() => onOpen('polls', p.id)}>
                    <span className="ws-row-main"><b className="truncate">{p.data.question}</b><small>{p.data.total} {p.data.total === 1 ? 'voto' : 'votos'}</small></span>
                    <span className={`ws-meta ${voted ? '' : 'todo'}`}>{voted ? <><Check size={12} /> Votaste</> : 'Sin votar'}</span>
                  </button>
                </li>
              )
            })}
          </Section>
        </div>

        <div className="ws-col">
          <Section onOpen={onOpen} title="Sin leer" icon={<MessageSquare size={15} />} tool="chat" count={unreadConvs.length} empty="No tienes mensajes sin leer.">
            {unreadConvs.map((c) => (
              <li key={c.id}>
                <button className="ws-row link" onClick={() => chat.openFull(c.id)}>
                  <span className="ws-row-main"><b className="truncate">{chat.title(c)}</b><small className="truncate">{c.last ? `${c.last.authorName.split(' ')[0]}: ${c.last.text}` : ''}</small></span>
                  <span className="cbadge">{c.unread}</span>
                </button>
              </li>
            ))}
          </Section>

          <Section onOpen={onOpen} title="Archivos recientes" icon={<FolderOpen size={15} />} tool="files" count={recent.length} empty="Todavía no hay archivos. Arrastra algunos a Archivos para empezar.">
            {recent.map((f) => (
              <li key={f.id}>
                <button className="ws-row link" onClick={() => onOpen('files', undefined, f.id)}>
                  <FileText size={16} className="ws-ico" aria-hidden="true" />
                  <span className="ws-row-main"><b className="truncate">{f.name}</b><small>{room.participants.find((p) => p.userId === f.uploaderId)?.displayName ?? 'Alguien'} · {ago(f.createdAt)}</small></span>
                </button>
              </li>
            ))}
          </Section>
        </div>
      </div>
    </div>
  )
}

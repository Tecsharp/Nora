import { byItem, flash, useFocusTarget, type FocusTarget } from './focus'
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Check, Clock, EyeOff, Lock, LockOpen, Pencil, Plus, Sparkles, Trash2, Trophy, Users, X } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import Modal from '../components/Modal'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import AiAssist, { type AiAction } from '../ai/AiAssist'
import { useAi } from '../ai/AiProvider'
import { fmtDateTime } from '../dates'
import { useItems, type Item } from './useItems'

interface Option { id: string; text: string }
interface PollData {
  question: string
  options: Option[]
  multiple: boolean
  anonymous: boolean
  closed: boolean
  closesAt: number | null
  votes?: Record<string, string[]>
  counts: Record<string, number>
  total: number
  mine?: string[]
}
type Poll = Item<PollData>

const uid = () => Math.random().toString(36).slice(2, 10)
const DURATIONS: { label: string; ms: number | null }[] = [
  { label: 'Sin cierre automático', ms: null },
  { label: 'En 1 hora', ms: 3_600_000 },
  { label: 'En 24 horas', ms: 86_400_000 },
  { label: 'En 3 días', ms: 3 * 86_400_000 },
  { label: 'En 1 semana', ms: 7 * 86_400_000 },
]
const isClosed = (d: PollData, now: number) => d.closed || (d.closesAt != null && d.closesAt <= now)
const left = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`
}

const SUMMARY: AiAction[] = [{ id: 'sum', label: 'Resumir el resultado', task: 'poll_summary' }]

export default function PollsTool({ room, focus }: { room: Room; focus?: FocusTarget | null }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const { items, loading, error, create, update, remove, act } = useItems<PollData>(room.code, 'poll')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const [tab, setTab] = useState<'open' | 'closed' | 'all'>('open')
  const [editing, setEditing] = useState<Poll | 'new' | null>(null)
  const [now, setNow] = useState(Date.now())
  useFocusTarget(focus, !loading, (f) => { if (f.item) { setTab('all'); flash(byItem(f.item)) } })
  const [busy, setBusy] = useState<string | null>(null)
  const people = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t) }, [])

  const polls = useMemo(() => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items])
  const open = polls.filter((p) => !isClosed(p.data, now))
  const closed = polls.filter((p) => isClosed(p.data, now))
  const shown = tab === 'open' ? open : tab === 'closed' ? closed : polls

  const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, 'error')

  async function vote(p: Poll, optionId: string) {
    if (busy) return
    const mine = p.data.mine ?? []
    const next = p.data.multiple ? (mine.includes(optionId) ? mine.filter((x) => x !== optionId) : [...mine, optionId]) : (mine.includes(optionId) ? [] : [optionId])
    setBusy(p.id)
    try {
      await act(p.id, 'vote', { options: next })
    } catch (e) {
      fail(e, 'No se pudo registrar tu voto')
    } finally {
      setBusy(null)
    }
  }
  async function toggleClosed(p: Poll) {
    try {
      await update(p.id, { ...p.data, closed: !p.data.closed, closesAt: p.data.closed ? null : p.data.closesAt })
    } catch (e) {
      fail(e, 'No se pudo cambiar la votación')
    }
  }
  async function del(p: Poll) {
    if (!(await dialogs.confirm({ title: '¿Borrar la votación?', message: 'Se perderán los votos de todas las personas.', confirmLabel: 'Borrar', tone: 'danger', icon: 'trash' }))) return
    try {
      await remove(p.id)
    } catch (e) {
      fail(e, 'No se pudo borrar')
    }
  }

  return (
    <div className="polls">
      <div className="polls-bar">
        <div className="seg" role="tablist" aria-label="Filtro">
          {([['open', `Abiertas · ${open.length}`], ['closed', `Cerradas · ${closed.length}`], ['all', 'Todas']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <span className="spacer" />
        {canWrite && <button className="btn primary sm" onClick={() => setEditing('new')}><Plus size={15} /> Nueva votación</button>}
      </div>
      <div className="polls-list">
        {error && <p className="error small center-text">{error}</p>}
        {loading && <div className="poll-skel" />}
        {!loading && shown.length === 0 && (
          <div className="polls-empty">
            <BarChart3 size={32} />
            <strong>{tab === 'closed' ? 'Todavía no hay votaciones cerradas' : 'Nada que votar por ahora'}</strong>
            <span className="small">{canWrite ? 'Crea una votación para decidir algo en equipo: la gente vota y el resultado se ve en vivo.' : 'Cuando alguien cree una votación aparecerá aquí.'}</span>
            {canWrite && tab !== 'closed' && <button className="btn primary" onClick={() => setEditing('new')}><Plus size={15} /> Nueva votación</button>}
          </div>
        )}
        {shown.map((p) => {
          const d = p.data
          const closedNow = isClosed(d, now)
          const total = Object.values(d.counts).reduce((a, b) => a + b, 0)
          const top = Math.max(0, ...Object.values(d.counts))
          const byOption = new Map<string, string[]>()
          for (const [u, ids] of Object.entries(d.votes ?? {})) for (const id of ids) byOption.set(id, [...(byOption.get(id) ?? []), u])
          const mine = d.mine ?? []
          const canTouch = canWrite && (p.authorId === user?.id || staff)
          return (
            <article key={p.id} data-item-id={p.id} className={`poll ${closedNow ? 'closed' : ''}`}>
              <header>
                <div className="poll-q">
                  <h3>{d.question}</h3>
                  <div className="poll-tags">
                    <span className="poll-tag">{d.multiple ? 'Varias opciones' : 'Una opción'}</span>
                    {d.anonymous && <span className="poll-tag"><EyeOff size={11} /> Anónima</span>}
                    {closedNow
                      ? <span className="poll-tag closed"><Lock size={11} /> Cerrada</span>
                      : d.closesAt != null && <span className="poll-tag"><Clock size={11} /> Cierra en {left(d.closesAt - now)}</span>}
                  </div>
                </div>
                <span className="poll-menu">
                  <AiAssist actions={SUMMARY} iconOnly disabled={total === 0} title="Resumir el resultado con IA"
                    getText={() => `${d.question}\n${d.options.map((o) => `- ${o.text}: ${d.counts[o.id] ?? 0} votos`).join('\n')}\nParticipación: ${d.total} de ${room.participants.length} personas`} />
                  {canTouch && (
                    <Menu label="Acciones de la votación" items={[
                      { label: d.closed || closedNow ? 'Reabrir' : 'Cerrar votación', icon: d.closed || closedNow ? <LockOpen size={16} /> : <Lock size={16} />, onClick: () => void toggleClosed(p) },
                      { label: 'Editar', icon: <Pencil size={16} />, onClick: () => setEditing(p) },
                      'separator',
                      { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: () => void del(p) },
                    ]} />
                  )}
                </span>
              </header>
              <ul className="poll-options" role={d.multiple ? 'group' : 'radiogroup'} aria-label={d.question}>
                {d.options.map((o) => {
                  const n = d.counts[o.id] ?? 0
                  const pct = total ? Math.round((n / total) * 100) : 0
                  const picked = mine.includes(o.id)
                  const win = closedNow && n > 0 && n === top
                  const voters = byOption.get(o.id) ?? []
                  return (
                    <li key={o.id}>
                      <button className={`poll-opt ${picked ? 'picked' : ''} ${win ? 'win' : ''}`} disabled={closedNow || busy === p.id}
                        role={d.multiple ? 'checkbox' : 'radio'} aria-checked={picked} onClick={() => void vote(p, o.id)}>
                        <i className="poll-fill" style={{ width: `${pct}%` }} />
                        <span className="poll-mark">{picked ? <Check size={14} /> : null}</span>
                        <span className="poll-text">{o.text}{win && <Trophy size={13} className="poll-trophy" aria-label="Opción ganadora" />}</span>
                        {voters.length > 0 && (
                          <span className="poll-voters">
                            {voters.slice(0, 4).map((u) => { const pp = people.get(u); return pp ? <Avatar key={u} name={pp.displayName} userId={pp.userId} version={pp.avatarVersion} size={20} /> : null })}
                            {voters.length > 4 && <small>+{voters.length - 4}</small>}
                          </span>
                        )}
                        <span className="poll-pct"><strong>{pct}%</strong><small>{n}</small></span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <footer>
                <span><Users size={13} /> {d.total} de {room.participants.length} han votado</span>
                <span className="muted">· {p.authorName} · {fmtDateTime(p.createdAt)}</span>
                {!closedNow && mine.length > 0 && <span className="poll-mine"><Check size={13} /> Has votado (pulsa otra vez para cambiarlo)</span>}
              </footer>
            </article>
          )
        })}
      </div>
      {editing && <PollDialog poll={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={async (data) => {
        if (editing === 'new') await create(data as Partial<PollData>)
        else await update(editing.id, { ...editing.data, ...data })
      }} />}
    </div>
  )
}

function PollDialog({ poll, onClose, onSave }: { poll: Poll | null; onClose: () => void; onSave: (d: Partial<PollData>) => Promise<void> }) {
  const toast = useToast()
  const ai = useAi()
  const [question, setQuestion] = useState(poll?.data.question ?? '')
  const [options, setOptions] = useState<Option[]>(poll?.data.options ?? [{ id: uid(), text: '' }, { id: uid(), text: '' }])
  const [multiple, setMultiple] = useState(poll?.data.multiple ?? false)
  const [anonymous, setAnonymous] = useState(poll?.data.anonymous ?? false)
  const [duration, setDuration] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [thinking, setThinking] = useState(false)
  const filled = options.filter((o) => o.text.trim())
  const valid = question.trim().length > 0 && filled.length >= 2
  const hasVotes = (poll?.data.total ?? 0) > 0

  const setText = (id: string, text: string) => setOptions((l) => l.map((o) => (o.id === id ? { ...o, text } : o)))
  const suggest = async () => {
    setThinking(true)
    try {
      const r = await ai.json<{ options?: string[] }>({ task: 'poll_options', text: question })
      const list = (r.options ?? []).map((t) => String(t).slice(0, 120)).filter(Boolean).slice(0, 8)
      if (list.length) setOptions(list.map((text) => ({ id: uid(), text })))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo usar la IA', 'error')
    } finally {
      setThinking(false)
    }
  }
  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        question: question.trim(),
        options: filled.map((o) => ({ id: o.id, text: o.text.trim() })),
        multiple, anonymous,
        closed: false,
        closesAt: poll ? poll.data.closesAt : duration ? Date.now() + duration : null,
      })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
      setSaving(false)
    }
  }

  return (
    <Modal title={poll ? 'Editar votación' : 'Nueva votación'} icon={<BarChart3 size={20} />} onClose={onClose} wide
      footer={<><span className="grow" /><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!valid || saving} onClick={() => void save()}>{saving ? 'Guardando…' : poll ? 'Guardar' : 'Publicar votación'}</button></>}>
      <div className="stack">
        <label className="stack tight"><span className="small muted">Pregunta</span>
          <input autoFocus value={question} maxLength={300} placeholder="¿Dónde hacemos la próxima reunión?" onChange={(e) => setQuestion(e.target.value)} /></label>
        <div className="stack tight">
          <div className="row spread">
            <span className="small muted">Opciones (mínimo 2)</span>
            {ai.enabled && <button className="btn ai sm" disabled={thinking || !question.trim()} onClick={() => void suggest()}><Sparkles size={13} /> {thinking ? 'Pensando…' : 'Sugerir opciones'}</button>}
          </div>
          {options.map((o, i) => (
            <div key={o.id} className="row">
              <input value={o.text} maxLength={120} placeholder={`Opción ${i + 1}`} onChange={(e) => setText(o.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && i === options.length - 1 && options.length < 10) { e.preventDefault(); setOptions([...options, { id: uid(), text: '' }]) } }} />
              <button className="icon-btn sm" aria-label="Quitar opción" disabled={options.length <= 2} onClick={() => setOptions(options.filter((x) => x.id !== o.id))}><X size={15} /></button>
            </div>
          ))}
          <div className="row">
            <button className="btn sm" disabled={options.length >= 10} onClick={() => setOptions([...options, { id: uid(), text: '' }])}><Plus size={14} /> Añadir opción</button>
            {!poll && <button className="btn ghost sm" onClick={() => setOptions([{ id: uid(), text: 'Sí' }, { id: uid(), text: 'No' }, { id: uid(), text: 'Me abstengo' }])}>Sí / No / Me abstengo</button>}
          </div>
          {hasVotes && <p className="callout small">Si quitas una opción se borran sus votos.</p>}
        </div>
        <div className="grid-2">
          <label className="check"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Permitir elegir varias opciones</label>
          <label className="check"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Votación anónima (no se ve quién votó qué)</label>
        </div>
        {!poll && (
          <label className="stack tight"><span className="small muted">Cierre</span>
            <select value={duration ?? ''} onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}>
              {DURATIONS.map((d) => <option key={d.label} value={d.ms ?? ''}>{d.label}</option>)}
            </select></label>
        )}
      </div>
    </Modal>
  )
}

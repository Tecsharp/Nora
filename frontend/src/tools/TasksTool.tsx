import { useFocusTarget, type FocusTarget } from './focus'
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { AlarmClock, Check, ChevronLeft, ChevronRight, CircleCheck, Circle, Flag, ListChecks, Pencil, Plus, Search, Sparkles, Trash2, X, MoveRight, AlignLeft } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import Modal from '../components/Modal'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { aiNow, useAi } from '../ai/AiProvider'
import { fmtDate } from '../dates'
import { useItems, type Item } from './useItems'

type Status = 'todo' | 'doing' | 'review' | 'done'
type Priority = 'low' | 'medium' | 'high'
interface Check { id: string; text: string; done: boolean }
interface TaskData {
  title: string
  description: string
  status: Status
  priority: Priority
  assignee: string | null
  due: string | null
  labels: string[]
  checklist: Check[]
}
type Task = Item<TaskData>

const COLUMNS: { id: Status; label: string; hint: string }[] = [
  { id: 'todo', label: 'Por hacer', hint: 'Lo que está pendiente de empezar' },
  { id: 'doing', label: 'En curso', hint: 'Alguien está trabajando en ello' },
  { id: 'review', label: 'En revisión', hint: 'Terminado, falta que alguien lo revise' },
  { id: 'done', label: 'Hecho', hint: 'Completado' },
]
const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  high: { label: 'Alta', cls: 'high' },
  medium: { label: 'Media', cls: 'medium' },
  low: { label: 'Baja', cls: 'low' },
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dueState = (t: TaskData): 'late' | 'today' | 'soon' | 'none' => {
  if (!t.due || t.status === 'done') return 'none'
  const now = today()
  if (t.due < now) return 'late'
  if (t.due === now) return 'today'
  const diff = (new Date(`${t.due}T00:00`).getTime() - new Date(`${now}T00:00`).getTime()) / 86_400_000
  return diff <= 2 ? 'soon' : 'none'
}
const dueLabel = (due: string) => {
  const now = today()
  if (due === now) return 'Hoy'
  const d = (new Date(`${due}T00:00`).getTime() - new Date(`${now}T00:00`).getTime()) / 86_400_000
  if (d === 1) return 'Mañana'
  if (d === -1) return 'Ayer'
  return fmtDate(`${due}T00:00`)
}
const uid = () => Math.random().toString(36).slice(2, 10)

export default function TasksTool({ room, focus }: { room: Room; focus?: FocusTarget | null }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const ai = useAi()
  const { items, loading, error, create, update, remove } = useItems<TaskData>(room.code, 'task')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const [prio, setPrio] = useState<'' | Priority>('')
  const [openId, setOpenId] = useState<string | null>(null)
  useFocusTarget(focus, !loading, (f) => { if (f.item && items.some((t) => t.id === f.item)) setOpenId(f.item) })
  const [aiOpen, setAiOpen] = useState(false)
  const [adding, setAdding] = useState<Status | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ status: Status; index: number } | null>(null)
  const people = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])

  const visible = useMemo(() => items.filter((t) => {
    if (mine && t.data.assignee !== user?.id) return false
    if (prio && t.data.priority !== prio) return false
    const s = q.trim().toLowerCase()
    return !s || t.data.title.toLowerCase().includes(s) || t.data.description.toLowerCase().includes(s) || t.data.labels.some((l) => l.toLowerCase().includes(s))
  }), [items, mine, prio, q, user?.id])
  const col = (s: Status) => visible.filter((t) => t.data.status === s).sort((a, b) => a.sort - b.sort)
  const done = items.filter((t) => t.data.status === 'done').length
  const open = openId ? items.find((t) => t.id === openId) ?? null : null
  const late = items.filter((t) => dueState(t.data) === 'late').length

  const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, 'error')

  async function quickAdd(status: Status, title: string) {
    const last = col(status).at(-1)
    try {
      await create({ title, description: '', status, priority: 'medium', assignee: null, due: null, labels: [], checklist: [] }, last ? last.sort + 1000 : Date.now())
    } catch (e) {
      fail(e, 'No se pudo crear la tarea')
    }
  }

  /** Mueve una tarea a una columna y posición (sort a medio camino entre sus vecinas). */
  async function move(id: string, status: Status, index: number) {
    const t = items.find((x) => x.id === id)
    if (!t) return
    const list = col(status).filter((x) => x.id !== id)
    const prev = list[index - 1]
    const next = list[index]
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1000 : next ? next.sort - 1000 : Date.now()
    if (t.data.status === status && (prev?.sort === t.sort || next?.sort === t.sort)) return
    try {
      await update(id, { ...t.data, status }, sort)
    } catch (e) {
      fail(e, 'No se pudo mover la tarea')
    }
  }

  const toggleDone = (t: Task) => void update(t.id, { ...t.data, status: t.data.status === 'done' ? 'todo' : 'done' }).catch((e) => fail(e, 'No se pudo cambiar la tarea'))

  async function del(t: Task) {
    if (!(await dialogs.confirm({ title: '¿Borrar la tarea?', message: <>«{t.data.title}» se eliminará para todas las personas de la sala.</>, confirmLabel: 'Borrar', tone: 'danger', icon: 'trash' }))) return
    try {
      await remove(t.id)
      setOpenId(null)
    } catch (e) {
      fail(e, 'No se pudo borrar')
    }
  }

  const dropAt = (status: Status) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('application/x-nora-task') || dragId
    const at = over?.status === status ? over.index : col(status).length
    setOver(null)
    setDragId(null)
    if (id) void move(id, status, at)
  }
  const dragOver = (status: Status) => (e: DragEvent<HTMLDivElement>) => {
    if (!dragId) return
    e.preventDefault()
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-task]')].filter((c) => c.dataset.task !== dragId)
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) { index = i; break }
    }
    setOver((o) => (o?.status === status && o.index === index ? o : { status, index }))
  }

  return (
    <div className="kb">
      <div className="kb-bar">
        <label className="kb-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tareas…" aria-label="Buscar tareas" /></label>
        <button className={`chip ${mine ? 'on' : ''}`} aria-pressed={mine} onClick={() => setMine((m) => !m)}>Mis tareas</button>
        <select className="kb-select" value={prio} onChange={(e) => setPrio(e.target.value as '' | Priority)} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          <option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option>
        </select>
        <span className="spacer" />
        {items.length > 0 && (
          <span className="kb-progress" title={`${done} de ${items.length} hechas`}>
            <span className="kb-progress-bar"><i style={{ width: `${(done / items.length) * 100}%` }} /></span>
            <span>{done}/{items.length}</span>
            {late > 0 && <span className="badge red"><AlarmClock size={12} /> {late} vencida{late > 1 ? 's' : ''}</span>}
          </span>
        )}
        {canWrite && ai.enabled && <button className="btn ai sm" onClick={() => setAiOpen(true)}><Sparkles size={14} /> Crear desde texto</button>}
        {canWrite && <button className="btn primary sm" onClick={() => setAdding('todo')}><Plus size={15} /> Nueva tarea</button>}
      </div>

      {error && <p className="error small center-text">{error}</p>}
      <div className="kb-board">
        {COLUMNS.map((c) => {
          const list = col(c.id)
          return (
            <section key={c.id} className={`kb-col ${over?.status === c.id ? 'over' : ''}`} aria-label={c.label}
              onDragOver={canWrite ? dragOver(c.id) : undefined} onDrop={canWrite ? dropAt(c.id) : undefined}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.status === c.id ? null : o)) }}>
              <header className="kb-col-head" title={c.hint}>
                <span className={`kb-dot ${c.id}`} />
                <strong>{c.label}</strong>
                <span className="kb-count">{list.length}</span>
                <span className="spacer" />
                {canWrite && <button className="icon-btn sm" aria-label={`Añadir a ${c.label}`} onClick={() => setAdding(c.id)}><Plus size={16} /></button>}
              </header>
              <div className="kb-cards">
                {loading && <div className="kb-skel" />}
                {list.map((t, i) => (
                  <div key={t.id} className="kb-slot">
                    {over?.status === c.id && over.index === i && <div className="kb-drop" />}
                    <TaskCard t={t} people={people} meId={user?.id} canWrite={canWrite} dragging={dragId === t.id}
                      onOpen={() => setOpenId(t.id)} onToggle={() => toggleDone(t)} onMove={(s) => void move(t.id, s, col(s).length)}
                      onDelete={() => void del(t)} canDelete={canWrite && (t.authorId === user?.id || staff)}
                      onDragStart={(e) => { e.dataTransfer.setData('application/x-nora-task', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id) }}
                      onDragEnd={() => { setDragId(null); setOver(null) }} />
                  </div>
                ))}
                {over?.status === c.id && over.index >= list.filter((x) => x.id !== dragId).length && dragId && <div className="kb-drop" />}
                {!loading && !list.length && adding !== c.id && <div className="kb-empty">{q || mine || prio ? 'Sin resultados' : c.id === 'done' ? 'Lo completado aparecerá aquí' : 'Arrastra tareas hasta aquí'}</div>}
                {adding === c.id && <QuickAdd onCancel={() => setAdding(null)} onAdd={async (title) => { await quickAdd(c.id, title) }} />}
              </div>
            </section>
          )
        })}
      </div>
      {!loading && items.length === 0 && canWrite && adding === null && (
        <div className="kb-hello">
          <ListChecks size={26} />
          <div><strong>Organiza el trabajo de la sala</strong><span className="small">Crea tareas, asígnalas, ponles fecha y arrástralas entre columnas.</span></div>
        </div>
      )}
      {open && <TaskDialog t={open} room={room} canEdit={canWrite} canDelete={canWrite && (open.authorId === user?.id || staff)} onClose={() => setOpenId(null)}
        onSave={async (data) => { await update(open.id, data) }} onDelete={() => void del(open)} />}
      {aiOpen && <AiTasksDialog room={room} onClose={() => setAiOpen(false)} onCreate={async (list) => {
        for (const d of list) await create(d, Date.now() + Math.random())
        toast(`${list.length} tarea${list.length > 1 ? 's' : ''} añadida${list.length > 1 ? 's' : ''}`, 'success')
      }} />}
    </div>
  )
}

function QuickAdd({ onAdd, onCancel }: { onAdd: (title: string) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const title = v.trim()
    if (!title || busy) return
    setBusy(true)
    await onAdd(title)
    setV('')
    setBusy(false)
  }
  return (
    <form className="kb-quick" onSubmit={submit}>
      <textarea autoFocus rows={2} value={v} maxLength={200} placeholder="Título de la tarea…" onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(e as unknown as FormEvent) } }} />
      <div className="row">
        <button className="btn primary sm" disabled={!v.trim() || busy}>Añadir</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cerrar</button>
        <span className="muted small">Enter añade otra</span>
      </div>
    </form>
  )
}

function TaskCard({ t, people, meId, canWrite, canDelete, dragging, onOpen, onToggle, onMove, onDelete, onDragStart, onDragEnd }: {
  t: Task; people: Map<string, Room['participants'][number]>; meId?: string; canWrite: boolean; canDelete: boolean; dragging: boolean
  onOpen: () => void; onToggle: () => void; onMove: (s: Status) => void; onDelete: () => void; onDragStart: (e: DragEvent) => void; onDragEnd: () => void
}) {
  const d = t.data
  const due = dueState(d)
  const a = d.assignee ? people.get(d.assignee) : undefined
  const doneCount = d.checklist.filter((c) => c.done).length
  const idx = COLUMNS.findIndex((c) => c.id === d.status)
  return (
    <article data-task={t.id} className={`kb-card ${d.status === 'done' ? 'is-done' : ''} ${dragging ? 'dragging' : ''}`} draggable={canWrite}
      onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }} aria-label={d.title}>
      <div className="kb-card-top">
        {canWrite
          ? <button className="kb-check" aria-label={d.status === 'done' ? 'Marcar como pendiente' : 'Marcar como hecha'} onClick={(e) => { e.stopPropagation(); onToggle() }}>{d.status === 'done' ? <CircleCheck size={18} /> : <Circle size={18} />}</button>
          : d.status === 'done' ? <CircleCheck size={18} className="kb-check ro" /> : null}
        <h4>{d.title}</h4>
        <span className="kb-card-menu" onClick={(e) => e.stopPropagation()}>
          <Menu label="Acciones de la tarea" items={[
            { label: 'Abrir', icon: <Pencil size={16} />, onClick: onOpen },
            ...(canWrite ? [
              'separator' as const,
              { heading: 'Mover a' },
              ...COLUMNS.filter((c) => c.id !== d.status).map((c) => ({ label: c.label, icon: <MoveRight size={16} />, onClick: () => onMove(c.id) })),
            ] : []),
            ...(canDelete ? ['separator' as const, { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: onDelete }] : []),
          ]} />
        </span>
      </div>
      {(d.labels.length > 0) && <div className="kb-labels">{d.labels.map((l) => <span key={l} className="kb-label">{l}</span>)}</div>}
      <div className="kb-meta">
        <span className={`kb-prio ${PRIORITY[d.priority].cls}`} title={`Prioridad ${PRIORITY[d.priority].label.toLowerCase()}`}><Flag size={12} /></span>
        {d.due && <span className={`kb-due ${due}`} title={fmtDate(`${d.due}T00:00`)}><AlarmClock size={12} /> {dueLabel(d.due)}</span>}
        {d.description && <span className="kb-ico" title="Tiene descripción"><AlignLeft size={13} /></span>}
        {d.checklist.length > 0 && <span className={`kb-chk ${doneCount === d.checklist.length ? 'all' : ''}`}><Check size={12} /> {doneCount}/{d.checklist.length}</span>}
        <span className="spacer" />
        {idx > 0 && canWrite && <button className="kb-step" aria-label="Mover a la columna anterior" onClick={(e) => { e.stopPropagation(); onMove(COLUMNS[idx - 1]!.id) }}><ChevronLeft size={14} /></button>}
        {a && <span title={a.displayName + (a.userId === meId ? ' (tú)' : '')}><Avatar name={a.displayName} userId={a.userId} version={a.avatarVersion} size={22} /></span>}
        {idx < COLUMNS.length - 1 && canWrite && <button className="kb-step" aria-label="Mover a la columna siguiente" onClick={(e) => { e.stopPropagation(); onMove(COLUMNS[idx + 1]!.id) }}><ChevronRight size={14} /></button>}
      </div>
    </article>
  )
}

function TaskDialog({ t, room, canEdit, canDelete, onClose, onSave, onDelete }: {
  t: Task; room: Room; canEdit: boolean; canDelete: boolean; onClose: () => void; onSave: (d: TaskData) => Promise<void>; onDelete: () => void
}) {
  const toast = useToast()
  const ai = useAi()
  const [d, setD] = useState<TaskData>({ ...t.data, checklist: t.data.checklist.map((c) => ({ ...c })), labels: [...t.data.labels] })
  const [saving, setSaving] = useState(false)
  const [newCheck, setNewCheck] = useState('')
  const [label, setLabel] = useState('')
  const [thinking, setThinking] = useState(false)
  const dirty = JSON.stringify(d) !== JSON.stringify(t.data)
  const set = <K extends keyof TaskData>(k: K, v: TaskData[K]) => setD((x) => ({ ...x, [k]: v }))
  const nameOf = useRef(new Map(room.participants.map((p) => [p.userId, p.displayName]))).current

  const save = async () => {
    if (!d.title.trim()) return toast('La tarea necesita un título', 'warning')
    setSaving(true)
    try {
      await onSave({ ...d, title: d.title.trim() })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
    } finally {
      setSaving(false)
    }
  }
  const addCheck = () => {
    const text = newCheck.trim()
    if (!text || d.checklist.length >= 30) return
    set('checklist', [...d.checklist, { id: uid(), text, done: false }])
    setNewCheck('')
  }
  const addLabel = () => {
    const l = label.trim()
    if (l && !d.labels.includes(l) && d.labels.length < 8) set('labels', [...d.labels, l])
    setLabel('')
  }
  const suggest = async () => {
    setThinking(true)
    try {
      const r = await ai.json<{ description?: string; checklist?: string[] }>({ task: 'task_details', text: d.title })
      setD((x) => ({
        ...x,
        description: x.description || r.description || '',
        checklist: [...x.checklist, ...(r.checklist ?? []).slice(0, 8).map((text) => ({ id: uid(), text: String(text).slice(0, 200), done: false }))].slice(0, 30),
      }))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo usar la IA', 'error')
    } finally {
      setThinking(false)
    }
  }
  const done = d.checklist.filter((c) => c.done).length

  return (
    <Modal title={canEdit ? 'Tarea' : 'Tarea (solo lectura)'} icon={<ListChecks size={20} />} onClose={onClose} wide
      footer={
        <>
          {canDelete && <button className="btn danger" onClick={onDelete}><Trash2 size={15} /> Borrar</button>}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>{canEdit && dirty ? 'Descartar' : 'Cerrar'}</button>
          {canEdit && <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar'}</button>}
        </>
      }>
      <div className="kb-dialog">
        <div className="kb-main">
          <input className="kb-title-input" value={d.title} readOnly={!canEdit} maxLength={200} aria-label="Título" onChange={(e) => set('title', e.target.value)} />
          <label className="stack tight">
            <span className="small muted">Descripción</span>
            <textarea rows={5} value={d.description} readOnly={!canEdit} maxLength={5000} placeholder={canEdit ? 'Añade detalles, enlaces, criterios de hecho…' : ''} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="stack tight">
            <div className="row spread">
              <span className="small muted">Lista de pasos {d.checklist.length > 0 && `· ${done}/${d.checklist.length}`}</span>
              {canEdit && ai.enabled && <button className="btn ai sm" disabled={thinking || !d.title.trim()} onClick={() => void suggest()}><Sparkles size={13} /> {thinking ? 'Pensando…' : 'Sugerir con IA'}</button>}
            </div>
            {d.checklist.length > 0 && <div className="kb-checkbar"><i style={{ width: `${(done / d.checklist.length) * 100}%` }} /></div>}
            <ul className="kb-checklist">
              {d.checklist.map((c) => (
                <li key={c.id} className={c.done ? 'done' : ''}>
                  <label><input type="checkbox" checked={c.done} disabled={!canEdit} onChange={() => set('checklist', d.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} /><span>{c.text}</span></label>
                  {canEdit && <button className="icon-btn sm" aria-label="Quitar paso" onClick={() => set('checklist', d.checklist.filter((x) => x.id !== c.id))}><X size={14} /></button>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="row">
                <input value={newCheck} maxLength={200} placeholder="Añadir un paso…" onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCheck() } }} />
                <button className="btn sm" onClick={addCheck} disabled={!newCheck.trim()}><Plus size={14} /></button>
              </div>
            )}
          </div>
        </div>
        <aside className="kb-side">
          <label className="stack tight"><span className="small muted">Estado</span>
            <select value={d.status} disabled={!canEdit} onChange={(e) => set('status', e.target.value as Status)}>{COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="stack tight"><span className="small muted">Prioridad</span>
            <select value={d.priority} disabled={!canEdit} onChange={(e) => set('priority', e.target.value as Priority)}><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></label>
          <label className="stack tight"><span className="small muted">Responsable</span>
            <select value={d.assignee ?? ''} disabled={!canEdit} onChange={(e) => set('assignee', e.target.value || null)}>
              <option value="">Sin asignar</option>
              {room.participants.map((p) => <option key={p.userId} value={p.userId}>{p.displayName}</option>)}
            </select></label>
          <label className="stack tight"><span className="small muted">Fecha límite</span>
            <span className="row"><input type="date" value={d.due ?? ''} disabled={!canEdit} onChange={(e) => set('due', e.target.value || null)} />
              {d.due && canEdit && <button className="icon-btn sm" aria-label="Quitar fecha" onClick={() => set('due', null)}><X size={14} /></button>}</span></label>
          <div className="stack tight">
            <span className="small muted">Etiquetas</span>
            <div className="kb-labels">{d.labels.map((l) => <span key={l} className="kb-label">{l}{canEdit && <button aria-label={`Quitar ${l}`} onClick={() => set('labels', d.labels.filter((x) => x !== l))}><X size={11} /></button>}</span>)}</div>
            {canEdit && <input value={label} maxLength={24} placeholder="Nueva etiqueta + Enter" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }} />}
          </div>
          <p className="muted small">Creada por {t.authorName}{t.authorId && nameOf.has(t.authorId) ? '' : ''} · {fmtDate(t.createdAt)}</p>
        </aside>
      </div>
    </Modal>
  )
}

interface Suggested { title: string; description: string; assignee: string | null; due: string | null; priority: Priority; on: boolean }

function AiTasksDialog({ room, onClose, onCreate }: { room: Room; onClose: () => void; onCreate: (l: TaskData[]) => Promise<void> }) {
  const ai = useAi()
  const toast = useToast()
  const [text, setText] = useState('')
  const [list, setList] = useState<Suggested[] | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const r = await ai.json<{ tasks?: Suggested[] }>({ task: 'extract_tasks', text, now: aiNow() })
      const tasks = (r.tasks ?? []).filter((t) => t && String(t.title ?? '').trim()).slice(0, 20)
      if (!tasks.length) toast('No se encontraron tareas en ese texto', 'info')
      else setList(tasks.map((t) => ({ ...t, title: String(t.title).slice(0, 200), description: String(t.description ?? '').slice(0, 2000), priority: (['low', 'medium', 'high'] as const).includes(t.priority) ? t.priority : 'medium', due: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due)) ? String(t.due) : null, on: true })))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo usar la IA', 'error')
    } finally {
      setBusy(false)
    }
  }
  const person = (name: string | null) => (name ? room.participants.find((p) => p.displayName.toLowerCase() === name.toLowerCase() || p.displayName.toLowerCase().split(' ')[0] === name.toLowerCase())?.userId ?? null : null)
  const add = async () => {
    const chosen = (list ?? []).filter((t) => t.on)
    setBusy(true)
    try {
      await onCreate(chosen.map((t) => ({ title: t.title, description: t.description, status: 'todo' as const, priority: t.priority, assignee: person(t.assignee), due: t.due, labels: [], checklist: [] })))
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron crear', 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title="Crear tareas con IA" icon={<Sparkles size={20} />} onClose={onClose} wide
      footer={list
        ? <><button className="btn ghost" onClick={() => setList(null)}>Volver</button><span className="grow" /><button className="btn primary" disabled={busy || !list.some((t) => t.on)} onClick={() => void add()}>Añadir {list.filter((t) => t.on).length} tareas</button></>
        : <><span className="grow" /><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn ai" disabled={busy || text.trim().length < 5} onClick={() => void run()}><Sparkles size={15} /> {busy ? 'Analizando…' : 'Extraer tareas'}</button></>}>
      {!list ? (
        <div className="stack">
          <p className="muted small">Pega notas de una reunión, un correo o una lista de ideas y la IA propondrá tareas con responsable y fecha cuando las mencione. Podrás revisarlas antes de añadirlas.</p>
          <textarea rows={12} autoFocus value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Ana envía la propuesta al cliente el lunes. Luis revisa el presupuesto antes del viernes…" />
        </div>
      ) : (
        <ul className="kb-suggest">
          {list.map((t, i) => (
            <li key={i} className={t.on ? '' : 'off'}>
              <input type="checkbox" checked={t.on} aria-label="Incluir" onChange={() => setList(list.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
              <div>
                <input className="kb-suggest-title" value={t.title} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <div className="kb-meta"><span className={`kb-prio ${t.priority}`}><Flag size={12} /> {PRIORITY[t.priority].label}</span>{t.due && <span className="kb-due"><AlarmClock size={12} /> {fmtDate(`${t.due}T00:00`)}</span>}{person(t.assignee) && <span className="kb-label">{t.assignee}</span>}</div>
                {t.description && <p className="muted small">{t.description}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

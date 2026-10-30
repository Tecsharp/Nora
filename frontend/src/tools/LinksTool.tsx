import { byItem, flash, useFocusTarget, type FocusTarget } from './focus'
import { useMemo, useState, type FormEvent } from 'react'
import { Check, Copy, ExternalLink, Link2, Pencil, Pin, PinOff, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Menu from '../components/Menu'
import Modal from '../components/Modal'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { fmtDate } from '../dates'
import { useItems, type Item } from './useItems'

interface LinkData { url: string; title: string; description: string; tags: string[]; pinned: boolean }
type Lnk = Item<LinkData>

const normalize = (raw: string): string | null => {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 }

export default function LinksTool({ room, focus }: { room: Room; focus?: FocusTarget | null }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const { items, loading, error, create, update, remove, act } = useItems<LinkData>(room.code, 'link')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [quick, setQuick] = useState('')
  const [editing, setEditing] = useState<Lnk | 'new' | null>(null)
  const [adding, setAdding] = useState(false)
  useFocusTarget(focus, !loading, (f) => { if (f.item) { setQ(''); setTag(null); flash(byItem(f.item)) } })

  const tags = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of items) for (const t of l.data.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [items])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items
      .filter((l) => (!tag || l.data.tags.includes(tag)) && (!s || `${l.data.title} ${l.data.url} ${l.data.description} ${l.data.tags.join(' ')}`.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.data.pinned) - Number(a.data.pinned) || b.createdAt.localeCompare(a.createdAt))
  }, [items, q, tag])

  const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, 'error')

  async function quickAdd(e: FormEvent) {
    e.preventDefault()
    const url = normalize(quick)
    if (!url) return toast('Escribe una dirección válida (por ejemplo, https://ejemplo.com)', 'warning')
    if (items.some((l) => l.data.url === url)) return toast('Ese enlace ya está en la sala', 'info')
    setAdding(true)
    try {
      await create({ url, title: host(url), description: '', tags: [], pinned: false })
      setQuick('')
    } catch (er) {
      fail(er, 'No se pudo añadir el enlace')
    } finally {
      setAdding(false)
    }
  }
  const copy = (l: Lnk) => navigator.clipboard.writeText(l.data.url).then(() => toast('Enlace copiado', 'success'), () => toast('No se pudo copiar', 'error'))
  const pin = (l: Lnk) => act(l.id, 'pin', { pinned: !l.data.pinned }).catch((e) => fail(e, 'No se pudo fijar'))
  async function del(l: Lnk) {
    if (!(await dialogs.confirm({ title: '¿Quitar el enlace?', message: <>«{l.data.title || host(l.data.url)}» se quitará de la sala.</>, confirmLabel: 'Quitar', tone: 'danger', icon: 'trash' }))) return
    try { await remove(l.id) } catch (e) { fail(e, 'No se pudo quitar') }
  }

  return (
    <div className="lk">
      <div className="lk-bar">
        {canWrite && (
          <form className="lk-quick" onSubmit={quickAdd}>
            <Link2 size={16} />
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Pega un enlace y pulsa Enter para guardarlo…" aria-label="Añadir enlace" disabled={adding}
              onPaste={(e) => { const t = e.clipboardData.getData('text'); if (normalize(t) && !quick) { e.preventDefault(); setQuick(t.trim()) } }} />
            <button className="btn primary sm" disabled={!quick.trim() || adding}><Plus size={14} /> Guardar</button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing('new')}>Con detalles…</button>
          </form>
        )}
        <label className="kb-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar enlaces" /></label>
      </div>
      {tags.length > 0 && (
        <div className="lk-tags" role="group" aria-label="Etiquetas">
          <button className={`chip ${tag === null ? 'on' : ''}`} onClick={() => setTag(null)}>Todos · {items.length}</button>
          {tags.map(([t, n]) => <button key={t} className={`chip ${tag === t ? 'on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}><Tag size={11} /> {t} <small>{n}</small></button>)}
        </div>
      )}
      <div className="lk-list">
        {error && <p className="error small center-text">{error}</p>}
        {!loading && !items.length && (
          <div className="lk-empty"><Link2 size={32} /><strong>Guarda aquí lo que el equipo necesita a mano</strong>
            <span className="small">Documentos, diseños, tableros, referencias… Pega un enlace arriba y quedará disponible para todas las personas de la sala.</span></div>
        )}
        {!loading && items.length > 0 && !shown.length && <p className="muted center-text">Ningún enlace coincide con la búsqueda.</p>}
        <div className="lk-grid">
          {shown.map((l) => {
            const d = l.data
            const own = canWrite && (l.authorId === user?.id || staff)
            const h = host(d.url)
            return (
              <article key={l.id} data-item-id={l.id} className={`lk-card ${d.pinned ? 'pinned' : ''}`}>
                <span className="lk-ico" style={{ ['--h' as string]: hue(h) }} aria-hidden>{h.charAt(0).toUpperCase()}</span>
                <div className="lk-body">
                  <a className="lk-title" href={d.url} target="_blank" rel="noopener noreferrer" title={d.url}>{d.title || h}</a>
                  <span className="lk-host">{h}</span>
                  {d.description && <p>{d.description}</p>}
                  {d.tags.length > 0 && <div className="kb-labels">{d.tags.map((t) => <button key={t} className="kb-label" onClick={() => setTag(t)}>{t}</button>)}</div>}
                  <small className="muted">{l.authorName} · {fmtDate(l.createdAt)}</small>
                </div>
                <div className="lk-actions">
                  {d.pinned && <Pin size={14} className="lk-pin" aria-label="Fijado" />}
                  <a className="icon-btn sm" href={d.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir en una pestaña nueva" title="Abrir"><ExternalLink size={16} /></a>
                  <button className="icon-btn sm" aria-label="Copiar enlace" title="Copiar" onClick={() => void copy(l)}><Copy size={16} /></button>
                  <Menu label="Más acciones" items={[
                    ...(canWrite ? [{ label: d.pinned ? 'Quitar de fijados' : 'Fijar arriba', icon: d.pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: () => void pin(l) }] : []),
                    ...(own ? [{ label: 'Editar', icon: <Pencil size={16} />, onClick: () => setEditing(l) }, 'separator' as const, { label: 'Quitar', icon: <Trash2 size={16} />, danger: true, onClick: () => void del(l) }] : []),
                    ...(!canWrite ? [{ label: 'Copiar enlace', icon: <Copy size={16} />, onClick: () => void copy(l) }] : []),
                  ]} />
                </div>
              </article>
            )
          })}
        </div>
      </div>
      {editing && <LinkDialog link={editing === 'new' ? null : editing} known={tags.map(([t]) => t)} onClose={() => setEditing(null)}
        onSave={async (d) => { if (editing === 'new') await create(d); else await update(editing.id, { ...editing.data, ...d }) }} />}
    </div>
  )
}

function LinkDialog({ link, known, onClose, onSave }: { link: Lnk | null; known: string[]; onClose: () => void; onSave: (d: LinkData) => Promise<void> }) {
  const toast = useToast()
  const [url, setUrl] = useState(link?.data.url ?? '')
  const [title, setTitle] = useState(link?.data.title ?? '')
  const [description, setDescription] = useState(link?.data.description ?? '')
  const [tags, setTags] = useState<string[]>(link?.data.tags ?? [])
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)
  const valid = normalize(url)
  const addTag = (t = tag) => {
    const v = t.trim()
    if (v && !tags.includes(v) && tags.length < 6) setTags([...tags, v])
    setTag('')
  }
  const save = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await onSave({ url: valid, title: title.trim() || host(valid), description: description.trim(), tags, pinned: link?.data.pinned ?? false })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error')
      setSaving(false)
    }
  }
  return (
    <Modal title={link ? 'Editar enlace' : 'Nuevo enlace'} icon={<Link2 size={20} />} onClose={onClose}
      footer={<><span className="grow" /><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!valid || saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar'}</button></>}>
      <div className="stack">
        <label className="stack tight"><span className="small muted">Dirección</span>
          <input autoFocus value={url} maxLength={2000} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url && !valid} />
          {url && !valid && <span className="error small">No parece una dirección web válida.</span>}</label>
        <label className="stack tight"><span className="small muted">Título (opcional)</span><input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={valid ? host(valid) : ''} /></label>
        <label className="stack tight"><span className="small muted">Descripción (opcional)</span><textarea rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="stack tight">
          <span className="small muted">Etiquetas</span>
          <div className="kb-labels">{tags.map((t) => <span key={t} className="kb-label">{t}<button aria-label={`Quitar ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}><X size={11} /></button></span>)}</div>
          <input value={tag} maxLength={24} list="lk-known" placeholder="Escribe una etiqueta y pulsa Enter" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
          <datalist id="lk-known">{known.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
          {tag.trim() && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addTag()}><Check size={13} /> Añadir «{tag.trim()}»</button>}
        </div>
      </div>
    </Modal>
  )
}

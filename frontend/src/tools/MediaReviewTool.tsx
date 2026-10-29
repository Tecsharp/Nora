import { flash, useFocusTarget, type FocusTarget } from './focus'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { AudioLines, Check, ClipboardCopy, Clapperboard, Film, Image as ImageIcon, MapPin, MessageSquarePlus, Pause, Pencil, Play, Rewind, FastForward, Search, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import AiAssist, { type AiAction } from '../ai/AiAssist'
import { fmtDateTime } from '../dates'
import { loadFile, prefetchFile } from '../fileCache'
import { mimeFor } from '../preview'
import { fmtTime, mediaKind, streamUrl, useRoomFiles, type MediaKind, type RoomFileLite } from './media'
import { useItems, type Item } from './useItems'

interface ReviewData {
  fileId: string
  fileName: string
  text: string
  t: number | null
  x: number | null
  y: number | null
  resolved: boolean
}
type Comment = Item<ReviewData>

const SUMMARY: AiAction[] = [{ id: 'sum', label: 'Resumir los cambios pendientes', task: 'review_summary' }]
const KIND_ICON: Record<MediaKind, typeof Film> = { video: Film, audio: AudioLines, image: ImageIcon }

export default function MediaReviewTool({ room, focus }: { room: Room; focus?: FocusTarget | null }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const { files, loading: filesLoading } = useRoomFiles(room.code)
  const { items, loading: itemsLoading, create, update, remove, act } = useItems<ReviewData>(room.code, 'review')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const media = useMemo(() => files.filter((f) => mediaKind(f.name)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [files])
  const [fileId, setFileId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [src, setSrc] = useState<{ url: string; loading: boolean; error: string; progress?: number }>({ url: '', loading: false, error: '' })
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const [draft, setDraft] = useState('')
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null)
  const [pauseOnType, setPauseOnType] = useState(true)
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLInputElement>(null)
  const people = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])

  const file = media.find((f) => f.id === fileId) ?? null
  const kind = file ? mediaKind(file.name) : null
  useEffect(() => { if (!fileId && media[0]) setFileId(media[0].id) }, [media, fileId])
  // desde una notificación: se elige el archivo del comentario y se resalta el comentario
  useFocusTarget(focus, !filesLoading && !itemsLoading, (f) => {
    const c = items.find((x) => x.id === f.item)
    const target = f.file ?? c?.data.fileId
    if (target) { setFileId(target); setFilter('all'); setQ('') }
    if (c) flash(`#mr-c-${c.id}`)
  })

  // al elegir el archivo: las imágenes salen de la caché (o se descargan una vez, con progreso); el audio y el vídeo usan su dirección firmada
  useEffect(() => {
    if (!file) return
    let alive = true
    let objectUrl = ''
    setSrc({ url: '', loading: true, error: '', progress: 0 })
    setTime(0); setDuration(0); setPlaying(false); setPin(null)
    if (kind === 'image') {
      const h = loadFile(room.code, file.id, (l, t) => alive && setSrc((s) => (s.loading ? { ...s, progress: t ? l / t : 0 } : s)), mimeFor(file.name, 'image'))
      h.promise.then((b) => { if (!alive) return; objectUrl = URL.createObjectURL(b); setSrc({ url: objectUrl, loading: false, error: '', progress: 1 }) })
        .catch((e) => { if (alive && !(e instanceof DOMException && e.name === 'AbortError')) setSrc({ url: '', loading: false, error: e instanceof Error ? e.message : 'No se pudo abrir el archivo', progress: 0 }) })
      // las vecinas de la lista se dejan listas en segundo plano
      const at = media.findIndex((f) => f.id === file.id)
      for (const f of [media[at + 1], media[at + 2], media[at - 1]]) if (f && mediaKind(f.name) === 'image') prefetchFile(room.code, f.id, f.sizeBytes, mimeFor(f.name, 'image'))
      return () => { alive = false; h.cancel(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
    }
    streamUrl(room.code, file.id).then((r) => alive && setSrc({ url: r.url, loading: false, error: '', progress: 1 }))
      .catch((e) => alive && setSrc({ url: '', loading: false, error: e instanceof Error ? e.message : 'No se pudo abrir el archivo', progress: 0 }))
    return () => { alive = false }
  }, [file?.id, room.code]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; open: number }>()
    for (const c of items) {
      const s = m.get(c.data.fileId) ?? { total: 0, open: 0 }
      s.total++
      if (!c.data.resolved) s.open++
      m.set(c.data.fileId, s)
    }
    return m
  }, [items])
  const mine = useMemo(() => items.filter((c) => c.data.fileId === fileId), [items, fileId])
  const sorted = useMemo(() => [...mine].sort((a, b) => (a.data.t ?? 1e9) - (b.data.t ?? 1e9) || a.createdAt.localeCompare(b.createdAt)), [mine])
  const shown = sorted.filter((c) => (filter === 'open' ? !c.data.resolved : filter === 'done' ? c.data.resolved : true))
  const activeId = kind !== 'image' ? sorted.filter((c) => c.data.t != null && Math.abs(c.data.t - time) < 1.5 && !c.data.resolved).at(0)?.id : undefined
  const filesShown = media.filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()))

  const seek = useCallback((t: number, play = false) => {
    const m = el.current
    if (!m) return
    m.currentTime = Math.max(0, Math.min(t, m.duration || t))
    if (play) void m.play().catch(() => undefined)
  }, [])
  const toggle = useCallback(() => {
    const m = el.current
    if (!m) return
    if (m.paused) void m.play().catch(() => undefined)
    else m.pause()
  }, [])

  async function post() {
    const text = draft.trim()
    if (!text || !file) return
    try {
      await create({ fileId: file.id, fileName: file.name, text, t: kind === 'image' ? null : Math.round(time * 10) / 10, x: pin?.x ?? null, y: pin?.y ?? null, resolved: false })
      setDraft('')
      setPin(null)
      if (pauseOnType && kind !== 'image') void el.current?.play().catch(() => undefined)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar el comentario', 'error')
    }
  }
  async function edit(c: Comment) {
    const text = await dialogs.prompt({ title: 'Editar comentario', initial: c.data.text, maxLength: 2000, confirmLabel: 'Guardar' })
    if (text == null || !text.trim()) return
    try {
      await update(c.id, { ...c.data, text: text.trim() })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo editar', 'error')
    }
  }
  async function del(c: Comment) {
    if (!(await dialogs.confirm({ title: '¿Borrar el comentario?', confirmLabel: 'Borrar', tone: 'danger', icon: 'trash' }))) return
    try {
      await remove(c.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error')
    }
  }
  const resolve = (c: Comment) => void act(c.id, 'resolve', { resolved: !c.data.resolved }).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'))

  const pending = () => sorted.filter((c) => !c.data.resolved).map((c) => `${c.data.t != null ? `[${fmtTime(c.data.t)}] ` : c.data.x != null ? '[punto] ' : ''}${c.authorName}: ${c.data.text}`).join('\n')
  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(`Revisión de ${file?.name}\n${pending() || '(sin comentarios pendientes)'}`)
      toast('Lista copiada', 'success')
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || kind === 'image') return
    if (e.key === ' ') { e.preventDefault(); toggle() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(time - (e.shiftKey ? 1 : 5)) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(time + (e.shiftKey ? 1 : 5)) }
    else if (e.key.toLowerCase() === 'c' && canWrite) { e.preventDefault(); composer.current?.focus() }
  }
  const onImageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!canWrite) return
    const r = (e.currentTarget.querySelector('img') as HTMLImageElement | null)?.getBoundingClientRect()
    if (!r) return
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    setPin({ x, y })
    composer.current?.focus()
  }
  const onTimeline = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (duration) seek(((e.clientX - r.left) / r.width) * duration)
  }

  if (!media.length) {
    return (
      <div className="mr-empty">
        <Clapperboard size={34} />
        <strong>Todavía no hay nada que revisar</strong>
        <span className="small">Sube un <b>vídeo, audio o imagen</b> a Archivos y aparecerá aquí para comentarlo en un momento exacto (o en un punto de la imagen) y marcar lo ya resuelto.</span>
      </div>
    )
  }

  return (
    <div className="mr">
      <aside className="mr-files">
        <label className="kb-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar archivo…" aria-label="Buscar archivo" /></label>
        <ul>
          {filesShown.map((f) => {
            const k = mediaKind(f.name)!
            const Icon = KIND_ICON[k]
            const s = stats.get(f.id)
            return (
              <li key={f.id}>
                <button className={f.id === fileId ? 'on' : ''} onClick={() => setFileId(f.id)}>
                  <Icon size={16} />
                  <span className="truncate">{f.name}</span>
                  {s && s.open > 0 && <span className="mr-badge" title={`${s.open} pendientes de ${s.total}`}>{s.open}</span>}
                  {s && s.open === 0 && <Check size={14} className="mr-ok" aria-label="Todo resuelto" />}
                </button>
              </li>
            )
          })}
          {!filesShown.length && <li className="muted small" style={{ padding: 8 }}>Sin resultados</li>}
        </ul>
      </aside>

      <section className="mr-stage" ref={stage} tabIndex={0} onKeyDown={onKey} aria-label={file?.name}>
        {file && kind && (
          <>
            <div className="mr-view">
              {src.loading && <div className="mr-load">{kind === 'image' && src.progress ? `Cargando imagen ${Math.round(src.progress * 100)}%` : 'Preparando…'}</div>}
              {src.error && <div className="mr-err"><TriangleAlert size={20} />{src.error}</div>}
              {src.url && kind === 'video' && (
                <video key={src.url} ref={el} src={src.url} controls playsInline preload="metadata"
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                  onError={() => setSrc((s) => ({ ...s, error: 'El navegador no puede reproducir este vídeo (formato o códec). Descárgalo desde Archivos.' }))} />
              )}
              {src.url && kind === 'audio' && (
                <div className="mr-audio">
                  <AudioLines size={56} />
                  <strong className="truncate">{file.name}</strong>
                  <audio key={src.url} ref={el} src={src.url} controls preload="metadata"
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                    onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                    onError={() => setSrc((s) => ({ ...s, error: 'El navegador no puede reproducir este audio.' }))} />
                </div>
              )}
              {src.url && kind === 'image' && (
                <div className={`mr-image ${canWrite ? 'pin-mode' : ''}`} onClick={onImageClick}>
                  <div className="mr-image-box">
                    <img src={src.url} alt={file.name} draggable={false} onError={() => setSrc((s) => ({ ...s, error: 'No se pudo mostrar la imagen.' }))} />
                    {sorted.filter((c) => c.data.x != null).map((c, i) => (
                      <button key={c.id} className={`mr-pin ${c.data.resolved ? 'done' : ''}`} style={{ left: `${c.data.x! * 100}%`, top: `${c.data.y! * 100}%` }}
                        title={`${c.authorName}: ${c.data.text}`} onClick={(e) => { e.stopPropagation(); document.getElementById(`mr-c-${c.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}>{i + 1}</button>
                    ))}
                    {pin && <span className="mr-pin new" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}><MapPin size={14} /></span>}
                  </div>
                  {canWrite && <span className="mr-hint">Haz clic en la imagen para señalar un punto</span>}
                </div>
              )}
            </div>

            {kind !== 'image' && src.url && (
              <div className="mr-controls">
                <button className="icon-btn" aria-label="Retroceder 5 s" onClick={() => seek(time - 5)}><Rewind size={18} /></button>
                <button className="icon-btn big" aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={toggle}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
                <button className="icon-btn" aria-label="Adelantar 5 s" onClick={() => seek(time + 5)}><FastForward size={18} /></button>
                <span className="mr-time">{fmtTime(time)} <i>/</i> {fmtTime(duration)}</span>
                <div className="mr-track" onClick={onTimeline} role="slider" aria-label="Línea de tiempo" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}>
                  <i className="mr-prog" style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
                  {duration > 0 && sorted.filter((c) => c.data.t != null).map((c) => (
                    <button key={c.id} className={`mr-mark ${c.data.resolved ? 'done' : ''} ${c.id === activeId ? 'on' : ''}`} style={{ left: `${Math.min(99.5, (c.data.t! / duration) * 100)}%` }}
                      title={`${fmtTime(c.data.t!)} · ${c.authorName}: ${c.data.text}`} aria-label={`Comentario en ${fmtTime(c.data.t!)}`}
                      onClick={(e) => { e.stopPropagation(); seek(c.data.t!, true); document.getElementById(`mr-c-${c.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }} />
                  ))}
                </div>
              </div>
            )}

            {canWrite ? (
              <div className="mr-composer">
                <MessageSquarePlus size={18} />
                <input ref={composer} value={draft} maxLength={2000} placeholder={kind === 'image' ? (pin ? 'Comentario en el punto marcado…' : 'Escribe un comentario (o marca un punto en la imagen)…') : `Comentar en ${fmtTime(time)}…  (Enter para enviar)`}
                  onFocus={() => { if (pauseOnType && kind !== 'image') el.current?.pause() }}
                  onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void post() } else if (e.key === 'Escape') { e.stopPropagation(); setPin(null); composer.current?.blur() } }} />
                {kind !== 'image' && <label className="check small" title="Pausa el vídeo al empezar a escribir y sigue al enviar"><input type="checkbox" checked={pauseOnType} onChange={(e) => setPauseOnType(e.target.checked)} /> Pausar</label>}
                <button className="btn primary sm" disabled={!draft.trim()} onClick={() => void post()}>Comentar</button>
              </div>
            ) : <p className="callout small mr-ro">Tu rol en esta sala es de <strong>lector</strong>: puedes ver y reproducir, pero no comentar.</p>}
          </>
        )}
      </section>

      <aside className="mr-comments">
        <div className="mr-comments-head">
          <div className="seg" role="tablist" aria-label="Filtro de comentarios">
            {([['all', `Todos · ${mine.length}`], ['open', `Pendientes · ${mine.filter((c) => !c.data.resolved).length}`], ['done', 'Resueltos']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          <div className="row">
            <AiAssist actions={SUMMARY} getText={pending} iconOnly disabled={!mine.some((c) => !c.data.resolved)} title="Resumir los cambios pendientes con IA" />
            <button className="icon-btn" aria-label="Copiar la lista de pendientes" title="Copiar la lista de pendientes" onClick={() => void copyList()} disabled={!mine.length}><ClipboardCopy size={17} /></button>
          </div>
        </div>
        <ul className="mr-list">
          {shown.map((c) => {
            const a = c.authorId ? people.get(c.authorId) : undefined
            const own = canWrite && (c.authorId === user?.id || staff)
            const idx = kind === 'image' && c.data.x != null ? sorted.filter((x) => x.data.x != null).indexOf(c) + 1 : 0
            return (
              <li key={c.id} id={`mr-c-${c.id}`} className={`mr-c ${c.data.resolved ? 'done' : ''} ${c.id === activeId ? 'active' : ''}`}>
                <Avatar name={c.authorName} userId={c.authorId ?? undefined} version={a?.avatarVersion} size={28} />
                <div className="mr-c-body">
                  <div className="mr-c-meta">
                    <strong>{c.authorId === user?.id ? 'Tú' : c.authorName}</strong>
                    {c.data.t != null && <button className="mr-tc" onClick={() => seek(c.data.t!, true)} title="Ir a ese momento">{fmtTime(c.data.t)}</button>}
                    {idx > 0 && <span className="mr-tc static"><MapPin size={11} /> {idx}</span>}
                    <time title={fmtDateTime(c.createdAt)}>{new Date(c.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</time>
                  </div>
                  <p>{c.data.text}</p>
                  <div className="mr-c-actions">
                    {canWrite && <button onClick={() => resolve(c)}>{c.data.resolved ? <><Undo2 size={13} /> Reabrir</> : <><Check size={13} /> Resolver</>}</button>}
                    {own && <button onClick={() => void edit(c)}><Pencil size={13} /> Editar</button>}
                    {own && <button className="danger" onClick={() => void del(c)}><Trash2 size={13} /> Borrar</button>}
                  </div>
                </div>
              </li>
            )
          })}
          {!shown.length && <li className="mr-nocomments">{mine.length ? 'Nada con este filtro' : canWrite ? 'Sin comentarios todavía. Escribe el primero debajo del vídeo.' : 'Sin comentarios todavía.'}</li>}
        </ul>
      </aside>
    </div>
  )
}

export type { RoomFileLite }

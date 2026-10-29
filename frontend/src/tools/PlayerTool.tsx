import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AudioLines, Film, Info, ListMusic, Pause, Play, Plus, RefreshCw, SkipBack, SkipForward, Trash2, Tv, Volume2, VolumeX, Youtube } from 'lucide-react'
import { api, type Room } from '../api'
import { useAuth } from '../auth'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { useRealtime } from '../realtime'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { fmtTime, mediaKind, streamUrl, useRoomFiles } from './media'
import { MediaAdapter, Sync, YouTubeAdapter, type Adapter, type PlayerItem, type PlayerState } from './playerSync'
import { useItems } from './useItems'

interface QueueData { kind: 'youtube' | 'media' | 'file'; title: string; url?: string; ytId?: string; fileId?: string }

const EMPTY: PlayerState = { item: null, playing: false, position: 0, rate: 1, updatedAt: Date.now(), by: '', rev: 0, serverNow: Date.now() }
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const isYoutube = (url: string) => { try { const h = new URL(url).hostname.toLowerCase(); return h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com') } catch { return false } }
const audioUrl = (url: string) => /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)(\?|#|$)/i.test(url)

export default function PlayerTool({ room, onPlaying }: { room: Room; onPlaying?: (b: boolean) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const { files } = useRoomFiles(room.code)
  const { items, create, update, remove } = useItems<QueueData>(room.code, 'player')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)
  const [state, setState] = useState<PlayerState>(EMPTY)
  const stateRef = useRef(state)
  stateRef.current = state
  const offset = useRef(0)
  const [blocked, setBlocked] = useState(false)
  const adapter = useRef<Adapter | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [fileId, setFileId] = useState('')
  const [adding, setAdding] = useState(false)
  const [liveTitle, setLiveTitle] = useState('')

  const base = `/rooms/${encodeURIComponent(room.code)}/live`
  const apply = useCallback((s: PlayerState) => {
    if (s.rev < stateRef.current.rev) return
    offset.current = s.serverNow - Date.now()
    stateRef.current = s
    setState(s)
  }, [])
  const send = useCallback(async (body: Record<string, unknown>) => {
    try {
      apply(await api<PlayerState>(`${base}/player`, 'POST', body))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cambiar la reproducción', 'error')
    }
  }, [base, apply, toast])

  // el motor de sincronización (una sola vez); lee siempre el estado más reciente
  const sync = useMemo(() => new Sync({
    send: (b) => { if (canWriteRef.current) void sendRef.current(b) },
    state: () => stateRef.current,
    offset: () => offset.current,
    blocked: (b) => setBlocked(b),
  }), [])
  const sendRef = useRef(send)
  sendRef.current = send
  const canWriteRef = useRef(canWrite)
  canWriteRef.current = canWrite
  useEffect(() => () => sync.dispose(), [sync])

  useEffect(() => {
    let alive = true
    api<{ player: PlayerState }>(base).then((r) => alive && apply(r.player)).catch(() => undefined)
    return () => { alive = false }
  }, [base, apply])
  useRealtime('live.changed', (e: { tool: string; state: PlayerState }) => { if (e.tool === 'player') apply(e.state) })
  useRealtime('reconnected', () => { api<{ player: PlayerState }>(base).then((r) => apply(r.player)).catch(() => undefined) })
  // cada vez que el servidor cambia algo, el reproductor se pone igual
  useEffect(() => { sync.apply() }, [state.rev, sync])
  useEffect(() => { setBlocked(false); setLiveTitle('') }, [state.item?.id])
  useEffect(() => { onPlaying?.(state.playing && !!state.item) }, [state.playing, state.item, onPlaying])

  const queue = useMemo(() => [...items].sort((a, b) => a.sort - b.sort), [items])
  const index = queue.findIndex((q) => q.id === state.item?.id)
  const fileName = (id?: string) => files.find((f) => f.id === id)?.name ?? ''

  async function add(e?: FormEvent, picked?: { kind: QueueData['kind']; url?: string; fileId?: string; title: string }) {
    e?.preventDefault()
    let data = picked
    if (!data) {
      let u = url.trim()
      if (!u) return
      if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `https://${u}`
      try { new URL(u) } catch { return toast('Escribe una dirección válida', 'warning') }
      data = { kind: isYoutube(u) ? 'youtube' : 'media', url: u, title: title.trim() }
    }
    setAdding(true)
    try {
      const it = await create(data)
      setUrl(''); setTitle(''); setFileId('')
      if (!stateRef.current.item) void send({ action: 'load', itemId: it.id })
      if (data.kind === 'youtube' && !data.title && data.url) {
        api<{ title: string }>(`${base}/player/title?url=${encodeURIComponent(data.url)}`).then(async (r) => { if (r.title) await update(it.id, { ...it.data, title: r.title }) }).catch(() => undefined)
      }
    } catch (er) {
      toast(er instanceof Error ? er.message : 'No se pudo añadir', 'error')
    } finally {
      setAdding(false)
    }
  }
  const play = (id: string) => void send({ action: 'load', itemId: id })
  const step = (d: number) => { const q = queue[index + d]; if (q) play(q.id); else if (d > 0 && state.item) void send({ action: 'next', from: state.item.id }) }
  async function del(id: string) {
    if (!(await dialogs.confirm({ title: '¿Quitar de la cola?', confirmLabel: 'Quitar', tone: 'danger', icon: 'trash' }))) return
    try { await remove(id) } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar', 'error') }
  }
  const shownTitle = liveTitle || state.item?.title || (state.item?.kind === 'file' ? fileName(state.item.fileId) : '') || 'Reproduciendo'

  return (
    <div className="pl">
      <div className="pl-main">
        {!state.item ? (
          <div className="pl-empty">
            <Tv size={40} />
            <strong>Escuchad o mirad algo juntos</strong>
            <span className="small">Añade a la cola un vídeo de YouTube, un enlace directo (mp3, mp4…) o un audio/vídeo de la sala. Lo que reproduzca alguien suena a la vez para todas las personas.</span>
          </div>
        ) : (
          <>
            <div className="pl-stage">
              <Stage key={state.item.id} item={state.item} room={room} files={files.map((f) => ({ id: f.id, name: f.name }))} sync={sync} adapter={adapter} onTitle={setLiveTitle} />
              {blocked && (
                <button className="pl-join" onClick={() => { void adapter.current?.play().then((ok) => { setBlocked(!ok); sync.apply(true) }) }}>
                  <Play size={22} /> Toca para unirte a la reproducción
                </button>
              )}
            </div>
            <Transport state={state} adapter={adapter} sync={sync} canWrite={canWrite} send={send} title={shownTitle} onPrev={() => step(-1)} onNext={() => step(1)} hasPrev={index > 0} />
          </>
        )}
        <p className="pl-note"><Info size={13} /> {state.item?.kind === 'youtube' ? 'YouTube puede mostrar anuncios según tu cuenta (con YouTube Premium no salen). ' : ''}Los archivos de la sala y los enlaces directos se reproducen siempre sin anuncios.</p>
      </div>

      <aside className="pl-queue">
        <h4><ListMusic size={16} /> Cola <span className="badge">{queue.length}</span></h4>
        {canWrite && (
          <form className="pl-add" onSubmit={(e) => void add(e)}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Pega un enlace de YouTube o de un audio/vídeo…" aria-label="Enlace" />
            {url.trim() && <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)" aria-label="Título" />}
            <button className="btn primary sm" disabled={!url.trim() || adding}><Plus size={14} /> Añadir a la cola</button>
            {files.some((f) => mediaKind(f.name) === 'audio' || mediaKind(f.name) === 'video') && (
              <div className="row">
                <select value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label="Archivo de la sala">
                  <option value="">…o un archivo de la sala</option>
                  {files.filter((f) => mediaKind(f.name) === 'audio' || mediaKind(f.name) === 'video').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button type="button" className="btn sm" disabled={!fileId || adding} onClick={() => void add(undefined, { kind: 'file', fileId, title: fileName(fileId) })}>Añadir</button>
              </div>
            )}
          </form>
        )}
        <ul className="pl-list">
          {queue.map((q, i) => {
            const now = q.id === state.item?.id
            const name = q.data.title || (q.data.kind === 'file' ? fileName(q.data.fileId) : q.data.kind === 'youtube' ? `YouTube · ${q.data.ytId}` : q.data.url) || 'Sin título'
            const own = canWrite && (q.authorId === user?.id || staff)
            const Icon = q.data.kind === 'youtube' ? Youtube : q.data.kind === 'file' && mediaKind(fileName(q.data.fileId)) === 'audio' || (q.data.kind === 'media' && audioUrl(q.data.url ?? '')) ? AudioLines : Film
            return (
              <li key={q.id} className={now ? 'now' : ''}>
                <button className="pl-item" disabled={!canWrite} onClick={() => play(q.id)} title={canWrite ? 'Reproducir ahora' : name}>
                  <span className="pl-num">{now && state.playing ? <span className="pl-eq"><i /><i /><i /></span> : i + 1}</span>
                  <Icon size={15} />
                  <span className="pl-name"><strong>{name}</strong><small>{q.authorName}</small></span>
                </button>
                {own && <button className="icon-btn sm" aria-label="Quitar de la cola" onClick={() => void del(q.id)}><Trash2 size={15} /></button>}
              </li>
            )
          })}
          {!queue.length && <li className="muted small pl-none">La cola está vacía.</li>}
        </ul>
        {!canWrite && <p className="muted small">Tu rol es de lector: escuchas lo que ponga el resto, pero no controlas la reproducción.</p>}
      </aside>
    </div>
  )
}

function Stage({ item, room, files, sync, adapter, onTitle }: { item: PlayerItem; room: Room; files: { id: string; name: string }[]; sync: Sync; adapter: React.MutableRefObject<Adapter | null>; onTitle: (t: string) => void }) {
  const [src, setSrc] = useState<{ url: string; audio: boolean } | null>(null)
  const [error, setError] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const media = useRef<HTMLMediaElement>(null)

  useEffect(() => {
    let alive = true
    if (item.kind === 'file' && item.fileId) {
      const name = files.find((f) => f.id === item.fileId)?.name ?? item.title
      streamUrl(room.code, item.fileId).then((r) => alive && setSrc({ url: r.url, audio: mediaKind(name) === 'audio' })).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo'))
    } else if (item.kind === 'media' && item.url) setSrc({ url: item.url, audio: audioUrl(item.url) })
    return () => { alive = false }
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (item.kind === 'youtube') {
      const f = frame.current
      if (!f) return
      const a = new YouTubeAdapter(f, sync)
      a.onTitle = onTitle
      a.onReady = () => sync.apply(true)
      adapter.current = a
      sync.attach(a)
      return () => { a.dispose(); adapter.current = null; sync.attach(null) }
    }
    const el = media.current
    if (!el) return
    const a = new MediaAdapter(el, sync)
    adapter.current = a
    const ready = () => sync.attach(a)
    if (el.readyState >= 1) ready()
    el.addEventListener('loadedmetadata', ready)
    return () => { el.removeEventListener('loadedmetadata', ready); a.dispose(); adapter.current = null; sync.attach(null) }
  }, [item.id, src?.url]) // eslint-disable-line react-hooks/exhaustive-deps

  if (item.kind === 'youtube') {
    const origin = encodeURIComponent(window.location.origin)
    return <iframe ref={frame} className="pl-frame" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
      src={`https://www.youtube-nocookie.com/embed/${item.ytId}?enablejsapi=1&origin=${origin}&rel=0&playsinline=1&modestbranding=1&controls=1`} />
  }
  if (error) return <div className="pl-err">{error}</div>
  if (!src) return <div className="pl-err">Preparando…</div>
  return src.audio
    ? <div className="pl-audio"><AudioLines size={64} /><audio key={src.url} ref={media as React.RefObject<HTMLAudioElement>} src={src.url} preload="auto" onError={() => setError('No se pudo reproducir este audio.')} /></div>
    : <video key={src.url} ref={media as React.RefObject<HTMLVideoElement>} className="pl-video" src={src.url} playsInline preload="auto" onError={() => setError('No se pudo reproducir este vídeo (formato, dirección o bloqueo del servidor de origen).')} />
}

function Transport({ state, adapter, sync, canWrite, send, title, onPrev, onNext, hasPrev }: {
  state: PlayerState; adapter: React.MutableRefObject<Adapter | null>; sync: Sync; canWrite: boolean; send: (b: Record<string, unknown>) => Promise<void>
  title: string; onPrev: () => void; onNext: () => void; hasPrev: boolean
}) {
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    const t = setInterval(() => { const a = adapter.current; if (a) { setCur(a.time()); setDur(a.duration()) } }, 250)
    return () => clearInterval(t)
  }, [adapter])
  const volume = (v: number, m: boolean) => {
    const a = adapter.current as (Adapter & { el?: HTMLMediaElement; setVolume?: (v: number) => void }) | null
    const el = (a as unknown as { el?: HTMLMediaElement } | null)?.el
    if (el) { el.volume = v; el.muted = m }
    else (a as YouTubeAdapter | null)?.setVolume?.(m ? 0 : v)
  }
  const shown = drag ?? cur
  return (
    <div className="pl-bar">
      <div className="pl-now"><strong className="truncate">{title}</strong><small>{state.by ? `${state.playing ? 'Puesto' : 'Pausado'} por ${state.by}` : ' '}</small></div>
      <div className="pl-seek">
        <span className="mr-time">{fmtTime(shown)}</span>
        <input type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.min(shown, Math.max(1, dur))} disabled={!canWrite || !dur} aria-label="Posición"
          onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={() => { if (drag != null) { void send({ action: 'seek', position: drag }); setDrag(null) } }}
          onKeyUp={() => { if (drag != null) { void send({ action: 'seek', position: drag }); setDrag(null) } }} />
        <span className="mr-time">{dur ? fmtTime(dur) : '--:--'}</span>
      </div>
      <div className="pl-ctl">
        <button className="icon-btn" aria-label="Anterior" disabled={!canWrite || !hasPrev} onClick={onPrev}><SkipBack size={18} /></button>
        <button className="icon-btn big" aria-label={state.playing ? 'Pausar' : 'Reproducir'} disabled={!canWrite}
          onClick={() => void send({ action: state.playing ? 'pause' : 'play', position: adapter.current?.time() ?? state.position })}>{state.playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <button className="icon-btn" aria-label="Siguiente" disabled={!canWrite} onClick={onNext}><SkipForward size={18} /></button>
        <select value={state.rate} disabled={!canWrite} aria-label="Velocidad" onChange={(e) => void send({ action: 'rate', rate: Number(e.target.value) })}>{RATES.map((r) => <option key={r} value={r}>{r}×</option>)}</select>
        <span className="spacer" />
        <button className="icon-btn" aria-label={muted ? 'Activar sonido' : 'Silenciar'} title="Solo afecta a tu equipo" onClick={() => { setMuted(!muted); volume(vol, !muted) }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <input className="pl-vol" type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} aria-label="Volumen (solo tú)" onChange={(e) => { const v = Number(e.target.value); setVol(v); setMuted(v === 0); volume(v, v === 0) }} />
        <button className="icon-btn" aria-label="Resincronizar" title="Volver a ponerme al ritmo del grupo" onClick={() => { sync.apply(true) }}><RefreshCw size={17} /></button>
      </div>
    </div>
  )
}

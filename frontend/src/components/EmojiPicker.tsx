import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock, Plus, Search } from 'lucide-react'
import { useEmojiFavorites } from './emojiFavorites'

interface Emo { u: string; label: string; group: number; skins: { u: string; tone: number }[]; hay: string }
interface Data { list: Emo[]; byGroup: Map<number, Emo[]> }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const TONE_CODES: Record<string, number> = { '1F3FB': 1, '1F3FC': 2, '1F3FD': 3, '1F3FE': 4, '1F3FF': 5 }
const TONE_COLORS = ['#ffcc4d', '#f7dece', '#e0bb95', '#bf8f68', '#9b643d', '#594539']
const TONE_NAMES = ['Tono de piel predeterminado', 'Tono de piel claro', 'Tono de piel medio claro', 'Tono de piel medio', 'Tono de piel medio oscuro', 'Tono de piel oscuro']
const GROUPS: { id: number; icon: string; label: string }[] = [
  { id: 0, icon: '😀', label: 'Caras y emociones' }, { id: 1, icon: '👋', label: 'Personas y cuerpo' }, { id: 3, icon: '🐶', label: 'Animales y naturaleza' },
  { id: 4, icon: '🍎', label: 'Comida y bebida' }, { id: 5, icon: '🚗', label: 'Viajes y lugares' }, { id: 6, icon: '⚽', label: 'Actividades' },
  { id: 7, icon: '💡', label: 'Objetos' }, { id: 8, icon: '❤️', label: 'Símbolos' }, { id: 9, icon: '🏳️', label: 'Banderas' },
]
const TONE_KEY = 'nora-emoji-tone'
const RECENT_KEY = 'nora-emoji-recent'

/**
 * ¿El sistema dibuja este emoji? Los más nuevos salen como un cuadrado o como varias piezas sueltas en equipos viejos: se ocultan.
 * Se compara el ancho con el de un emoji sencillo (👍); una secuencia que no se entiende ocupa casi el doble.
 */
const supportCache = new Map<string, boolean>()
let measure: CanvasRenderingContext2D | null = null
let baseWidth = 0
function supported(e: string): boolean {
  const c = supportCache.get(e)
  if (c !== undefined) return c
  let ok = true
  try {
    if (!measure) { measure = document.createElement('canvas').getContext('2d'); if (measure) { measure.font = '32px sans-serif'; baseWidth = measure.measureText('👍').width } }
    if (measure && baseWidth) { const w = measure.measureText(e).width; ok = w > baseWidth * 0.85 && w < baseWidth * 1.3 }
  } catch { ok = true }
  supportCache.set(e, ok)
  return ok
}

let loading: Promise<Data> | null = null
/** Los emojis en español (nombres y palabras para buscar), con sus variantes de tono de piel. Se cargan al abrir el selector por primera vez. */
function load(): Promise<Data> {
  loading ??= import('emojibase-data/es/compact.json').then((m) => {
    const raw = (m.default ?? m) as unknown as { unicode: string; label: string; group?: number; tags?: string[]; skins?: { unicode: string; hexcode: string }[] }[]
    const list: Emo[] = []
    for (const r of raw) {
      if (r.group === undefined || r.group === 2) continue
      const skins = (r.skins ?? []).map((s) => {
        const tones = new Set(s.hexcode.split('-').map((h) => TONE_CODES[h]).filter(Boolean))
        return { u: s.unicode, tone: tones.size === 1 ? [...tones][0]! : 0 }
      }).filter((s) => s.tone > 0)
      list.push({ u: r.unicode, label: r.label, group: r.group, skins, hay: norm(`${r.label} ${(r.tags ?? []).join(' ')}`) })
    }
    const byGroup = new Map<number, Emo[]>()
    for (const e of list) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e])
    return { list, byGroup }
  })
  return loading
}

const readJson = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d } catch { return d } }

/** Selector de emojis con buscador (por nombre, en español), categorías, recientes y tono de piel (se recuerda). */
export function EmojiPicker({ onPick, dark, autoFocus = true }: { onPick: (emoji: string) => void; dark?: boolean; autoFocus?: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [q, setQ] = useState('')
  const [tone, setTone] = useState<number>(() => readJson(TONE_KEY, 0))
  const [tones, setTones] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => readJson(RECENT_KEY, []))
  const [group, setGroup] = useState<number>(() => (readJson<string[]>(RECENT_KEY, []).length ? -1 : 0))
  useEffect(() => { let alive = true; void load().then((d) => { if (alive) setData(d) }); return () => { alive = false } }, [])

  const pick = useCallback((e: string) => {
    setRecent((cur) => {
      const next = [e, ...cur.filter((x) => x !== e)].slice(0, 24)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* sin almacenamiento */ }
      return next
    })
    onPick(e)
  }, [onPick])
  const chooseTone = (t: number) => { setTone(t); setTones(false); try { localStorage.setItem(TONE_KEY, JSON.stringify(t)) } catch { /* sin almacenamiento */ } }

  const shown = useMemo(() => {
    if (!data) return []
    const skin = (e: Emo) => (tone > 0 ? e.skins.find((s) => s.tone === tone)?.u ?? e.u : e.u)
    const nq = norm(q.trim())
    if (nq) {
      const words = nq.split(/\s+/)
      return data.list.filter((e) => words.every((w) => e.hay.includes(w))).slice(0, 160).filter((e) => supported(e.u)).map((e) => ({ u: skin(e), label: e.label }))
    }
    if (group === -1) return recent.map((u) => ({ u, label: '' }))
    return (data.byGroup.get(group) ?? []).filter((e) => supported(e.u)).map((e) => ({ u: skin(e), label: e.label }))
  }, [data, q, group, tone, recent])

  return (
    <div className={`epk ${dark ? 'dark' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="epk-top">
        <label className="epk-search"><Search size={15} /><input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar emoji" aria-label="Buscar emoji" /></label>
        <div className="epk-tone">
          <button type="button" className="epk-tone-btn" title="Tono de piel" aria-label="Tono de piel" aria-expanded={tones} onClick={() => setTones((v) => !v)}><i style={{ background: TONE_COLORS[tone] }} /></button>
          {tones && (
            <div className="epk-tones" role="listbox" aria-label="Tono de piel">
              {TONE_COLORS.map((c, i) => <button key={c} type="button" role="option" aria-selected={tone === i} className={tone === i ? 'on' : ''} title={TONE_NAMES[i]} aria-label={TONE_NAMES[i]} onClick={() => chooseTone(i)}><i style={{ background: c }} /></button>)}
            </div>
          )}
        </div>
      </div>
      {!q && (
        <div className="epk-tabs" role="tablist" aria-label="Categorías">
          {recent.length > 0 && <button type="button" role="tab" aria-selected={group === -1} className={group === -1 ? 'on' : ''} title="Recientes" onClick={() => setGroup(-1)}><Clock size={16} /></button>}
          {GROUPS.map((g) => <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? 'on' : ''} title={g.label} onClick={() => setGroup(g.id)}>{g.icon}</button>)}
        </div>
      )}
      <div className="epk-grid" role="group" aria-label={q ? 'Resultados' : GROUPS.find((g) => g.id === group)?.label ?? 'Recientes'}>
        {!data && <p className="epk-note">Cargando emojis…</p>}
        {data && shown.length === 0 && <p className="epk-note">{q ? 'No hay emojis con ese nombre.' : 'Aquí aparecerán los que uses.'}</p>}
        {shown.map((e, i) => <button key={`${e.u}${i}`} type="button" title={e.label} aria-label={e.label || e.u} onClick={() => pick(e.u)}>{e.u}</button>)}
      </div>
    </div>
  )
}

/**
 * Reacciones rápidas de un mensaje: los primeros 5 emojis y un «+» que abre el selector completo (con buscador) en una ventana que se
 * coloca dentro de la pantalla. Cierra al elegir o al presionar fuera.
 */
export const CHAT_EMOJI_KEY = 'nora-chat-emoji-use'

export function ReactionPicker({ quick, onPick, onClose, dark, className }: { quick: string[]; onPick: (e: string) => void; onClose?: () => void; dark?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const defaults = useMemo(() => quick.slice(0, 5), [quick])
  const favs = useEmojiFavorites(CHAT_EMOJI_KEY, defaults)
  const choose = (e: string) => { favs.used(e); onPick(e) }
  const plus = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const a = plus.current?.getBoundingClientRect()
    const w = pop.current?.offsetWidth ?? 312
    const h = pop.current?.offsetHeight ?? 340
    if (!a) return
    const left = Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8))
    const above = a.top - h - 8
    const top = above >= 8 ? above : Math.min(a.bottom + 8, Math.max(8, window.innerHeight - h - 8))
    setPos({ left, top })
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { const t = e.target as Element; if (!t.closest('.rx-pop') && !t.closest('.rx-plus')) { setOpen(false); onClose?.() } } // fuera de la ventana: se cierra todo, también la barra de rápidos
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true) }
  }, [open])

  return (
    <div className={`rx-row ${dark ? 'dark' : ''} ${className ?? ''}`} role="listbox" aria-label="Elegir reacción">
      {defaults.map((e) => <button key={e} type="button" role="option" aria-selected="false" onClick={() => { choose(e); onClose?.() }}>{e}</button>)}
      {favs.fav.length > 0 && <i className="rx-sep" aria-hidden />}
      {favs.fav.map((e) => <button key={e} type="button" role="option" aria-selected="false" className="fav" title="De los que más usas" onClick={() => { choose(e); onClose?.() }}>{e}</button>)}
      <button ref={plus} type="button" className="rx-plus" aria-label="Más emojis" title="Buscar otro emoji" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Plus size={16} /></button>
      {open && createPortal(
        <div ref={pop} className="rx-pop" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
          <EmojiPicker dark={dark} onPick={(e) => { choose(e); setOpen(false); onClose?.() }} />
        </div>, document.body)}
    </div>
  )
}

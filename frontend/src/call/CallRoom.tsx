import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, Check, Hand, Info, LayoutGrid, MessageSquare, Mic, MicOff, Minimize, Maximize, MonitorUp, MonitorOff, MoreVertical, PanelRight, PhoneOff, PictureInPicture2, Plus, Settings, Smile, Users, Video, VideoOff, X } from 'lucide-react'
import type { User } from '../api'
import { useRealtime } from '../realtime'
import { callUrl, type Part } from './api'
import { EmojiPicker } from '../components/EmojiPicker'
import { useEmojiFavorites } from '../components/emojiFavorites'
import { CALL_EMOJI_KEY, DEFAULT_REACTIONS } from './emoji'
import { callSounds } from './sounds'
import { captionsSupported, type CallApi } from './useCall'
import type { LocalMedia } from './useLocalMedia'
import { useSpeaking } from './useSpeaking'
import Tile from './Tile'
import { ChatPanel, InfoPanel, PeoplePanel } from './Panels'

type Panel = 'info' | 'people' | 'chat' | null
type Layout = 'auto' | 'tiles' | 'spotlight' | 'sidebar'
type Menu = 'react' | 'more' | 'settings' | null

const LAYOUTS: { id: Layout; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automático', hint: 'Se adapta a lo que pasa' },
  { id: 'tiles', label: 'Mosaico', hint: 'Todas las personas del mismo tamaño' },
  { id: 'spotlight', label: 'Destacado', hint: 'Una persona grande, el resto abajo' },
  { id: 'sidebar', label: 'Barra lateral', hint: 'Una persona grande, el resto a un lado' },
]
const LANGS = [['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['en-US', 'English (US)'], ['pt-BR', 'Português (Brasil)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano']]

interface Item { key: string; conn: string; part: Part; local: boolean; stream: MediaStream | null; video: boolean; presentation: boolean }

const two = (n: number) => String(n).padStart(2, '0')
function elapsed(from: number, now: number) {
  const s = Math.max(0, Math.floor((now - from) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

/** La llamada en marcha: mosaico, barra de controles y paneles laterales, con la misma disposición que Google Meet. */
export default function CallRoom({ call, media, user, roomCode }: { call: CallApi; media: LocalMedia; user: User; roomCode: string }) {
  const { state, me, myPart, isHost, companion } = call
  const [panel, setPanel] = useState<Panel>(null)
  const [layout, setLayout] = useState<Layout>('auto')
  const [pinned, setPinned] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [now, setNow] = useState(Date.now())
  const [unread, setUnread] = useState(0)
  const [full, setFull] = useState(!!document.fullscreenElement)
  const [activeConn, setActiveConn] = useState<string | null>(null)
  const favs = useEmojiFavorites(CALL_EMOJI_KEY, DEFAULT_REACTIONS)
  const [allEmojis, setAllEmojis] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  useEffect(() => { if (panel === 'chat') setUnread(0) }, [panel])
  useRealtime('chat.message', (d: { conv: string; message: { authorId: string | null; kind: string } }) => {
    if (state?.conversationId && d.conv === state.conversationId && panel !== 'chat' && d.message.authorId !== user.id && d.message.kind !== 'SYSTEM') setUnread((n) => n + 1)
  })

  // sonidos: alguien entra, alguien sale, alguien levanta la mano (lo propio no suena)
  const seen = useRef<{ conns: Set<string>; hands: Set<string> } | null>(null)
  useEffect(() => {
    if (!state) return
    const conns = new Set(state.parts.map((p) => p.conn))
    const hands = new Set(state.parts.filter((p) => p.hand).map((p) => p.conn))
    const prev = seen.current
    seen.current = { conns, hands }
    if (!prev) { callSounds.enter(); return } // la primera foto de la llamada: suena que tú entraste, no los demás
    const joined = [...conns].some((c) => !prev.conns.has(c) && c !== me)
    const left = [...prev.conns].some((c) => !conns.has(c) && c !== me)
    const raised = [...hands].some((c) => !prev.hands.has(c) && c !== me)
    if (joined) callSounds.join()
    else if (left) callSounds.leave()
    if (raised) setTimeout(() => callSounds.hand(), joined || left ? 450 : 0)
  }, [state, me])

  // atajos como los de Meet: Ctrl+D micrófono, Ctrl+E cámara
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (e.key === 'd') { e.preventDefault(); void call.toggleMic() }
      else if (e.key === 'e') { e.preventDefault(); void call.toggleCam() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [call])
  useEffect(() => {
    if (!menu) return
    if (menu === 'react') return // la barra de reacciones solo se cierra con su botón
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [menu])

  const localStream = useMemo(() => (media.videoTrack ? new MediaStream([media.videoTrack]) : null), [media.videoTrack])
  const localAudio = useMemo(() => (media.audioTrack ? new MediaStream([media.audioTrack]) : null), [media.audioTrack])

  // ---- qué se ve ----
  const parts = state?.parts ?? []
  const items: Item[] = useMemo(() => parts.map((p) => {
    const local = p.conn === me
    return { key: p.conn, conn: p.conn, part: p, local, stream: local ? localStream : call.remoteCam(p), video: p.cam && (local ? !!localStream : true), presentation: false }
  }), [parts, me, localStream, call])
  const shows: Item[] = useMemo(() => parts.filter((p) => p.screen).map((p) => {
    const local = p.conn === me
    return { key: `${p.conn}:screen`, conn: p.conn, part: p, local, stream: local ? call.screen : call.remoteScreen(p), video: true, presentation: true }
  }), [parts, me, call])

  const audioStreams = useMemo(() => {
    const m: Record<string, MediaStream | null> = { [me]: media.mic ? localAudio : null }
    for (const p of parts) if (p.conn !== me) m[p.conn] = call.remoteCam(p)
    return m
  }, [parts, me, media.mic, localAudio, call])
  const speaking = useSpeaking(audioStreams)

  // la persona que habla pasa a ser la principal (con un poco de retraso para que no salte)
  useEffect(() => {
    const who = [...speaking].find((c) => c !== me)
    if (!who) return
    const t = setTimeout(() => setActiveConn(who), 900)
    return () => clearTimeout(t)
  }, [speaking, me])

  useEffect(() => { if (pinned && !parts.some((p) => p.conn === pinned || `${p.conn}:screen` === pinned)) setPinned(null) }, [parts, pinned])

  const all = [...shows, ...items]
  const remoteItems = items.filter((i) => !i.local)
  const selfItem = items.find((i) => i.local)
  const mode: Layout | 'duo' = layout === 'auto' ? (shows.length ? 'sidebar' : items.length === 2 ? 'duo' : 'tiles') : layout
  const main: Item | undefined =
    all.find((i) => i.key === pinned) ??
    shows[0] ??
    items.find((i) => i.conn === activeConn && !i.local) ??
    remoteItems[0] ?? selfItem
  const others = all.filter((i) => i !== main)
  const cols = items.length <= 1 ? 1 : items.length <= 4 ? 2 : items.length <= 9 ? 3 : 4

  const tile = (i: Item, extra: { className?: string } = {}) => (
    <Tile key={i.key} name={i.part.name} userId={i.part.userId} stream={i.stream} video={i.video} mic={i.part.mic} local={i.local} speaking={speaking.has(i.conn) && !i.presentation}
      hand={!!i.part.hand && !i.presentation} host={i.part.host} companion={i.part.companion} silent={companion || i.presentation || i.local} speakerId={media.speakerId}
      presentation={i.presentation} pinned={pinned === i.key} onPin={all.length > 1 ? () => setPinned((p) => (p === i.key ? null : i.key)) : undefined} className={extra.className} />
  )

  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => {}) }
  const pip = () => {
    const v = root.current?.querySelector<HTMLVideoElement>('.call-main .ct:not(.off) video:not(.off)')
    if (v && document.pictureInPictureEnabled) void v.requestPictureInPicture().catch(() => {})
    setMenu(null)
  }

  const toggle = (p: Exclude<Panel, null>) => { setMenu(null); setPanel((cur) => (cur === p ? null : p)) }
  const lobby = state?.lobby ?? []
  const hands = parts.filter((p) => p.hand).length

  if (!state) return null
  return (
    <div className="call-root room" ref={root} onClick={() => menu && menu !== 'react' && setMenu(null)}>
      <div className={`call-stage ${panel ? 'with-panel' : ''}`} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea, label, .call-lobby, .call-caps, .react-bar')) toggleFull() }}>
        <div className={`call-grid mode-${mode}`} style={{ ['--cols' as string]: cols }}>
          {mode === 'tiles' && all.map((i) => tile(i))}
          {mode === 'duo' && main && (
            <>
              <div className="call-main">{tile(main)}</div>
              {selfItem && main !== selfItem && <div className="call-float">{tile(selfItem)}</div>}
            </>
          )}
          {(mode === 'spotlight' || mode === 'sidebar') && main && (
            <>
              <div className="call-main">{tile(main)}</div>
              <div className="call-strip">{others.map((i) => tile(i))}</div>
            </>
          )}
        </div>

        <div className="call-reactions" aria-hidden>
          {call.reactions.map((r) => (
            <div key={r.id} className="call-react" style={{ left: `${r.left}%` }}><span>{r.emoji}</span><small>{r.name}</small></div>
          ))}
        </div>

        {call.showCaptions && (
          <div className="call-caps" aria-live="polite">
            {Object.values(call.captions).sort((a, b) => a.at - b.at).slice(-3).map((c) => <p key={c.name + c.at.toString().slice(0, -3)}><strong>{c.name}</strong> {c.text}</p>)}
            {Object.keys(call.captions).length === 0 && <p className="dim">{parts.some((p) => p.cc) ? 'Subtítulos activados: habla y aparecerán aquí' : 'Esperando a que alguien tenga activados los subtítulos'}</p>}
          </div>
        )}

        {isHost && lobby.length > 0 && (
          <div className="call-lobby" role="alertdialog" aria-label="Personas que esperan">
            {lobby.slice(0, 3).map((w) => (
              <div key={w.conn} className="call-ask">
                <strong>{w.name}</strong> quiere unirse a la llamada
                <div><button onClick={() => call.admit(w.conn, false)}>Rechazar</button><button className="ok" onClick={() => call.admit(w.conn, true)}>Admitir</button></div>
              </div>
            ))}
            {lobby.length > 1 && <button className="call-ask-all" onClick={() => lobby.forEach((w) => call.admit(w.conn, true))}>Admitir a todos ({lobby.length})</button>}
          </div>
        )}
      </div>

      {panel && (
        <aside className="call-panel" aria-label={panel === 'chat' ? 'Chat de la llamada' : panel === 'people' ? 'Personas' : 'Información de la llamada'}>
          <header><h2>{panel === 'chat' ? 'Chat de la llamada' : panel === 'people' ? 'Personas' : 'Información'}</h2><button onClick={() => setPanel(null)} aria-label="Cerrar"><X size={18} /></button></header>
          {panel === 'people' && <PeoplePanel call={call} />}
          {panel === 'info' && <InfoPanel call={call} roomCode={roomCode} />}
          {panel === 'chat' && <ChatPanel call={call} roomCode={roomCode} user={user} />}
        </aside>
      )}

      <footer className="call-bar" onClick={(e) => e.stopPropagation()}>
        <div className="call-bar-l"><span className="mono">{elapsed(state.startedAt, now)}</span><i /><span className="call-code">{state.code}</span></div>

        <div className="call-bar-c">
          {menu === 'react' && (
            <div className="react-bar" role="menu" aria-label="Reacciones">
              {allEmojis && (
                <div className="react-all"><EmojiPicker dark onPick={(e) => { call.react(e); favs.used(e) }} /></div>
              )}
              <div className="react-row">
                {DEFAULT_REACTIONS.map((e) => <button key={e} role="menuitem" className="react-emo" aria-label={`Reaccionar con ${e}`} onClick={() => { call.react(e); favs.used(e) }}>{e}</button>)}
                {favs.fav.length > 0 && <i className="react-sep" aria-hidden />}
                {favs.fav.map((e) => <button key={e} role="menuitem" className="react-emo fav" title="De los que más usas" aria-label={`Reaccionar con ${e}`} onClick={() => { call.react(e); favs.used(e) }}>{e}</button>)}
                <button type="button" className={`react-emo more ${allEmojis ? 'on' : ''}`} aria-label="Más emojis" title="Todos los emojis" aria-pressed={allEmojis} onClick={() => setAllEmojis((v) => !v)}><Plus size={18} /></button>
              </div>
            </div>
          )}
          <button className={`cbtn ${media.mic && !companion ? '' : 'off'}`} disabled={companion} onClick={() => void call.toggleMic()} aria-label={media.mic ? 'Silenciar micrófono' : 'Activar micrófono'} title={companion ? 'Modo complementario: sin micrófono' : 'Micrófono (Ctrl+D)'}>
            {media.mic && !companion ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button className={`cbtn ${media.cam ? '' : 'off'}`} onClick={() => void call.toggleCam()} aria-label={media.cam ? 'Apagar cámara' : 'Encender cámara'} title="Cámara (Ctrl+E)">
            {media.cam ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <button className={`cbtn ${call.showCaptions ? 'on' : ''}`} onClick={() => call.toggleCaptions()} aria-pressed={call.showCaptions} aria-label="Subtítulos" title={captionsSupported() ? 'Subtítulos' : 'Subtítulos (este navegador solo puede mostrar los de otras personas)'}>
            <Captions size={20} />
          </button>
          <button className={`cbtn ${menu === 'react' ? 'on' : ''}`} onClick={() => { if (menu !== 'react') { favs.open(); setAllEmojis(false) } setMenu(menu === 'react' ? null : 'react') }} aria-expanded={menu === 'react'} aria-label="Reacciones" title="Enviar una reacción"><Smile size={20} /></button>
          <button className={`cbtn ${call.screen ? 'on' : ''}`} onClick={() => (call.screen ? call.stopScreen() : void call.startScreen())} aria-pressed={!!call.screen} aria-label={call.screen ? 'Dejar de presentar' : 'Presentar pantalla'} title={call.screen ? 'Dejar de presentar' : 'Presentar ahora'}>
            {call.screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
          </button>
          <button className={`cbtn ${myPart?.hand ? 'on hand' : ''}`} onClick={() => { if (!myPart?.hand) callSounds.hand(); call.toggleHand() }} aria-pressed={!!myPart?.hand} aria-label={myPart?.hand ? 'Bajar la mano' : 'Levantar la mano'} title={myPart?.hand ? 'Bajar la mano' : 'Levantar la mano'}>
            <Hand size={20} />
          </button>
          <div className="cmenu-wrap">
            <button className={`cbtn ${menu === 'more' ? 'on' : ''}`} onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="Más opciones" title="Más opciones"><MoreVertical size={20} /></button>
            {menu === 'more' && (
              <div className="cmenu more" role="menu">
                <div className="cmenu-h">Disposición</div>
                {LAYOUTS.map((l) => (
                  <button key={l.id} role="menuitemradio" aria-checked={layout === l.id} onClick={() => { setLayout(l.id); setMenu(null) }}>
                    <LayoutGrid size={16} /><span>{l.label}<small>{l.hint}</small></span>{layout === l.id && <Check size={15} />}
                  </button>
                ))}
                <hr />
                <button role="menuitem" onClick={() => { toggleFull(); setMenu(null) }}>{full ? <Minimize size={16} /> : <Maximize size={16} />}<span>{full ? 'Salir de pantalla completa' : 'Pantalla completa'}</span></button>
                {document.pictureInPictureEnabled && <button role="menuitem" onClick={pip}><PictureInPicture2 size={16} /><span>Pantalla en pantalla</span></button>}
                <button role="menuitemcheckbox" aria-checked={companion} onClick={() => { void call.setCompanion(!companion); setMenu(null) }}>
                  <PanelRight size={16} /><span>Modo complementario<small>Sin micrófono ni altavoz, para usar junto a una sala</small></span>{companion && <Check size={15} />}
                </button>
                <button role="menuitem" onClick={() => setMenu('settings')}><Settings size={16} /><span>Configuración</span></button>
              </div>
            )}
            {menu === 'settings' && (
              <div className="cmenu settings" role="dialog" aria-label="Configuración">
                <div className="cmenu-h">Dispositivos y subtítulos</div>
                <label>Micrófono
                  <select value={media.micId} onChange={(e) => void media.pickMic(e.target.value)}>
                    <option value="">Predeterminado</option>
                    {media.devices.mics.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micrófono'}</option>)}
                  </select>
                </label>
                <label>Cámara
                  <select value={media.camId} onChange={(e) => void media.pickCam(e.target.value)}>
                    <option value="">Predeterminada</option>
                    {media.devices.cams.filter((d) => d.deviceId).map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Cámara'}</option>)}
                  </select>
                </label>
                {media.devices.speakers.length > 0 && (
                  <label>Altavoz
                    <select value={media.speakerId} onChange={(e) => media.pickSpeaker(e.target.value)}>
                      <option value="">Predeterminado</option>
                      {media.devices.speakers.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Altavoz'}</option>)}
                    </select>
                  </label>
                )}
                <label>Idioma de los subtítulos
                  <select value={call.ccLang} onChange={(e) => call.setLang(e.target.value)}>
                    {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    {!LANGS.some(([v]) => v === call.ccLang) && <option value={call.ccLang}>{call.ccLang}</option>}
                  </select>
                </label>
                <button className="cmenu-done" onClick={() => setMenu(null)}>Listo</button>
              </div>
            )}
          </div>
          <button className="cbtn hang" onClick={() => { callSounds.exit(); call.leave() }} aria-label="Salir de la llamada" title="Salir de la llamada"><PhoneOff size={20} /></button>
        </div>

        <div className="call-bar-r">
          <button className={`cbtn ghost ${panel === 'info' ? 'on' : ''}`} onClick={() => toggle('info')} aria-label="Información de la llamada" title="Información"><Info size={20} /></button>
          <button className={`cbtn ghost ${panel === 'people' ? 'on' : ''}`} onClick={() => toggle('people')} aria-label="Personas" title="Personas">
            <Users size={20} />{(lobby.length > 0 && isHost) ? <b className="cbadge hot">{lobby.length}</b> : hands > 0 ? <b className="cbadge">{hands}</b> : <b className="cbadge soft">{parts.length}</b>}
          </button>
          <button className={`cbtn ghost ${panel === 'chat' ? 'on' : ''}`} onClick={() => toggle('chat')} aria-label="Chat de la llamada" title="Chat">
            <MessageSquare size={20} />{unread > 0 && <b className="cbadge hot">{unread}</b>}
          </button>
        </div>
      </footer>
      <span className="sr-only">{callUrl(state.code)}</span>
    </div>
  )
}

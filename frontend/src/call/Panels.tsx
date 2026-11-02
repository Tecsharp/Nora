import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Hand, Mic, MicOff, MonitorUp, MessageSquarePlus, Send, UserX, VolumeX } from 'lucide-react'
import type { User } from '../api'
import { chatApi, type Message } from '../chat/chatApi'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import Avatar from '../components/Avatar'
import { callApi, callUrl } from './api'
import type { CallApi } from './useCall'

/** Personas en la llamada: quién habla, quién levantó la mano y, para el anfitrión, quién espera y qué se puede hacer con cada una. */
export function PeoplePanel({ call }: { call: CallApi }) {
  const { state, me, isHost } = call
  if (!state) return null
  const parts = [...state.parts].sort((a, b) => (a.hand && b.hand ? a.hand - b.hand : a.hand ? -1 : b.hand ? 1 : 0))
  return (
    <div className="cp-body">
      {isHost && state.lobby.length > 0 && (
        <section className="cp-sec">
          <h3>Esperando para entrar ({state.lobby.length})</h3>
          {state.lobby.map((w) => (
            <div key={w.conn} className="cp-row">
              <Avatar name={w.name} userId={w.userId} version={0} size={32} />
              <span className="cp-name">{w.name}</span>
              <button className="cp-mini" onClick={() => call.admit(w.conn, false)}>Rechazar</button>
              <button className="cp-mini ok" onClick={() => call.admit(w.conn, true)}>Admitir</button>
            </div>
          ))}
        </section>
      )}
      <section className="cp-sec">
        <h3>En la llamada ({parts.length})</h3>
        {parts.map((p) => (
          <div key={p.conn} className="cp-row">
            <Avatar name={p.name} userId={p.userId} version={0} size={32} />
            <span className="cp-name">{p.name}{p.conn === me ? ' (tú)' : ''}
              <small>{[p.host ? 'Anfitrión' : '', p.companion ? 'Complemento' : '', p.screen ? 'Presentando' : ''].filter(Boolean).join(' · ')}</small>
            </span>
            {p.screen && <MonitorUp size={15} className="cp-ico" />}
            {p.hand && <Hand size={15} className="cp-ico hand" />}
            {p.mic ? <Mic size={15} className="cp-ico" /> : <MicOff size={15} className="cp-ico dim" />}
            {isHost && p.conn !== me && (
              <span className="cp-acts">
                {p.hand && <button className="cp-mini" title="Bajar la mano" onClick={() => call.host('lowerHand', { conn: p.conn })}><Hand size={13} /></button>}
                {p.mic && <button className="cp-mini" title="Silenciar" onClick={() => call.host('mute', { conn: p.conn })}><VolumeX size={13} /></button>}
                <button className="cp-mini bad" title="Sacar de la llamada" onClick={() => call.host('remove', { conn: p.conn })}><UserX size={13} /></button>
              </span>
            )}
          </div>
        ))}
        {isHost && parts.length > 1 && <button className="cp-wide" onClick={() => call.host('muteAll')}><VolumeX size={15} /> Silenciar a todos</button>}
      </section>
    </div>
  )
}

/** Datos de la llamada, quién entra y cómo terminarla. */
export function InfoPanel({ call, roomCode }: { call: CallApi; roomCode: string }) {
  const { state, isHost } = call
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  if (!state) return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(callUrl(state.code)); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { toast('No se pudo copiar', 'warning') }
  }
  return (
    <div className="cp-body">
      <section className="cp-sec">
        <h3>{state.title || 'Llamada'}</h3>
        <p className="cp-muted">Comparte este código o enlace con las personas de la sala. Solo entran quienes pertenecen a ella.</p>
        <div className="cp-code"><code>{state.code}</code><button className="cp-mini" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar enlace'}</button></div>
      </section>
      <section className="cp-sec">
        <h3>Acceso</h3>
        {isHost ? (
          <div className="cp-seg">
            <button className={state.access === 'HOST' ? 'on' : ''} onClick={() => call.host('access', { access: 'HOST' })}>El anfitrión admite</button>
            <button className={state.access === 'OPEN' ? 'on' : ''} onClick={() => call.host('access', { access: 'OPEN' })}>Entran directamente</button>
          </div>
        ) : <p className="cp-muted">{state.access === 'HOST' ? 'El anfitrión decide quién entra.' : 'Las personas de la sala entran directamente.'}</p>}
      </section>
      <section className="cp-sec">
        <h3>Chat de la llamada</h3>
        {state.conversationId
          ? <button className="cp-wide" onClick={() => window.open(`/room/${roomCode}?tool=chat&conv=${state.conversationId}`, '_blank', 'noopener')}><ExternalLink size={15} /> Abrir en Mensajes</button>
          : <p className="cp-muted">Aún no hay chat. Créalo desde la pestaña Chat para que quede en Mensajes después de la llamada.</p>}
      </section>
      {isHost && (
        <section className="cp-sec">
          <button className="cp-wide bad" onClick={() => call.host('end')}>Terminar la llamada para todos</button>
        </section>
      )}
    </div>
  )
}

/** El chat de la llamada es un grupo de Mensajes: lo que se escribe aquí queda en la sala cuando termina la llamada. */
export function ChatPanel({ call, roomCode, user }: { call: CallApi; roomCode: string; user: User }) {
  const conv = call.state?.conversationId ?? null
  const toast = useToast()
  const [items, setItems] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!conv) { setItems([]); return }
    let alive = true
    chatApi.messages(roomCode, conv, undefined, 100).then((l) => { if (alive) setItems(l) }).catch(() => {})
    chatApi.read(roomCode, conv).catch(() => {})
    return () => { alive = false }
  }, [conv, roomCode])

  useRealtime('chat.message', (d: { conv: string; message: Message }) => {
    if (!conv || d.conv !== conv) return
    setItems((l) => (l.some((m) => m.id === d.message.id) ? l : [...l, d.message]))
    chatApi.read(roomCode, conv).catch(() => {})
  })
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items.length])

  const create = useCallback(async () => {
    setBusy(true)
    try { await callApi.chat(call.state!.code) } catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
  }, [call.state, toast])

  const submit = async () => {
    const t = text.trim()
    if (!t || !conv) return
    setText('')
    try { await chatApi.send(roomCode, conv, t) } catch (e) { toast((e as Error).message, 'error'); setText(t) }
  }

  if (!conv) {
    return (
      <div className="cp-body cp-empty">
        <MessageSquarePlus size={34} />
        <h3>Chat de la llamada</h3>
        <p>Crea un chat para escribirse durante la llamada. Se guarda como un grupo en <strong>Mensajes</strong> con quienes están ahora aquí, y se agrega a quien entre después.</p>
        <button className="cp-wide ok" disabled={busy} onClick={() => void create()}>{busy ? 'Creando…' : 'Crear chat de la llamada'}</button>
      </div>
    )
  }
  return (
    <div className="cp-chat">
      <div className="cp-msgs">
        {items.length === 0 && <p className="cp-muted center">Todavía no hay mensajes.</p>}
        {items.map((m) => m.kind === 'SYSTEM'
          ? <div key={m.id} className="cp-sys">{m.text}</div>
          : (
            <div key={m.id} className={`cp-msg ${m.authorId === user.id ? 'mine' : ''}`}>
              {m.authorId !== user.id && <strong>{m.authorName}</strong>}
              <span>{m.text}</span>
              <time>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          ))}
        <div ref={end} />
      </div>
      <form className="cp-compose" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje" maxLength={2000} aria-label="Mensaje de la llamada" />
        <button type="submit" disabled={!text.trim()} aria-label="Enviar"><Send size={17} /></button>
      </form>
    </div>
  )
}

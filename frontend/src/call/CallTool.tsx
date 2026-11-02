import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Link2, Lock, LogIn, PhoneCall, ShieldCheck, Users, Video } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { callApi, callUrl, normalizeCode, type CallInfo } from './api'
import { useRoomCalls } from './useRoomCalls'
import { useBusy } from '../useBusy'
import { ago } from '../notifications'

/** La herramienta Llamadas: empezar una llamada o videollamada con código, entrar a una abierta y ver las últimas. */
export default function CallTool({ room }: { room: Room }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { active, upcoming, recent, loaded, refresh } = useRoomCalls(room.code)
  const [title, setTitle] = useState('')
  const [access, setAccess] = useState<'HOST' | 'OPEN'>('HOST')
  const { run, busy: isBusy } = useBusy()
  const busy = isBusy('start')
  const [code, setCode] = useState('')

  // un doble clic abriría dos pestañas: el candado deja pasar solo el primero
  const start = () => run('start', async () => {
    // la pestaña se abre en el gesto del clic (si no, el navegador la bloquea) y después se le pone la dirección
    const w = window.open('about:blank', '_blank')
    try {
      const c = await callApi.create(room.code, { title: title.trim(), access })
      setTitle('')
      void refresh()
      if (w) w.location.href = `/call/${c.code}`
      else navigate(`/call/${c.code}`)
    } catch (e) {
      w?.close()
      toast((e as Error).message, 'error')
    }
  })

  const enter = (e: React.FormEvent) => {
    e.preventDefault()
    const c = normalizeCode(code)
    if (c) window.open(`/call/${c}`, '_blank')
  }

  const end = async (c: CallInfo) => {
    try { await callApi.end(c.code); void refresh() } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="calls">
      <section className="calls-new">
        <div className="calls-new-ico"><Video size={26} /></div>
        <div className="calls-new-body">
          <h2>Iniciar una llamada</h2>
          <p>Voz o videollamada con las personas de esta sala: pantalla compartida, reacciones, mano levantada, subtítulos y un chat que queda en Mensajes.</p>
          <div className="calls-form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)" maxLength={80} aria-label="Título de la llamada" onKeyDown={(e) => { if (e.key === 'Enter') void start() }} />
            <div className="seg" role="radiogroup" aria-label="Quién entra">
              <button role="radio" aria-checked={access === 'HOST'} className={access === 'HOST' ? 'on' : ''} onClick={() => setAccess('HOST')}><Lock size={14} /> Yo admito a cada persona</button>
              <button role="radio" aria-checked={access === 'OPEN'} className={access === 'OPEN' ? 'on' : ''} onClick={() => setAccess('OPEN')}><ShieldCheck size={14} /> Entran directamente</button>
            </div>
            <button className="btn primary" disabled={busy} onClick={() => void start()}><PhoneCall size={16} /> {busy ? 'Creando…' : 'Iniciar llamada'}</button>
          </div>
        </div>
      </section>

      <form className="calls-join" onSubmit={enter}>
        <LogIn size={16} />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Unirse con un código (abc-defg-hij)" aria-label="Código de llamada" />
        <button className="btn sm" disabled={!normalizeCode(code)}>Unirse</button>
      </form>

      <section className="calls-list">
        <h3>En curso {active.length > 0 && <span className="calls-count">{active.length}</span>}</h3>
        {loaded && active.length === 0 && <p className="calls-empty">No hay ninguna llamada abierta ahora mismo.</p>}
        {active.map((c) => (
          <article key={c.code} className="calls-item on-air">
            <span className="calls-dot" aria-hidden />
            <div className="calls-info">
              <strong>{c.title || 'Llamada'}</strong>
              <small><Users size={12} /> {c.count > 0 ? c.people.join(', ') : 'Nadie dentro todavía'} · <Link2 size={12} /> <code>{c.code}</code></small>
            </div>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(callUrl(c.code)).then(() => toast('Enlace copiado', 'success'))}>Copiar enlace</button>
            {(c.hostId === user?.id || room.isOwner) && <button className="btn sm danger" onClick={() => void end(c)}>Terminar</button>}
            <a className="btn sm primary" href={`/call/${c.code}`} target="_blank" rel="noreferrer">Unirse</a>
          </article>
        ))}
      </section>

      {upcoming.length > 0 && (
        <section className="calls-list">
          <h3>Programadas desde el calendario</h3>
          {upcoming.map((c) => (
            <article key={c.code} className="calls-item">
              <Clock size={14} className="calls-ico" />
              <div className="calls-info">
                <strong>{c.title || 'Llamada'}</strong>
                <small>{new Date(c.scheduledAt!).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · <Link2 size={12} /> <code>{c.code}</code></small>
              </div>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(callUrl(c.code)).then(() => toast('Enlace copiado', 'success'))}>Copiar enlace</button>
              <a className="btn sm" href={`/call/${c.code}`} target="_blank" rel="noreferrer">Unirse</a>
            </article>
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section className="calls-list">
          <h3>Últimas llamadas</h3>
          {recent.map((c) => (
            <article key={c.code} className="calls-item">
              <Clock size={14} className="calls-ico" />
              <div className="calls-info"><strong>{c.title || 'Llamada'}</strong><small>Inició {c.hostName} · terminó {c.endedAt ? ago(c.endedAt) : ''}</small></div>
              {c.conversationId && <a className="btn sm ghost" href={`/room/${room.code}?tool=chat&conv=${c.conversationId}`}>Ver chat</a>}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Check, Copy, Download, Hand, MonitorUp, Eye, Share2, ShieldCheck, Plug } from 'lucide-react'
import { api, type Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import { useToast } from '../toast'
import { screenSharingSupported, useAssist } from './AssistProvider'

const DOWNLOADS = [
  { os: 'Windows', key: 'windows', file: 'nora-agent-windows.exe' },
  { os: 'macOS', key: 'macos', file: 'nora-agent-macos.zip' },
  { os: 'Linux', key: 'linux', file: 'nora-agent-linux' },
]

export default function AssistTool({ room, online }: { room: Room; online: Set<string> }) {
  const { user } = useAuth()
  const toast = useToast()
  const { sessions, agent, agents, ask, share } = useAssist()
  const [code, setCode] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})
  useEffect(() => {
    // El enlace sale del .env (p. ej. las Releases de GitHub); si no hay, se usa el archivo de agent/dist/ del propio servidor, si existe.
    api<Record<string, string>>('/assist/agent/downloads').catch(() => ({} as Record<string, string>)).then((conf) => {
      DOWNLOADS.forEach((d) => {
        if (conf[d.key]) return setLinks((l) => ({ ...l, [d.key]: conf[d.key]! }))
        fetch(`/downloads/${d.file}`, { method: 'HEAD' }).then((r) => {
          if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) setLinks((l) => ({ ...l, [d.key]: `/downloads/${d.file}` }))
        }).catch(() => undefined)
      })
    })
  }, [])
  const available = DOWNLOADS.filter((d) => links[d.key])
  const supported = screenSharingSupported()
  const others = room.participants.filter((p) => p.userId !== user?.id)

  const newCode = async () => {
    try {
      setCode((await api<{ code: string }>('/assist/agent/code', 'POST')).code)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el código', 'error')
    }
  }

  const [more, setMore] = useState(false) // «vincular otro equipo» cuando ya hay uno conectado
  const [copied, setCopied] = useState(false)
  // La sección del agente solo aparece si hay algo que ofrecer (una descarga) o ya hay uno conectado: no se le pide nada al usuario por gusto.
  const showAgent = available.length > 0 || agent.online
  const steps = !agent.online || more
  const copy = () => { void navigator.clipboard?.writeText(code ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400) }) }

  return (
    <div className="as-wrap">
      {!supported && <p className="as-warn">Este navegador no permite compartir la pantalla. Usa Chrome, Edge, Firefox o Safari en un ordenador.</p>}

      <header className="as-hero">
        <span className="as-hero-ico"><MonitorUp size={24} /></span>
        <h2>Asistencia remota</h2>
        <p>Ve o controla la pantalla de alguien de la sala, siempre con su permiso.</p>
      </header>

      <section className="as-sec">
        <h3 className="as-h">Personas</h3>
        {others.length === 0 && <p className="as-empty">Todavía no hay nadie más en la sala.</p>}
        {others.length > 0 && (
          <ul className="as-list">
            {others.map((p) => {
              const on = online.has(p.userId)
              const busy = sessions.some((s) => s.peer.id === p.userId)
              const hasAgent = agents.has(p.userId)
              const person = { id: p.userId, name: p.displayName }
              return (
                <li key={p.userId} className={`as-person ${on ? '' : 'off'}`}>
                  <Avatar name={p.displayName} online={on} userId={p.userId} version={p.avatarVersion} size={38} />
                  <span className="as-who">
                    <b className="truncate">{p.displayName}</b>
                    <small className={on && hasAgent ? 'ok' : ''}>{!on ? 'Desconectado' : hasAgent ? 'Se le puede controlar' : 'En línea'}</small>
                  </span>
                  <span className="as-acts">
                    <button className="as-btn" disabled={!on || busy || !supported} onClick={() => ask(person, 'view')} title="Pedirle que te enseñe su pantalla"><Eye size={15} /> Ver</button>
                    {hasAgent && <button className="as-btn" disabled={!on || busy || !supported} onClick={() => ask(person, 'control')} title="Pedirle ver y controlar su equipo"><Hand size={15} /> Controlar</button>}
                    <button className="as-btn ghost" disabled={!on || busy || !supported} onClick={() => void share(person)} title="Enseñarle tu pantalla"><Share2 size={15} /> Compartir la mía</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="as-note"><ShieldCheck size={14} /> La otra persona siempre tiene que aceptar y puede cortarlo cuando quiera.</p>
      </section>

      {sessions.length > 0 && (
        <section className="as-sec">
          <h3 className="as-h">Ahora mismo</h3>
          <ul className="as-list">
            {sessions.map((s) => (
              <li key={s.id} className="as-person">
                <span className="as-live"><MonitorUp size={16} /></span>
                <span className="as-who"><b>{s.role === 'viewer' ? `Ves la pantalla de ${s.peer.name}` : `Compartes tu pantalla con ${s.peer.name}`}</b>{s.control === 'granted' && <small className="ok">Con control</small>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showAgent && (
        <section className="as-sec">
          <h3 className="as-h">Que te controlen <span className={`as-state ${agent.online ? 'on' : ''}`}><i /> {agent.online ? `Agente conectado${agent.os ? ` · ${agent.os}` : ''}` : 'Sin agente'}</span></h3>
          {agent.online && !more && (
            <div className="as-ready">
              <Check size={18} /> <span>Tu equipo está listo: quien te lo pida podrá controlarlo cuando aceptes.</span>
              <button className="as-link" onClick={() => setMore(true)}>Vincular otro equipo</button>
            </div>
          )}
          {steps && (
            <ol className="as-steps">
              <li>
                <i>1</i>
                <div><b>Descarga el agente</b>
                  <div className="as-dl">{available.map((d) => <a key={d.key} className="as-btn" href={links[d.key]} download><Download size={15} /> {d.os}</a>)}</div>
                </div>
              </li>
              <li>
                <i>2</i>
                <div><b>Genera un código</b>
                  {code
                    ? <div className="as-code"><code aria-label="Código de vinculación">{code}</code><button className="as-icon" onClick={copy} aria-label="Copiar código" title="Copiar">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
                    : <div className="as-dl"><button className="as-btn" onClick={() => void newCode()}><Plug size={15} /> Generar código</button></div>}
                </div>
              </li>
              <li>
                <i>3</i>
                <div><b>Pégalo en el agente</b><small>Con esta dirección: <code>{window.location.origin}</code></small></div>
              </li>
            </ol>
          )}
        </section>
      )}
    </div>
  )
}

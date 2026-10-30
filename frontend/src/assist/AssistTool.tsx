import { useEffect, useState } from 'react'
import { Download, Hand, MonitorUp, Eye, Share2, ShieldCheck, Plug } from 'lucide-react'
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

  return (
    <div className="assist-tool stack">
      {!supported && <p className="notice warn">Este navegador no permite compartir la pantalla. Usa Chrome, Edge, Firefox o Safari en un ordenador.</p>}

      <section className="stack">
        <h4>Personas de la sala</h4>
        {others.length === 0 && <p className="muted small">Todavía no hay nadie más en la sala. Invítalo con el código de la sala.</p>}
        <div className="assist-people">
          {others.map((p) => {
            const on = online.has(p.userId)
            const busy = sessions.some((s) => s.peer.id === p.userId)
            const hasAgent = agents.has(p.userId)
            const person = { id: p.userId, name: p.displayName }
            return (
              <div key={p.userId} className={`assist-row ${on ? '' : 'off'}`}>
                <Avatar name={p.displayName} online={on} userId={p.userId} version={p.avatarVersion} />
                <span className="truncate assist-name">{p.displayName}{!on && <small> · desconectado</small>}{on && <small className={hasAgent ? 'ok' : ''}>{hasAgent ? ' · agente conectado' : ' · sin agente (solo ver)'}</small>}</span>
                <span className="spacer" />
                <button className="btn sm" disabled={!on || busy || !supported} onClick={() => ask(person, 'view')} title="Pedirle que te enseñe su pantalla"><Eye size={14} /> Ver su pantalla</button>
                <button className="btn sm" disabled={!on || busy || !supported || !hasAgent} onClick={() => ask(person, 'control')} title={hasAgent ? 'Pedirle ver y controlar su equipo' : `${p.displayName} no tiene el agente de Nora conectado: para controlar su equipo debe instalarlo (en Asistencia → Agente de escritorio)`}><Hand size={14} /> Controlar</button>
                <button className="btn sm ghost" disabled={!on || busy || !supported} onClick={() => void share(person)} title="Enseñarle tu pantalla"><Share2 size={14} /> Compartir la mía</button>
              </div>
            )
          })}
        </div>
        <p className="muted small"><ShieldCheck size={14} /> La otra persona siempre tiene que aceptar y puede cortarlo cuando quiera.</p>
      </section>

      {sessions.length > 0 && (
        <section className="stack">
          <h4>Ahora mismo</h4>
          {sessions.map((s) => (
            <div key={s.id} className="assist-row">
              <MonitorUp size={16} />
              <span>{s.role === 'viewer' ? `Estás viendo la pantalla de ${s.peer.name}` : `Compartes tu pantalla con ${s.peer.name}`}{s.control === 'granted' ? ' · con control' : ''}</span>
            </div>
          ))}
        </section>
      )}

      <section className="stack">
        <h4>Agente de escritorio <span className={`badge ${agent.online ? 'green' : ''}`}><i /> {agent.online ? `Conectado${agent.os ? ` (${agent.os})` : ''}` : 'No conectado'}</span></h4>
        <p className="muted">Solo hace falta si quieres que otra persona <strong>controle tu equipo</strong>. Para ver pantallas no.</p>
        <div className="row">
          {available.length > 0
            ? available.map((d) => <a key={d.key} className="btn sm" href={links[d.key]} download><Download size={14} /> {d.os}</a>)
            : <span className="muted small">Descarga no disponible: pídele a quien administra Nora que la añada.</span>}
          <span className="spacer" />
          <button className="btn sm" onClick={() => void newCode()}><Plug size={14} /> Generar código</button>
          {code && <code className="assist-code" aria-label="Código de vinculación">{code}</code>}
        </div>
        {code && <p className="muted small">Ábrelo en el agente junto con <code>{window.location.origin}</code>. Vale 10 minutos.</p>}
      </section>
    </div>
  )
}

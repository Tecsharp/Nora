import { useState } from 'react'
import { Download, Hand, MonitorUp, Eye, Share2, ShieldCheck, Plug } from 'lucide-react'
import { api, type Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import { useToast } from '../toast'
import { screenSharingSupported, useAssist } from './AssistProvider'

const DOWNLOADS = [
  { os: 'Windows', file: 'nora-agent-windows.exe' },
  { os: 'macOS', file: 'nora-agent-macos' },
  { os: 'Linux', file: 'nora-agent-linux' },
]

export default function AssistTool({ room, online }: { room: Room; online: Set<string> }) {
  const { user } = useAuth()
  const toast = useToast()
  const { sessions, agent, agents, ask, share } = useAssist()
  const [code, setCode] = useState<string | null>(null)
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
        <p className="muted small"><ShieldCheck size={14} /> La otra persona siempre tiene que aceptar, elige qué pantalla enseña y puede cortarlo cuando quiera. La imagen va directa entre vuestros navegadores.</p>
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
        <p className="muted small">
          Para <strong>ver</strong> pantallas no necesitas nada más. Para que otra persona pueda <strong>controlar tu equipo</strong> (ratón y teclado) instala este pequeño programa:
          un navegador no puede hacerlo por sí solo. No hace nada hasta que aceptes cada petición de control.
        </p>
        <ol className="assist-steps small">
          <li>Descárgalo: {DOWNLOADS.map((d, i) => <span key={d.os}>{i > 0 && ' · '}<a href={`/downloads/${d.file}`} download><Download size={12} /> {d.os}</a></span>)}</li>
          <li>Pulsa «Generar código» y ejecuta el programa; escribe la dirección de esta Nora y el código.</li>
          <li>Déjalo abierto. Aquí arriba verás «Conectado».</li>
        </ol>
        <div className="row">
          <button className="btn sm" onClick={() => void newCode()}><Plug size={14} /> Generar código</button>
          {code && <code className="assist-code" aria-label="Código de vinculación">{code}</code>}
          {code && <small className="muted">Vale 10 minutos y una sola vez. Dirección: <code>{window.location.origin}</code></small>}
        </div>
        <p className="muted small">En Linux hace falta una sesión X11 (Wayland no permite controlar el equipo). En macOS concede el permiso de Accesibilidad al programa. Al compartir, elige la <strong>pantalla completa</strong> para que se pueda controlar.</p>
      </section>
    </div>
  )
}

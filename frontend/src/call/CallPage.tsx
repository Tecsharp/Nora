import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { callUrl, normalizeCode } from './api'
import { useCall } from './useCall'
import { useLocalMedia } from './useLocalMedia'
import PreJoin from './PreJoin'
import CallRoom from './CallRoom'

/** /call/abc-defg-hij: pantalla completa, fuera del resto de la aplicación. */
export default function CallPage() {
  const params = useParams()
  const code = normalizeCode(params.code ?? '')
  const { user } = useAuth()
  const navigate = useNavigate()
  const media = useLocalMedia()
  const call = useCall(code, media)
  const { phase, info } = call

  useEffect(() => { document.title = `${info?.title || 'Llamada'} · Nora` }, [info])
  // al cerrar la pestaña se avisa de que se sale (el servidor también lo nota al caerse el WebSocket)
  useEffect(() => {
    const on = () => { if (phase === 'joined') call.leave() }
    window.addEventListener('pagehide', on)
    return () => window.removeEventListener('pagehide', on)
  }, [phase, call])

  if (!user) return null
  const back = () => navigate(info?.roomCode ? `/room/${info.roomCode}` : '/')

  if (phase === 'loading') return <div className="call-root center"><p className="cj-msg">Cargando la llamada…</p></div>
  if (phase === 'prejoin' || phase === 'joining') return <div className="call-root"><PreJoin call={call} media={media} user={user} /></div>
  if (phase === 'joined' && info) return <CallRoom call={call} media={media} user={user} roomCode={info.roomCode ?? ''} />

  const screen = (title: string, text: string, actions: React.ReactNode) => (
    <div className="call-root center"><div className="cj-end"><h1>{title}</h1><p>{text}</p><div className="cj-end-actions">{actions}</div></div></div>
  )
  const rejoin = <button className="cj-join" onClick={() => call.setPhase('prejoin')}>Volver a unirte</button>
  const toRoom = <button className="cj-secondary" onClick={back}>Volver a la sala</button>

  switch (phase) {
    case 'waiting':
      return screen('Pidiendo unirse…', `Cuando ${info?.hostName ?? 'el anfitrión'} te deje entrar aparecerás en la llamada.`,
        <button className="cj-secondary" onClick={() => call.leave()}>Cancelar</button>)
    case 'denied': return screen('No te han dejado entrar', 'El anfitrión ha rechazado tu solicitud.', <>{toRoom}</>)
    case 'removed': return screen('Te han sacado de la llamada', 'El anfitrión te ha quitado de la llamada.', <>{toRoom}</>)
    case 'ended': return screen('La llamada terminó', 'Ya no se puede entrar con este código. Si hubo chat, lo tienes en Mensajes.', <>{toRoom}<Link className="cj-link" to="/">Inicio</Link></>)
    case 'left': return screen('Saliste de la llamada', callUrl(code), <>{rejoin}{toRoom}</>)
    default: return screen('No se pudo abrir la llamada', call.error || 'Comprueba el código o que seas de la sala.', <>{toRoom}<Link className="cj-link" to="/">Inicio</Link></>)
  }
}

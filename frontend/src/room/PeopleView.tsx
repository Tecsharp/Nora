import { Check, UserCheck, UserX, X } from 'lucide-react'
import type { JoinRequest, Room } from '../api'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import { ASSIGNABLE, ROLE_HINT, ROLE_LABEL, type RoomRole } from '../roles'

interface Props {
  room: Room
  online: Set<string>
  canAssign: boolean
  requests: JoinRequest[]
  onDecide: (userId: string, approve: boolean) => void
  onRole: (userId: string, role: RoomRole) => void
  onExpel: (userId: string, name: string) => void
}

/** Quién está en la sala: solicitudes pendientes, y la lista de personas con su rol y si están conectadas. */
export default function PeopleView({ room, online, canAssign, requests, onDecide, onRole, onExpel }: Props) {
  const sorted = [...room.participants].sort((a, b) => Number(online.has(b.userId)) - Number(online.has(a.userId)) || a.displayName.localeCompare(b.displayName))
  return (
    <div className="ws-page">
      <header className="ws-page-head">
        <p>{room.participants.length} {room.participants.length === 1 ? 'participante' : 'participantes'} · {sorted.filter((p) => online.has(p.userId)).length} en línea</p>
      </header>

      {requests.length > 0 && (
        <section className="ws-sec" aria-label="Solicitudes de entrada">
          <h3 className="ws-sec-title">Solicitudes de entrada <span className="ws-badge hot">{requests.length}</span></h3>
          <ul className="ws-rows">
            {requests.map((r) => (
              <li key={r.userId} className="ws-row">
                <Avatar name={r.displayName} size={34} />
                <span className="ws-row-main"><b className="truncate">{r.displayName}</b><small>Quiere entrar a la sala</small></span>
                <span className="row nowrap">
                  <button className="btn primary sm" onClick={() => onDecide(r.userId, true)}><UserCheck size={15} /> Aceptar</button>
                  <button className="btn ghost sm" onClick={() => onDecide(r.userId, false)}><X size={15} /> Rechazar</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ws-sec" aria-label="Participantes">
        <ul className="ws-rows">
          {sorted.map((p) => (
            <li key={p.userId} className={`ws-row ${online.has(p.userId) ? '' : 'off'}`}>
              <Avatar name={p.displayName} online={online.has(p.userId)} userId={p.userId} version={p.avatarVersion} size={34} />
              <span className="ws-row-main">
                <b className="truncate">{p.displayName}</b>
                <small>{online.has(p.userId) ? 'En línea' : 'Desconectado'}</small>
              </span>
              <span className={`ws-role ${p.role === 'OWNER' || p.role === 'MODERATOR' ? 'strong' : ''}`} title={ROLE_HINT[p.role]}>{ROLE_LABEL[p.role]}</span>
              {canAssign && p.role !== 'OWNER' ? (
                <Menu label={`Opciones de ${p.displayName}`} items={[
                  { heading: 'Rol en la sala' },
                  ...ASSIGNABLE.map((r) => ({
                    label: `${ROLE_LABEL[r]} · ${ROLE_HINT[r]}`,
                    icon: r === p.role ? <Check size={16} /> : <span style={{ width: 16 }} />,
                    onClick: () => onRole(p.userId, r),
                  })),
                  'separator',
                  { label: 'Expulsar de la sala', icon: <UserX size={16} />, danger: true, onClick: () => onExpel(p.userId, p.displayName) },
                ]} />
              ) : <span style={{ width: 34 }} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

import { useState } from 'react'
import { BellOff, BellRing, Check, Coffee, Pause, Play, RotateCcw, SkipForward, Target, Timer, Users } from 'lucide-react'
import type { Room } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import { canWrite as canWriteIn } from '../roles'
import { fmt, MODE_LABEL, type FocusApi } from './useFocus'

const R = 118
const C = 2 * Math.PI * R

export default function FocusTool({ room, focus }: { room: Room; focus: FocusApi }) {
  const { user } = useAuth()
  const canWrite = canWriteIn(room, user)
  const { state: s, remaining, total, send, sound, setSound } = focus
  const [task, setTask] = useState('')
  const [cfg, setCfg] = useState(false)
  const [edit, setEdit] = useState({ focusMin: s.focusMin, shortMin: s.shortMin, longMin: s.longMin })
  const me = s.members.find((m) => m.userId === user?.id)
  const running = s.status === 'running'
  const progress = total ? 1 - remaining / total : 0
  const people = new Map(room.participants.map((p) => [p.userId, p]))
  const tone = s.mode === 'focus' ? 'focus' : 'rest'

  return (
    <div className={`fc ${tone} ${running ? 'on' : ''}`}>
      <div className="fc-main">
        <div className="seg" role="tablist" aria-label="Modo">
          {(['focus', 'short', 'long'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={s.mode === m} className={s.mode === m ? 'on' : ''} disabled={!canWrite} onClick={() => void send({ action: 'mode', mode: m })}>
              {m === 'focus' ? <Target size={13} /> : <Coffee size={13} />} {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="fc-dial" role="timer" aria-live="off" aria-label={`${MODE_LABEL[s.mode]}: quedan ${fmt(remaining)}`}>
          <svg viewBox="0 0 260 260" aria-hidden>
            <circle className="fc-track" cx="130" cy="130" r={R} />
            <circle className="fc-prog" cx="130" cy="130" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 130 130)" />
          </svg>
          <div className="fc-center">
            <span className="fc-time">{fmt(remaining)}</span>
            <span className="fc-state">{running ? MODE_LABEL[s.mode] : s.status === 'paused' ? 'En pausa' : 'Listo'}</span>
            <span className="fc-cycle" title={`${s.cycle} pomodoros completados`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < s.cycle % 4 || (s.cycle > 0 && s.cycle % 4 === 0 && s.mode === 'long') ? 'done' : ''} />)}</span>
          </div>
        </div>

        {canWrite ? (
          <div className="fc-buttons">
            <button className="icon-btn" aria-label="Reiniciar" title="Reiniciar este periodo" onClick={() => void send({ action: 'reset' })}><RotateCcw size={18} /></button>
            {running
              ? <button className="btn primary fc-go" onClick={() => void send({ action: 'pause' })}><Pause size={20} /> Pausar</button>
              : <button className="btn primary fc-go" onClick={() => void send({ action: 'start' })}><Play size={20} /> {s.status === 'paused' ? 'Reanudar' : 'Empezar'}</button>}
            <button className="icon-btn" aria-label="Saltar al siguiente" title="Saltar al siguiente periodo" onClick={() => void send({ action: 'skip' })}><SkipForward size={18} /></button>
          </div>
        ) : <p className="muted small center-text">Tu rol es de lector: ves el temporizador de la sala, pero no lo controlas.</p>}
        <p className="muted small center-text fc-tip">{running ? 'El temporizador es de toda la sala: cualquiera puede pausarlo.' : 'Todas las personas de la sala ven el mismo temporizador y oyen el aviso al terminar.'}</p>

        <div className="fc-foot">
          <button className="btn ghost sm" onClick={() => setSound(!sound)} aria-pressed={sound}>{sound ? <BellRing size={14} /> : <BellOff size={14} />} Sonido {sound ? 'activado' : 'apagado'}</button>
          {canWrite && <button className="btn ghost sm" onClick={() => { setEdit({ focusMin: s.focusMin, shortMin: s.shortMin, longMin: s.longMin }); setCfg((c) => !c) }}><Timer size={14} /> Duraciones</button>}
        </div>
        {cfg && canWrite && (
          <div className="fc-cfg">
            {([['focusMin', 'Foco', 1, 180], ['shortMin', 'Descanso corto', 1, 60], ['longMin', 'Descanso largo', 1, 120]] as const).map(([k, label, min, max]) => (
              <label key={k} className="stack tight"><span className="small muted">{label} (min)</span>
                <input type="number" min={min} max={max} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Math.max(min, Math.min(max, Number(e.target.value) || min)) })} /></label>
            ))}
            <label className="check"><input type="checkbox" checked={s.auto} onChange={(e) => void send({ action: 'config', ...edit, auto: e.target.checked })} /> Empezar el siguiente periodo solo</label>
            <button className="btn primary sm" onClick={() => { void send({ action: 'config', ...edit, auto: s.auto }); setCfg(false) }}><Check size={14} /> Guardar</button>
          </div>
        )}
      </div>

      <aside className="fc-side">
        <h4><Users size={15} /> Enfocados {s.members.length > 0 && <span className="badge green"><i /> {s.members.length}</span>}</h4>
        {canWrite && (me ? (
          <div className="fc-me">
            <label className="stack tight"><span className="small muted">En qué estás trabajando</span>
              <input defaultValue={me.task} maxLength={80} placeholder="Escribe y pulsa Enter" onKeyDown={(e) => { if (e.key === 'Enter') void send({ action: 'task', task: (e.target as HTMLInputElement).value }) }} onBlur={(e) => { if (e.target.value !== me.task) void send({ action: 'task', task: e.target.value }) }} /></label>
            <button className="btn sm" onClick={() => void send({ action: 'leave' })}>Salir del grupo</button>
          </div>
        ) : (
          <div className="fc-me">
            <input value={task} maxLength={80} placeholder="¿En qué vas a trabajar? (opcional)" onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { void send({ action: 'join', task }); setTask('') } }} />
            <button className="btn primary sm" onClick={() => { void send({ action: 'join', task }); setTask('') }}><Target size={14} /> Unirme al foco</button>
          </div>
        ))}
        <ul className="fc-members">
          {s.members.map((m) => {
            const p = people.get(m.userId)
            return (
              <li key={m.userId} className={running && s.mode === 'focus' ? 'live' : ''}>
                <Avatar name={m.name} userId={m.userId} version={p?.avatarVersion} size={30} />
                <span className="fc-who"><strong>{m.userId === user?.id ? 'Tú' : m.name}</strong><small>{m.task || (running && s.mode === 'focus' ? 'Concentrado/a' : 'Listo/a')}</small></span>
              </li>
            )
          })}
          {!s.members.length && <li className="muted small fc-none">Nadie se ha unido todavía. Unirte avisa al resto de que estás concentrado/a.</li>}
        </ul>
      </aside>
    </div>
  )
}

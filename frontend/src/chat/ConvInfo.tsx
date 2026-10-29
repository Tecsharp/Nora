import { useEffect, useMemo, useState } from 'react'
import { BellOff, Crown, LogOut, MoreHorizontal, Pin, Shield, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import Menu from '../components/Menu'
import Modal from '../components/Modal'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { chatApi, type Conv, type Policy } from './chatApi'
import { ConvAvatar } from './ChatBits'
import { useChat } from './ChatProvider'
import { ColorPicker } from './GroupDialogs'
import { PersonPicker } from './ChatBits'

const POLICY: { v: Policy; label: string }[] = [{ v: 'ALL', label: 'Todas las personas' }, { v: 'ADMINS', label: 'Solo administración' }]

/** Ajustes de una conversación: en un grupo, su nombre, color, permisos y miembros; en cualquiera, silenciar y fijar. */
export default function ConvInfo({ conv, onClose, onGone }: { conv: Conv; onClose?: () => void; onGone?: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const dialogs = useDialogs()
  const chat = useChat()
  const { room, online, patch, refresh } = chat
  const isGroup = conv.kind === 'GROUP'
  const admin = isGroup && conv.role === 'ADMIN'
  const [name, setName] = useState(conv.name ?? '')
  const [description, setDescription] = useState(conv.description)
  const [adding, setAdding] = useState(false)
  useEffect(() => { setName(conv.name ?? ''); setDescription(conv.description) }, [conv.id, conv.name, conv.description])
  const who = useMemo(() => new Map(room.participants.map((p) => [p.userId, p])), [room.participants])
  const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, 'error')

  const save = async (body: Parameters<typeof chatApi.updateGroup>[2]) => {
    try { patch(await chatApi.updateGroup(room.code, conv.id, body)) } catch (e) { fail(e, 'No se pudo guardar'); setName(conv.name ?? ''); setDescription(conv.description) }
  }
  const prefs = async (body: { muted?: boolean; pinned?: boolean }) => {
    try { patch(await chatApi.prefs(room.code, conv.id, body)) } catch (e) { fail(e, 'No se pudo cambiar') }
  }
  const memberAction = async (fn: () => Promise<unknown>, err: string) => { try { await fn(); await refresh() } catch (e) { fail(e, err) } }

  const leave = async () => {
    if (!(await dialogs.confirm({ title: '¿Salir del grupo?', message: 'Dejarás de recibir sus mensajes. Podrás volver si alguien te añade.', confirmLabel: 'Salir', tone: 'danger', icon: 'question' }))) return
    try { await chatApi.removeMember(room.code, conv.id, user!.id); await refresh(); onGone?.() } catch (e) { fail(e, 'No se pudo salir') }
  }
  const destroy = async () => {
    if (!(await dialogs.confirm({ title: '¿Borrar el grupo?', message: 'Se borrarán el grupo y todos sus mensajes para todas las personas. No se puede deshacer.', confirmLabel: 'Borrar grupo', tone: 'danger', icon: 'trash' }))) return
    try { await chatApi.deleteGroup(room.code, conv.id); await refresh(); onGone?.() } catch (e) { fail(e, 'No se pudo borrar') }
  }
  const kick = async (id: string) => {
    const n = who.get(id)?.displayName ?? 'esta persona'
    if (!(await dialogs.confirm({ title: `¿Quitar a ${n}?`, message: 'Dejará de ver el grupo y sus mensajes.', confirmLabel: 'Quitar', tone: 'danger', icon: 'user-x' }))) return
    await memberAction(() => chatApi.removeMember(room.code, conv.id, id), 'No se pudo quitar')
  }

  const candidates = room.participants.filter((p) => !conv.members.some((m) => m.userId === p.userId))
  const canAdd = isGroup && (admin || conv.addPolicy === 'ALL')

  return (
    <div className="cinfo">
      <header className="cinfo-head">
        <ConvAvatar conv={conv} size={72} />
        {admin ? (
          <input className="cinfo-name" value={name} maxLength={80} aria-label="Nombre del grupo" onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name.trim() !== conv.name) void save({ name: name.trim() }); else setName(conv.name ?? '') }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); setName(conv.name ?? ''); e.currentTarget.blur() } }} />
        ) : <h3 className="cinfo-title">{chat.title(conv)}</h3>}
        <span className="muted small">{conv.kind === 'ROOM' ? 'Todas las personas de la sala' : conv.kind === 'DM' ? 'Mensaje directo' : `Grupo · ${conv.members.length} ${conv.members.length === 1 ? 'persona' : 'personas'}`}</span>
        {onClose && <button className="icon-btn cinfo-x" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>}
      </header>

      {isGroup && (
        <section>
          <h4>Descripción</h4>
          {admin
            ? <textarea rows={2} value={description} maxLength={300} placeholder="Para qué es este grupo…" onChange={(e) => setDescription(e.target.value)}
                onBlur={() => { if (description.trim() !== conv.description) void save({ description: description.trim() }) }} onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation() }} />
            : <p className="muted small">{conv.description || 'Sin descripción'}</p>}
          {admin && <><h4>Color</h4><ColorPicker value={conv.color} onChange={(c) => void save({ color: c })} /></>}
        </section>
      )}

      <section>
        <h4>Para ti</h4>
        <label className="switch-row"><span><BellOff size={15} /> Silenciar avisos</span><input type="checkbox" role="switch" checked={conv.muted} onChange={(e) => void prefs({ muted: e.target.checked })} /></label>
        <label className="switch-row"><span><Pin size={15} /> Fijar arriba</span><input type="checkbox" role="switch" checked={conv.pinned} onChange={(e) => void prefs({ pinned: e.target.checked })} /></label>
      </section>

      {isGroup && (
        <section>
          <h4>Permisos {!admin && <small className="muted">(los cambia la administración)</small>}</h4>
          <label className="field row-field">Quién puede escribir
            <select value={conv.postPolicy} disabled={!admin} onChange={(e) => void save({ postPolicy: e.target.value as Policy })}>{POLICY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
          </label>
          <label className="field row-field">Quién puede añadir personas
            <select value={conv.addPolicy} disabled={!admin} onChange={(e) => void save({ addPolicy: e.target.value as Policy })}>{POLICY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
          </label>
        </section>
      )}

      {isGroup && (
        <section>
          <div className="cinfo-sec-head"><h4>Miembros · {conv.members.length}</h4>{canAdd && <button className="btn ghost sm" onClick={() => setAdding(true)}><UserPlus size={14} /> Añadir</button>}</div>
          <ul className="cinfo-members">
            {conv.members.map((m) => {
              const p = who.get(m.userId)
              const me = m.userId === user?.id
              return (
                <li key={m.userId}>
                  <Avatar name={p?.displayName ?? '?'} userId={m.userId} version={p?.avatarVersion} online={online.has(m.userId)} size={32} />
                  <span className="truncate">{p?.displayName ?? 'Alguien'}{me && <small className="muted"> (tú)</small>}</span>
                  {m.role === 'ADMIN' && <span className="badge amber"><Crown size={11} /> Admin</span>}
                  {admin && !me && (
                    <Menu label={`Acciones para ${p?.displayName ?? 'esta persona'}`} trigger={<span className="icon-btn sm"><MoreHorizontal size={16} /></span>} items={[
                      m.role === 'ADMIN'
                        ? { label: 'Quitar administración', icon: <Shield size={16} />, onClick: () => void memberAction(() => chatApi.setRole(room.code, conv.id, m.userId, 'MEMBER'), 'No se pudo cambiar') }
                        : { label: 'Hacer administrador', icon: <Crown size={16} />, onClick: () => void memberAction(() => chatApi.setRole(room.code, conv.id, m.userId, 'ADMIN'), 'No se pudo cambiar') },
                      { label: 'Quitar del grupo', icon: <UserMinus size={16} />, danger: true, onClick: () => void kick(m.userId) },
                    ]} />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {isGroup && (
        <section className="cinfo-danger">
          <button className="btn ghost danger" onClick={() => void leave()}><LogOut size={15} /> Salir del grupo</button>
          {(admin || conv.createdBy === user?.id) && <button className="btn ghost danger" onClick={() => void destroy()}><Trash2 size={15} /> Borrar grupo</button>}
        </section>
      )}

      {adding && (
        <AddMembers candidates={candidates} onClose={() => setAdding(false)} onAdd={async (ids) => {
          try { await chatApi.addMembers(room.code, conv.id, ids); await refresh(); setAdding(false) } catch (e) { fail(e, 'No se pudo añadir') }
        }} />
      )}
    </div>
  )
}

function AddMembers({ candidates, onClose, onAdd }: { candidates: ReturnType<typeof useChat>['room']['participants']; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Añadir personas" icon={<UserPlus size={20} />} onClose={onClose} className="ai-layer" footer={
      <>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={sel.size === 0 || busy} onClick={() => { setBusy(true); void onAdd([...sel]).finally(() => setBusy(false)) }}>Añadir{sel.size ? ` ${sel.size}` : ''}</button>
      </>
    }>
      <PersonPicker people={candidates} selected={sel} onToggle={(id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })} empty="Ya están todas las personas de la sala" />
    </Modal>
  )
}

/** Los ajustes en una ventana (se usan desde el dock, donde no hay panel lateral). */
export function ConvInfoDialog({ conv, onClose }: { conv: Conv; onClose: () => void }) {
  return (
    <Modal title="Ajustes del chat" onClose={onClose} className="ai-layer">
      <ConvInfo conv={conv} onGone={onClose} />
    </Modal>
  )
}

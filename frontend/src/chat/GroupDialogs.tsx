import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import Modal from '../components/Modal'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { chatApi, GROUP_COLORS, type Conv } from './chatApi'
import { PersonPicker } from './ChatBits'
import { useChat } from './ChatProvider'

export function ColorPicker({ value, onChange, disabled }: { value: string | null; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color del grupo">
      {GROUP_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} disabled={disabled} className={value === c ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  )
}

/** Crear un grupo: nombre, color, descripción y las personas de la sala que entran. */
export function NewGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Conv) => void }) {
  const { room, patch } = useChat()
  const { user } = useAuth()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(GROUP_COLORS[0]!)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const people = useMemo(() => room.participants.filter((p) => p.userId !== user?.id), [room.participants, user?.id])
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const c = await chatApi.createGroup(room.code, { name: name.trim(), description: description.trim(), color, members: [...sel] })
      patch(c)
      onCreated(c)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear el grupo', 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title="Nuevo grupo" icon={<Users size={20} />} onClose={onClose} className="ai-layer" footer={
      <>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void create()}>Crear grupo{sel.size ? ` · ${sel.size + 1}` : ''}</button>
      </>
    }>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <label className="field">Nombre
          <input value={name} maxLength={80} autoFocus placeholder="Diseño, Compras, Equipo A…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation() }} />
        </label>
        <label className="field">Descripción <span className="muted small">(opcional)</span>
          <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation() }} />
        </label>
        <div className="field">Color <ColorPicker value={color} onChange={setColor} /></div>
        <div className="field">Personas <span className="muted small">({sel.size} elegidas · solo de esta sala)</span>
          <PersonPicker people={people} selected={sel} onToggle={toggle} empty="Nadie más ha entrado a la sala todavía" />
        </div>
      </form>
    </Modal>
  )
}

/** Mensaje directo nuevo: se elige una sola persona. */
export function NewDmDialog({ onClose, onPick }: { onClose: () => void; onPick: (userId: string) => void }) {
  const { room } = useChat()
  const { user } = useAuth()
  const people = useMemo(() => room.participants.filter((p) => p.userId !== user?.id), [room.participants, user?.id])
  return (
    <Modal title="Nuevo mensaje" icon={<Users size={20} />} onClose={onClose} className="ai-layer">
      <PersonPicker people={people} selected={new Set()} single onToggle={(id) => onPick(id)} empty="Nadie más ha entrado a la sala todavía" />
    </Modal>
  )
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, Info, Pencil, TriangleAlert, Trash2, UserX, type LucideIcon } from 'lucide-react'

export type DialogTone = 'danger' | 'warning' | 'info'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Texto del botón principal (por defecto «Aceptar»). */
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
  icon?: 'trash' | 'user-x' | 'warning' | 'info' | 'question'
  /** Pide escribir esta palabra para poder confirmar (para acciones que no se pueden deshacer). */
  typeToConfirm?: string
  /** Solo informa: un único botón. */
  hideCancel?: boolean
}

export interface PromptOptions {
  title: string
  message?: ReactNode
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  maxLength?: number
  /** Devuelve un mensaje de error si el valor no vale. */
  validate?: (value: string) => string | null
  allowEmpty?: boolean
}

interface Api {
  confirm: (o: ConfirmOptions) => Promise<boolean>
  /** Aviso con un solo botón. */
  notify: (o: Omit<ConfirmOptions, 'hideCancel'>) => Promise<void>
  prompt: (o: PromptOptions) => Promise<string | null>
}

type Pending =
  | { kind: 'confirm'; o: ConfirmOptions; done: (v: boolean) => void }
  | { kind: 'prompt'; o: PromptOptions; done: (v: string | null) => void }

const Ctx = createContext<Api>({ confirm: async () => false, notify: async () => {}, prompt: async () => null })

/** Diálogos de confirmación y de texto con el estilo de Nora (en lugar de los avisos del navegador). */
export const useDialogs = () => useContext(Ctx)

const ICONS: Record<NonNullable<ConfirmOptions['icon']>, LucideIcon> = { trash: Trash2, 'user-x': UserX, warning: TriangleAlert, info: Info, question: CircleHelp }

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([])
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((done) => setQueue((q) => [...q, { kind: 'confirm', o, done }])), [])
  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>((done) => setQueue((q) => [...q, { kind: 'prompt', o, done }])), [])
  const notify = useCallback((o: Omit<ConfirmOptions, 'hideCancel'>) => confirm({ ...o, hideCancel: true, confirmLabel: o.confirmLabel ?? 'Entendido' }).then(() => undefined), [confirm])
  const api = useRef<Api>({ confirm, notify, prompt })
  const current = queue[0]
  const close = (): void => setQueue((q) => q.slice(1))

  return (
    <Ctx.Provider value={api.current}>
      {children}
      {current && createPortal(
        current.kind === 'confirm'
          ? <ConfirmDialog key={queue.length} o={current.o} onDone={(v) => { current.done(v); close() }} />
          : <PromptDialog o={current.o} onDone={(v) => { current.done(v); close() }} />,
        document.body,
      )}
    </Ctx.Provider>
  )
}

function useEscape(cancel: () => void) {
  const ref = useRef(cancel)
  ref.current = cancel
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        e.preventDefault()
        ref.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
    }
  }, [])
}

function Shell({ tone, Icon, title, children, onCancel }: { tone: DialogTone; Icon: LucideIcon; title: string; children: ReactNode; onCancel: () => void }) {
  return (
    <div className="modal-backdrop dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`dlg ${tone}`} role="alertdialog" aria-modal="true" aria-label={title}>
        <span className="dlg-ico"><Icon size={26} /></span>
        <h2 className="dlg-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ConfirmDialog({ o, onDone }: { o: ConfirmOptions; onDone: (v: boolean) => void }) {
  const tone = o.tone ?? 'info'
  const [typed, setTyped] = useState('')
  const ok = !o.typeToConfirm || typed.trim().toLowerCase() === o.typeToConfirm.toLowerCase()
  const cancel = useRef<HTMLButtonElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  useEscape(() => onDone(false))
  useEffect(() => void (tone === 'danger' ? cancel.current : primary.current)?.focus(), [tone])
  const Icon = ICONS[o.icon ?? (tone === 'danger' ? 'trash' : tone === 'warning' ? 'warning' : 'question')]
  return (
    <Shell tone={tone} Icon={Icon} title={o.title} onCancel={() => onDone(false)}>
      {o.message && <div className="dlg-msg">{o.message}</div>}
      {o.typeToConfirm && (
        <label className="dlg-field">
          <span>Escribe <b>{o.typeToConfirm}</b> para confirmar</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus aria-label="Confirmación" />
        </label>
      )}
      <div className="dlg-actions">
        {!o.hideCancel && <button ref={cancel} className="btn" onClick={() => onDone(false)}>{o.cancelLabel ?? 'Cancelar'}</button>}
        <button ref={primary} className={`btn ${tone === 'danger' ? 'danger-solid' : 'primary'}`} disabled={!ok} onClick={() => onDone(true)}>{o.confirmLabel ?? 'Aceptar'}</button>
      </div>
    </Shell>
  )
}

function PromptDialog({ o, onDone }: { o: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(o.initial ?? '')
  const [error, setError] = useState('')
  useEscape(() => onDone(null))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v && !o.allowEmpty) return
    const problem = o.validate?.(v)
    if (problem) return setError(problem)
    onDone(v)
  }
  return (
    <Shell tone="info" Icon={Pencil} title={o.title} onCancel={() => onDone(null)}>
      <form onSubmit={submit} className="dlg-form">
        {o.message && <div className="dlg-msg">{o.message}</div>}
        <label className="dlg-field">
          {o.label && <span>{o.label}</span>}
          <input autoFocus value={value} maxLength={o.maxLength} placeholder={o.placeholder} aria-label={o.label ?? o.title}
            onChange={(e) => { setValue(e.target.value); setError('') }} onFocus={(e) => e.currentTarget.select()} />
        </label>
        {error && <p className="error small" role="alert">{error}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancelar</button>
          <button className="btn primary" disabled={!value.trim() && !o.allowEmpty}>{o.confirmLabel ?? 'Guardar'}</button>
        </div>
      </form>
    </Shell>
  )
}

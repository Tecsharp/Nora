import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlignLeft, Check, ClipboardCopy, Expand, Languages, ListChecks, MessageSquareText, PenLine, RefreshCw, Shrink, Sparkles, SpellCheck, Square, Wand2, FileText, Lightbulb, ArrowDownToLine, Replace } from 'lucide-react'
import Menu, { type MenuItem } from '../components/Menu'
import Modal from '../components/Modal'
import { useToast } from '../toast'
import AiMarkdown from './AiMarkdown'
import { useAi } from './AiProvider'

export interface AiAction {
  id: string
  label: string
  task: string
  icon?: ReactNode
  /** Pide un dato antes de ejecutar: el idioma de destino o una instrucción libre. */
  ask?: 'language' | 'instruction'
  /** Grupo en el menú (se muestra como título). */
  group?: string
}

/** Acciones de texto habituales (mejorar, corregir, traducir…). Cada herramienta puede usar estas u otras suyas. */
export const TEXT_ACTIONS: AiAction[] = [
  { id: 'improve', label: 'Mejorar la redacción', task: 'improve', icon: <Wand2 size={16} />, group: 'Escribir' },
  { id: 'fix', label: 'Corregir ortografía y gramática', task: 'fix', icon: <SpellCheck size={16} /> },
  { id: 'shorten', label: 'Acortar', task: 'shorten', icon: <Shrink size={16} /> },
  { id: 'expand', label: 'Ampliar', task: 'expand', icon: <Expand size={16} /> },
  { id: 'formal', label: 'Tono formal', task: 'formal', icon: <PenLine size={16} /> },
  { id: 'casual', label: 'Tono cercano', task: 'casual', icon: <MessageSquareText size={16} /> },
  { id: 'continue', label: 'Continuar escribiendo', task: 'continue', icon: <AlignLeft size={16} /> },
  { id: 'translate', label: 'Traducir a…', task: 'translate', icon: <Languages size={16} />, ask: 'language', group: 'Entender' },
  { id: 'summarize', label: 'Resumir', task: 'summarize', icon: <FileText size={16} /> },
  { id: 'bullets', label: 'Puntos clave', task: 'bullets', icon: <ListChecks size={16} /> },
  { id: 'explain', label: 'Explicar de forma sencilla', task: 'explain', icon: <Lightbulb size={16} /> },
  { id: 'custom', label: 'Pedir algo distinto…', task: 'custom', icon: <Sparkles size={16} />, ask: 'instruction', group: 'Otro' },
]

export type ApplyMode = 'replace' | 'insert'

interface Props {
  actions?: AiAction[]
  /** Texto sobre el que actúa la IA (puede ser lo seleccionado). */
  getText: () => string | Promise<string>
  /** Si se da, el resultado puede aplicarse al contenido (reemplazar / insertar debajo). Sin esto solo se puede copiar. */
  onApply?: (text: string, mode: ApplyMode) => void
  applyModes?: ApplyMode[]
  /** Texto del botón principal de aplicar (por defecto «Reemplazar»). */
  applyLabel?: string
  /** Título del resultado y etiqueta del botón (por defecto «IA»). */
  label?: string
  title?: string
  disabled?: boolean
  /** Botón solo con el icono. */
  iconOnly?: boolean
}

/**
 * Botón «IA» con su menú de acciones y la ventana donde el resultado va apareciendo en directo. Si la IA no está activada en el servidor
 * no se pinta nada.
 */
export default function AiAssist({ actions = TEXT_ACTIONS, getText, onApply, applyModes = ['replace', 'insert'], applyLabel = 'Reemplazar', label = 'IA', title = 'Asistente de IA', disabled, iconOnly }: Props) {
  const ai = useAi()
  const toast = useToast()
  const [pending, setPending] = useState<AiAction | null>(null) // acción que pide un dato antes de ejecutarse
  const [job, setJob] = useState<{ action: AiAction; input: string; source: string } | null>(null)
  if (!ai.enabled) return null

  const start = async (a: AiAction, input = '') => {
    let source = ''
    try {
      source = await getText()
    } catch {
      return toast('No se pudo leer el texto', 'error')
    }
    if (!source.trim() && a.task !== 'custom' && a.task !== 'continue') return toast('Escribe o selecciona algo de texto primero', 'info')
    setJob({ action: a, input, source })
  }

  const items: MenuItem[] = []
  let group: string | undefined
  for (const a of actions) {
    if (a.group && a.group !== group) {
      if (items.length) items.push('separator')
      items.push({ heading: a.group })
      group = a.group
    }
    items.push({ label: a.label, icon: a.icon, onClick: () => (a.ask ? setPending(a) : void start(a)) })
  }

  return (
    <>
      <span className={`ai-menu ${disabled ? 'off' : ''}`}>
        <Menu label={title} items={disabled ? [{ heading: 'Selecciona algo primero' }] : items}
          trigger={<span className="ai-trigger" title={title}><Sparkles size={15} />{!iconOnly && <span>{label}</span>}</span>} />
      </span>
      {pending && <AskDialog action={pending} onCancel={() => setPending(null)} onOk={(v) => { const a = pending; setPending(null); void start(a, v) }} />}
      {job && <ResultDialog job={job} title={title} onApply={onApply} applyModes={applyModes} applyLabel={applyLabel} onClose={() => setJob(null)} />}
    </>
  )
}

function AskDialog({ action, onCancel, onOk }: { action: AiAction; onCancel: () => void; onOk: (v: string) => void }) {
  const [v, setV] = useState(action.ask === 'language' ? 'inglés' : '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (v.trim()) onOk(v.trim())
  }
  return (
    <Modal title={action.label} icon={<Sparkles size={20} />} onClose={onCancel} className="ai-layer">
      <form className="stack" onSubmit={submit}>
        <label className="stack tight">
          <span className="small">{action.ask === 'language' ? 'Idioma de destino' : '¿Qué quieres que haga con el texto?'}</span>
          {action.ask === 'language'
            ? <input autoFocus value={v} onChange={(e) => setV(e.target.value)} list="ai-langs" maxLength={40} required />
            : <textarea autoFocus rows={3} value={v} onChange={(e) => setV(e.target.value)} maxLength={1500} required placeholder="Por ejemplo: conviértelo en un correo para el cliente" />}
          {action.ask === 'language' && <datalist id="ai-langs">{['inglés', 'español', 'francés', 'alemán', 'italiano', 'portugués', 'chino', 'japonés'].map((l) => <option key={l} value={l} />)}</datalist>}
        </label>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" type="submit"><Sparkles size={15} /> Generar</button>
        </div>
      </form>
    </Modal>
  )
}

function ResultDialog({ job, title, onApply, applyModes, applyLabel, onClose }: { job: { action: AiAction; input: string; source: string }; title: string; onApply?: Props['onApply']; applyModes: ApplyMode[]; applyLabel: string; onClose: () => void }) {
  const ai = useAi()
  const toast = useToast()
  const [text, setText] = useState('')
  const [running, setRunning] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const ctl = useRef<AbortController>()
  const body = useRef<HTMLDivElement>(null)

  const run = useCallback(async () => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setText('')
    setError('')
    setRunning(true)
    try {
      await ai.run(
        { task: job.action.task, text: job.source, language: job.action.ask === 'language' ? job.input : undefined, instruction: job.action.ask === 'instruction' ? job.input : undefined },
        { signal: c.signal, onChunk: (_, full) => setText(full) },
      )
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo usar la IA')
    } finally {
      if (ctl.current === c) setRunning(false)
    }
  }, [ai, job])

  useEffect(() => {
    void run()
    return () => ctl.current?.abort()
  }, [run])
  useEffect(() => { if (running) body.current?.scrollTo({ top: body.current.scrollHeight }) }, [text, running])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }
  const apply = (mode: ApplyMode) => {
    onApply?.(text.trim(), mode)
    onClose()
  }

  return (
    <Modal title={title} icon={<Sparkles size={20} />} onClose={onClose} wide className="ai-layer"
      footer={
        <div className="ai-foot">
          <span className="spacer" />
          {running
            ? <button className="btn" onClick={() => ctl.current?.abort()}><Square size={14} /> Detener</button>
            : <button className="btn ghost" onClick={() => void run()}><RefreshCw size={14} /> Otra vez</button>}
          <button className="btn ghost" disabled={!text || running} onClick={() => void copy()}>{copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Copiado' : 'Copiar'}</button>
          {onApply && applyModes.includes('insert') && <button className="btn" disabled={!text || running} onClick={() => apply('insert')}><ArrowDownToLine size={14} /> Insertar debajo</button>}
          {onApply && applyModes.includes('replace') && <button className="btn primary" disabled={!text || running} onClick={() => apply('replace')}><Replace size={14} /> {applyLabel}</button>}
        </div>
      }>
      <div className="ai-result">
        <div className="ai-action-tag"><Sparkles size={13} /> {job.action.label}{job.input ? `: ${job.input}` : ''}</div>
        <div className={`ai-out ${running ? 'live' : ''}`} ref={body} aria-live="polite">
          {error ? <p className="ai-error">{error}</p> : text ? <AiMarkdown text={text} /> : <p className="muted">Pensando…</p>}
          {running && text && <span className="ai-caret" />}
        </div>
        <p className="muted small ai-note">{ai.model ? `DeepSeek · ${ai.model} · ` : ''}Revisa siempre el resultado antes de usarlo.</p>
      </div>
    </Modal>
  )
}

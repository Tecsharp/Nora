import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Pencil, Presentation, Sheet, Trash2 } from 'lucide-react'
import { api, ApiError, type Room } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useToast } from '../toast'
import type { DocInfo } from '../collab/DocEditor'
import Menu from './Menu'

export interface DocListItem extends DocInfo {
  createdBy: string
  createdByName: string
  updatedAt: string
}

const KINDS = [
  { kind: 'DOC', label: 'Documento', hint: 'Texto con formato', icon: FileText, tone: 'blue', base: 'Documento sin título' },
  { kind: 'SHEET', label: 'Hoja de cálculo', hint: 'Tablas y fórmulas', icon: Sheet, tone: 'teal', base: 'Hoja sin título' },
  { kind: 'SLIDES', label: 'Presentación', hint: 'Diapositivas', icon: Presentation, tone: 'amber', base: 'Presentación sin título' },
] as const

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Documentos, hojas y presentaciones de la sala que se editan entre varias personas a la vez. */
export default function DocsTool({ room, onOpen }: { room: Room; onOpen: (d: DocInfo) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [docs, setDocs] = useState<DocListItem[] | null>(null)
  const [creating, setCreating] = useState('')
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)

  const load = useCallback(() => api<DocListItem[]>(`/rooms/${room.code}/docs`).then(setDocs).catch(() => setDocs([])), [room.code])
  useEffect(() => void load(), [load])
  useRealtime('reconnected', load)
  useRealtime('doc.created', (d: DocListItem) => setDocs((all) => (all && !all.some((x) => x.id === d.id) ? [d, ...all] : all)))
  useRealtime('doc.renamed', (d: DocListItem) => setDocs((all) => all?.map((x) => (x.id === d.id ? { ...x, name: d.name, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.deleted', (d: { id: string }) => setDocs((all) => all?.filter((x) => x.id !== d.id) ?? all))

  async function create(kind: (typeof KINDS)[number]) {
    setCreating(kind.kind)
    try {
      const d = await api<DocListItem>(`/rooms/${room.code}/docs`, 'POST', { kind: kind.kind, name: kind.base })
      onOpen(d)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo crear', 'error')
    } finally {
      setCreating('')
    }
  }

  return (
    <div className="explorer">
      {canWrite ? (
        <div className="composer">
          <span className="eyebrow">Nuevo</span>
          <div className="new-docs">
            {KINDS.map((k) => (
              <button key={k.kind} className="new-doc" disabled={!!creating} onClick={() => void create(k)}>
                <span className={`ico tinted tn-${k.tone}`}>{creating === k.kind ? <Loader2 className="spin-icon" size={20} /> : <k.icon size={20} />}</span>
                <span><strong>{k.label}</strong><span className="muted small block">{k.hint}</span></span>
              </button>
            ))}
          </div>
          <p className="muted small">Para editar un archivo existente (DOCX, ODT, XLSX, ODS, CSV, PPTX, ODP), ábrelo desde <strong>Archivos</strong> con «Editar».</p>
        </div>
      ) : (
        <p className="callout small" style={{ margin: '12px 16px 0' }}>Tu rol en esta sala es de <strong>lector</strong>: puedes abrir los documentos para verlos y descargarlos.</p>
      )}
      <div className="ex-body">
        {docs === null ? <p className="muted">Cargando…</p> : docs.length === 0 ? (
          <div className="empty"><FileText size={36} /><strong>Todavía no hay documentos</strong><span className="small">Crea uno arriba o abre un archivo desde Archivos.</span></div>
        ) : (
          <ul className="list doc-list">
            {docs.map((d) => {
              const k = KINDS.find((x) => x.kind === d.kind)!
              return (
                <li key={d.id} className="doc-row" role="button" tabIndex={0} onClick={() => onOpen(d)} onKeyDown={(e) => e.key === 'Enter' && onOpen(d)}>
                  <span className={`ficon tn-${k.tone}`}><k.icon size={22} /></span>
                  <span className="fbody"><span className="fname truncate">{d.name}</span>
                    <span className="fmeta truncate">{k.label}{d.sourceExt ? ` · desde .${d.sourceExt}` : ''} · {d.createdByName} · {when(d.updatedAt)}</span></span>
                  {(d.createdBy === user?.id || staff) && canWrite && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Menu items={[
                        { label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: async () => {
                          const n = window.prompt('Nuevo nombre', d.name)
                          if (n?.trim()) await api(`/rooms/${room.code}/docs/${d.id}`, 'PATCH', { name: n.trim() }).catch((e) => toast(e.message, 'error'))
                        } },
                        'separator',
                        { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: async () => {
                          if (confirm(`¿Borrar «${d.name}»? Se pierde su contenido (no afecta al archivo original).`)) await api(`/rooms/${room.code}/docs/${d.id}`, 'DELETE').catch((e) => toast(e.message, 'error'))
                        } },
                      ]} />
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

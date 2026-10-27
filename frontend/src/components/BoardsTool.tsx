import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, PenTool, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { api, ApiError, getAccessToken, type Room } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { canWrite as canWriteIn, isStaff as isStaffIn } from '../roles'
import { useToast } from '../toast'
import type { DocInfo } from '../collab/DocEditor'
import Menu from './Menu'

interface BoardItem extends DocInfo {
  createdBy: string
  createdByName: string
  updatedAt: string
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Miniatura de la pizarra: se pide con el token (no hay cabecera en <img>) y se muestra como blob. */
function Thumb({ code, board }: { code: string; board: BoardItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!board.thumbAt) return setUrl(null)
    let alive = true
    let made: string | null = null
    fetch(`/api/rooms/${code}/docs/${board.id}/thumbnail`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!alive || !b) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [code, board.id, board.thumbAt])
  return url ? <img src={url} alt="" className="board-thumb-img" draggable={false} /> : <PenTool size={34} className="board-thumb-empty" />
}

/** Pizarras colaborativas de la sala (galería): crear, importar, abrir, renombrar y borrar. */
export default function BoardsTool({ room, onOpen }: { room: Room; onOpen: (d: DocInfo) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [boards, setBoards] = useState<BoardItem[] | null>(null)
  const [busy, setBusy] = useState('')
  const pick = useRef<HTMLInputElement>(null)
  const canWrite = canWriteIn(room, user)
  const staff = isStaffIn(room, user)

  const load = useCallback(() => api<BoardItem[]>(`/rooms/${room.code}/docs`).then((all) => setBoards(all.filter((d) => d.kind === 'BOARD'))).catch(() => setBoards([])), [room.code])
  useEffect(() => void load(), [load])
  useRealtime('reconnected', load)
  useRealtime('doc.created', (d: BoardItem) => d.kind === 'BOARD' && setBoards((all) => (all && !all.some((x) => x.id === d.id) ? [d, ...all] : all)))
  useRealtime('doc.renamed', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, name: d.name, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.thumb', (d: BoardItem) => setBoards((all) => all?.map((x) => (x.id === d.id ? { ...x, thumbAt: d.thumbAt, updatedAt: d.updatedAt } : x)) ?? all))
  useRealtime('doc.deleted', (d: { id: string }) => setBoards((all) => all?.filter((x) => x.id !== d.id) ?? all))

  async function create() {
    setBusy('Creando…')
    try {
      onOpen(await api<BoardItem>(`/rooms/${room.code}/docs`, 'POST', { kind: 'BOARD', name: 'Pizarra sin título' }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo crear la pizarra', 'error')
    } finally {
      setBusy('')
    }
  }

  /** Importa una pizarra: .excalidraw/.json tal cual; PNG o SVG con la escena incrustada se convierten aquí. */
  async function importFile(file: File) {
    setBusy('Importando…')
    try {
      let blob: Blob = file
      let name = file.name.replace(/\.(excalidraw|json|png|svg)$/i, '')
      if (/\.(png|svg)$/i.test(file.name) || file.type.startsWith('image/')) {
        const { loadFromBlob, serializeAsJSON } = await import('@excalidraw/excalidraw')
        let data
        try {
          data = await loadFromBlob(file, null, null)
        } catch {
          throw new Error('Esa imagen no lleva una pizarra incrustada. Para añadir una imagen, ábrela desde dentro de una pizarra (menú ⋯ → Importar).')
        }
        blob = new Blob([serializeAsJSON(data.elements, data.appState, data.files ?? {}, 'local')], { type: 'application/json' })
      } else {
        const parsed = JSON.parse(await file.text()) as { elements?: unknown }
        if (!Array.isArray(parsed.elements)) throw new Error('No es un archivo de pizarra válido (.excalidraw)')
      }
      const fd = new FormData()
      fd.append('file', new File([blob], `${name || 'Pizarra importada'}.excalidraw`, { type: 'application/json' }))
      const up = await fetch(`/api/rooms/${room.code}/files`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: fd })
      if (!up.ok) throw new ApiError(up.status, (await up.json().catch(() => null))?.message ?? `Error ${up.status}`)
      const f = (await up.json()) as { id: string }
      onOpen(await api<BoardItem>(`/rooms/${room.code}/docs/from-file/${f.id}`, 'POST'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="explorer">
      {canWrite ? (
        <div className="ex-toolbar">
          <button className="btn primary sm" disabled={!!busy} onClick={() => void create()}>{busy === 'Creando…' ? <Loader2 size={15} className="spin-icon" /> : <Plus size={15} />} Nueva pizarra</button>
          <button className="btn sm" disabled={!!busy} onClick={() => pick.current?.click()}>{busy === 'Importando…' ? <Loader2 size={15} className="spin-icon" /> : <Upload size={15} />} Importar…</button>
          <input ref={pick} type="file" hidden accept=".excalidraw,.json,application/json,image/png,image/svg+xml" aria-label="Importar pizarra"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
          <span className="muted small">Importa archivos <b>.excalidraw</b>, o imágenes PNG/SVG exportadas con la escena incrustada.</span>
        </div>
      ) : (
        <p className="callout small" style={{ margin: '12px 16px 0' }}>Tu rol en esta sala es de <strong>lector</strong>: puedes abrir las pizarras para verlas.</p>
      )}
      <div className="ex-body">
        {boards === null ? <p className="muted">Cargando…</p> : boards.length === 0 ? (
          <div className="empty"><PenTool size={36} /><strong>Todavía no hay pizarras</strong><span className="small">Crea una nueva o importa un archivo .excalidraw para dibujar entre todos.</span></div>
        ) : (
          <div className="board-grid">
            {boards.map((b) => (
              <div key={b.id} className="board-card" role="button" tabIndex={0} aria-label={`Abrir ${b.name}`} onClick={() => onOpen(b)} onKeyDown={(e) => e.key === 'Enter' && onOpen(b)}>
                <div className="board-thumb"><Thumb code={room.code} board={b} /></div>
                <div className="board-meta">
                  <span className="fbody"><span className="fname truncate">{b.name}</span><span className="fmeta truncate">{b.createdByName} · {when(b.updatedAt)}</span></span>
                  {(b.createdBy === user?.id || staff) && canWrite && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Menu items={[
                        { label: 'Cambiar nombre', icon: <Pencil size={16} />, onClick: async () => {
                          const n = window.prompt('Nuevo nombre', b.name)
                          if (n?.trim()) await api(`/rooms/${room.code}/docs/${b.id}`, 'PATCH', { name: n.trim() }).catch((e) => toast(e.message, 'error'))
                        } },
                        'separator',
                        { label: 'Borrar', icon: <Trash2 size={16} />, danger: true, onClick: async () => {
                          if (confirm(`¿Borrar la pizarra «${b.name}»? También se borra su archivo .excalidraw de la sala.`)) await api(`/rooms/${room.code}/docs/${b.id}`, 'DELETE').catch((e) => toast(e.message, 'error'))
                        } },
                      ]} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

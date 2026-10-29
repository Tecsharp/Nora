import { useCallback, useEffect, useRef, useState } from 'react'
import { Library, Loader2, Trash2, Upload } from 'lucide-react'
import { api, ApiError, formatBytes, getAccessToken } from '../api'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'

interface Lib {
  id: string
  name: string
  itemCount: number
  sizeBytes: number
  createdAt: string
}

/** Bibliotecas de Excalidraw del sistema: las sube un administrador y aparecen (como «SISTEMA») en la pizarra de todas las salas. */
export default function AdminLibraries() {
  const toast = useToast()
  const dialogs = useDialogs()
  const [libs, setLibs] = useState<Lib[] | null>(null)
  const [busy, setBusy] = useState(false)
  const pick = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api<Lib[]>('/admin/libraries').then(setLibs).catch(() => setLibs([])), [])
  useEffect(() => void load(), [load])

  async function upload(files: File[]) {
    setBusy(true)
    let added = 0
    for (const f of files) {
      try {
        const fd = new FormData()
        fd.append('file', f)
        const res = await fetch('/api/admin/libraries', { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, body: fd })
        if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
        added++
      } catch (e) {
        toast(`«${f.name}»: ${e instanceof Error ? e.message : 'no se pudo subir'}`, 'error')
      }
    }
    setBusy(false)
    if (added) toast(`${added} biblioteca${added === 1 ? '' : 's'} añadida${added === 1 ? '' : 's'}. Saldrán en la pizarra de todas las salas.`, 'success')
    void load()
  }

  async function remove(l: Lib) {
    if (!await dialogs.confirm({ title: `¿Quitar la biblioteca «${l.name}»?`, message: 'Dejará de aparecer en la pizarra de todas las salas. Las bibliotecas personales de cada persona no se tocan.', confirmLabel: 'Quitar biblioteca', tone: 'danger' })) return
    await api(`/admin/libraries/${l.id}`, 'DELETE').catch((e) => toast(e.message, 'error'))
    void load()
  }

  return (
    <section className="card stack tight">
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h3 className="row"><Library size={18} /> Bibliotecas de la pizarra (SISTEMA)</h3>
        <button className="btn sm primary" disabled={busy} onClick={() => pick.current?.click()}>
          {busy ? <Loader2 size={15} className="spin-icon" /> : <Upload size={15} />} Subir biblioteca…
        </button>
        <input ref={pick} type="file" hidden multiple accept=".excalidrawlib,.json,application/json" aria-label="Subir biblioteca"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void upload(f) }} />
      </div>
      <p className="muted small">Archivos <b>.excalidrawlib</b> (por ejemplo de libraries.excalidraw.com). Aparecen en la pizarra de todas las salas bajo «SISTEMA» y nadie puede modificarlas. Cada persona conserva además su biblioteca propia en cada sala (hasta 100 MB), mientras la sala exista.</p>
      {libs === null ? <p className="muted small">Cargando…</p> : libs.length === 0 ? (
        <p className="muted small">Todavía no hay bibliotecas del sistema.</p>
      ) : (
        <div className="stack tight">
          {libs.map((l) => (
            <div key={l.id} className="join-req">
              <span className="row nowrap"><Library size={18} /><span className="stack tight" style={{ gap: 0 }}><strong className="truncate">{l.name}</strong><span className="muted small">{l.itemCount} elemento{l.itemCount === 1 ? '' : 's'} · {formatBytes(l.sizeBytes)}</span></span></span>
              <button className="icon-btn danger" aria-label={`Quitar ${l.name}`} title="Quitar" onClick={() => void remove(l)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

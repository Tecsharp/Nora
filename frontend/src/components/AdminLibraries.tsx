import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertCircle, Check, Library, Loader2, RotateCw, Trash2, Upload, X } from 'lucide-react'
import { api, formatBytes, getAccessToken } from '../api'
import { useDialogs } from '../dialogs'
import { useToast } from '../toast'
import { prettyLibraryName } from '../collab/libraryNames'

interface Lib {
  id: string
  name: string
  itemCount: number
  sizeBytes: number
  createdAt: string
}

type Status = 'queued' | 'uploading' | 'retrying' | 'done' | 'error'

interface Job {
  key: number
  file: File
  status: Status
  progress: number // 0..1
  message?: string
  attempt: number
}

const CONCURRENCY = 2
const MAX_ATTEMPTS = 4
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RETRYABLE = new Set([0, 429, 502, 503, 504])

/** Sube un archivo con progreso real. Devuelve el estado HTTP (0 = fallo de red) y el mensaje del servidor. */
function send(file: File, onProgress: (p: number) => void): Promise<{ status: number; message?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/libraries')
    xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken() ?? ''}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let message: string | undefined
      try {
        message = JSON.parse(xhr.responseText).message
      } catch { /* sin cuerpo JSON */ }
      resolve({ status: xhr.status, message })
    }
    xhr.onerror = () => resolve({ status: 0, message: 'Sin conexión con el servidor' })
    xhr.ontimeout = () => resolve({ status: 0, message: 'Tiempo de espera agotado' })
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

/** Bibliotecas de Excalidraw del sistema: las sube un administrador y aparecen (como «SISTEMA») en la pizarra de todas las salas. */
export default function AdminLibraries() {
  const toast = useToast()
  const dialogs = useDialogs()
  const [libs, setLibs] = useState<Lib[] | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const next = useRef(1)
  const queue = useRef<number[]>([])
  const running = useRef(0)
  const files = useRef(new Map<number, File>())

  const load = useCallback(() => api<Lib[]>('/admin/libraries').then(setLibs).catch(() => setLibs([])), [])
  useEffect(() => void load(), [load])

  const patch = (key: number, p: Partial<Job>) => setJobs((all) => all.map((j) => (j.key === key ? { ...j, ...p } : j)))

  async function runOne(key: number) {
    const file = files.current.get(key)!
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      patch(key, { status: attempt === 1 ? 'uploading' : 'retrying', progress: 0, attempt, message: attempt === 1 ? undefined : `Reintentando (${attempt}/${MAX_ATTEMPTS})…` })
      const r = await send(file, (p) => patch(key, { progress: p }))
      if (r.status >= 200 && r.status < 300) return patch(key, { status: 'done', progress: 1, message: undefined })
      if (!RETRYABLE.has(r.status) || attempt === MAX_ATTEMPTS) {
        const why = r.status === 429 || r.status === 503 ? 'El servidor está saturado, vuelve a intentarlo' : r.message ?? `Error ${r.status}`
        return patch(key, { status: 'error', message: why })
      }
      await sleep(800 * attempt * attempt) // 0,8 s · 3,2 s · 7,2 s: deja que el servidor se recupere
    }
  }

  function pump() {
    while (running.current < CONCURRENCY && queue.current.length) {
      const key = queue.current.shift()!
      running.current++
      void runOne(key).finally(() => {
        running.current--
        pump()
        if (!running.current && !queue.current.length) void load()
      })
    }
  }

  function add(list: File[]) {
    const accepted = list.filter((f) => /\.(excalidrawlib|json)$/i.test(f.name))
    if (accepted.length < list.length) toast(`${list.length - accepted.length} archivo(s) omitidos: solo se admiten .excalidrawlib`, 'warning')
    const fresh: Job[] = accepted.map((file) => {
      const key = next.current++
      files.current.set(key, file)
      queue.current.push(key)
      return { key, file, status: 'queued', progress: 0, attempt: 0 }
    })
    setJobs((all) => [...all.filter((j) => j.status !== 'done'), ...fresh])
    pump()
  }

  function retry(key: number) {
    patch(key, { status: 'queued', progress: 0, message: undefined })
    queue.current.push(key)
    pump()
  }

  async function remove(l: Lib) {
    if (!await dialogs.confirm({ title: `¿Quitar la biblioteca «${prettyLibraryName(l.name)}»?`, message: 'Dejará de aparecer en la pizarra de todas las salas. Las bibliotecas personales de cada persona no se tocan.', confirmLabel: 'Quitar biblioteca', tone: 'danger' })) return
    await api(`/admin/libraries/${l.id}`, 'DELETE').catch((e) => toast(e.message, 'error'))
    void load()
  }

  const done = jobs.filter((j) => j.status === 'done').length
  const failed = jobs.filter((j) => j.status === 'error').length
  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'uploading' || j.status === 'retrying')
  const overall = jobs.length ? jobs.reduce((a, j) => a + (j.status === 'done' || j.status === 'error' ? 1 : j.progress), 0) / jobs.length : 0
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    add(Array.from(e.dataTransfer.files))
  }

  return (
    <section className={`card stack tight ${over ? 'drop-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h3 className="row"><Library size={18} /> Bibliotecas de la pizarra (SISTEMA)</h3>
        <button className="btn sm primary" onClick={() => pick.current?.click()}>
          {busy ? <Loader2 size={15} className="spin-icon" /> : <Upload size={15} />} Subir bibliotecas…
        </button>
        <input ref={pick} type="file" hidden multiple accept=".excalidrawlib,.json,application/json" aria-label="Subir biblioteca"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) add(f) }} />
      </div>
      <p className="muted small">Archivos <b>.excalidrawlib</b> (por ejemplo de libraries.excalidraw.com); puedes elegir o arrastrar muchos a la vez. Aparecen en la pizarra de todas las salas bajo «SISTEMA» y nadie puede modificarlas. Cada persona conserva además su biblioteca propia en cada sala (hasta 100 MB), mientras la sala exista.</p>

      {jobs.length > 0 && (
        <div className="lib-jobs" role="status" aria-live="polite">
          <div className="row spread nowrap">
            <strong className="small">{busy ? `Subiendo… ${done} de ${jobs.length}` : failed ? `${done} subidas, ${failed} con error` : `${done} subidas`}</strong>
            {!busy && <button className="btn ghost sm" onClick={() => setJobs([])}><X size={14} /> Limpiar</button>}
          </div>
          <div className="meter"><i style={{ width: `${Math.round(overall * 100)}%` }} /></div>
          <ul>
            {jobs.map((j) => (
              <li key={j.key} className={`lib-job ${j.status}`}>
                <span className="lib-job-ico">
                  {j.status === 'done' ? <Check size={16} /> : j.status === 'error' ? <AlertCircle size={16} /> : j.status === 'queued' ? <span className="dot" /> : <Loader2 size={16} className="spin-icon" />}
                </span>
                <span className="lib-job-main">
                  <span className="truncate">{j.file.name} <span className="muted small">· {formatBytes(j.file.size)}</span></span>
                  {(j.status === 'uploading' || j.status === 'retrying') && <span className="meter thin"><i style={{ width: `${Math.round(j.progress * 100)}%` }} /></span>}
                  {j.message && <span className={`small ${j.status === 'error' ? 'error' : 'muted'}`}>{j.message}</span>}
                </span>
                {j.status === 'error' && <button className="btn sm" onClick={() => retry(j.key)}><RotateCw size={14} /> Reintentar</button>}
                {j.status === 'queued' && <span className="muted small">En cola</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {libs === null ? <p className="muted small">Cargando…</p> : libs.length === 0 ? (
        <p className="muted small">Todavía no hay bibliotecas del sistema.</p>
      ) : (
        <div className="stack tight">
          <strong className="small">{libs.length} biblioteca{libs.length === 1 ? '' : 's'} en el sistema</strong>
          {[...libs].sort((a, b) => prettyLibraryName(a.name).localeCompare(prettyLibraryName(b.name), 'es', { numeric: true })).map((l) => (
            <div key={l.id} className="join-req">
              <span className="row nowrap"><Library size={18} /><span className="stack tight" style={{ gap: 0 }}><strong className="truncate">{prettyLibraryName(l.name)}</strong><span className="muted small">{l.itemCount} elemento{l.itemCount === 1 ? '' : 's'} · {formatBytes(l.sizeBytes)}</span></span></span>
              <button className="icon-btn danger" aria-label={`Quitar ${l.name}`} title="Quitar" onClick={() => void remove(l)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { ChevronLeft, ChevronRight, Download, Maximize2, Minimize2, X } from 'lucide-react'
import { formatBytes } from '../api'
import { loadFile, prefetchFile } from '../fileCache'
import { mimeFor, PREVIEW_LIMIT, previewKind } from '../preview'

const PdfView = lazy(() => import('./PdfView'))

export interface ViewableFile {
  id: string
  name: string
  sizeBytes: number
}

interface Props {
  code: string
  files: ViewableFile[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onDownload: (f: ViewableFile) => void
}

type Loaded = { kind: 'image'; url: string } | { kind: 'pdf'; data: ArrayBuffer } | { kind: 'text'; text: string; truncated: boolean }

/** Visor de imágenes, PDF y texto con navegación entre los documentos de la carpeta. */
export default function FileViewer({ code, files, index, onIndex, onClose, onDownload }: Props) {
  const file = files[index]!
  const kind = previewKind(file.name)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [actual, setActual] = useState(false)

  const go = useCallback((d: number) => onIndex((index + d + files.length) % files.length), [index, files.length, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && files.length > 1) go(1)
      else if (e.key === 'ArrowLeft' && files.length > 1) go(-1)
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [go, onClose, files.length])

  useEffect(() => {
    setLoaded(null)
    setError('')
    setActual(false)
    setProgress(null)
    if (!kind) return setError('Este tipo de archivo no se puede previsualizar.')
    if (file.sizeBytes > PREVIEW_LIMIT[kind]) return setError(`Es demasiado grande para previsualizarlo (${formatBytes(file.sizeBytes)}).`)
    const h = loadFile(code, file.id, (l, t) => setProgress({ loaded: l, total: t || file.sizeBytes }), mimeFor(file.name, kind))
    let url: string | null = null
    h.promise
      .then(async (blob) => {
        if (kind === 'image') {
          url = URL.createObjectURL(blob)
          setLoaded({ kind, url })
        } else if (kind === 'pdf') {
          setLoaded({ kind, data: await blob.arrayBuffer() })
        } else {
          const text = new TextDecoder().decode(await blob.arrayBuffer())
          setLoaded({ kind, text: text.slice(0, 500_000), truncated: text.length > 500_000 })
        }
        setProgress(null)
        // con la actual ya en pantalla, se deja lista la siguiente de la carpeta para que pasar de una a otra sea instantáneo
        const next = files[(index + 1) % files.length]
        if (next && next.id !== file.id && previewKind(next.name) === 'image') prefetchFile(code, next.id, next.sizeBytes, mimeFor(next.name, 'image'))
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudo cargar el archivo.')
      })
    return () => {
      h.cancel()
      if (url) URL.revokeObjectURL(url)
    }
  }, [code, file.id, file.name, file.sizeBytes, kind])

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0
  const onPdfError = useCallback((m: string) => setError(m), [])

  return (
    <div className="modal-backdrop viewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-modal="true" aria-label={`Vista previa de ${file.name}`}>
        <header className="viewer-head">
          <div className="grow" style={{ minWidth: 0 }}>
            <strong className="truncate" style={{ display: 'block' }}>{file.name}</strong>
            <span className="muted small">{formatBytes(file.sizeBytes)}{files.length > 1 ? ` · ${index + 1} de ${files.length}` : ''}</span>
          </div>
          {loaded?.kind === 'image' && (
            <button className="icon-btn" aria-label={actual ? 'Ajustar a la ventana' : 'Tamaño real'} title={actual ? 'Ajustar a la ventana' : 'Tamaño real'} onClick={() => setActual((a) => !a)}>
              {actual ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
          <button className="icon-btn" aria-label="Descargar" title="Descargar" onClick={() => onDownload(file)}><Download size={18} /></button>
          <button className="icon-btn" aria-label="Cerrar vista previa" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="viewer-body">
          {files.length > 1 && <button className="viewer-nav left icon-btn" aria-label="Anterior" onClick={() => go(-1)}><ChevronLeft size={22} /></button>}
          {files.length > 1 && <button className="viewer-nav right icon-btn" aria-label="Siguiente" onClick={() => go(1)}><ChevronRight size={22} /></button>}

          {error ? (
            <div className="empty">
              <strong>No se puede mostrar</strong>
              <span className="small">{error}</span>
              <button className="btn" onClick={() => onDownload(file)}><Download size={15} /> Descargar</button>
            </div>
          ) : !loaded ? (
            <div className="viewer-loading">
              <span className="small muted">{progress && progress.loaded > 0 ? `Cargando ${pct}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}` : 'Cargando…'}</span>
              <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            </div>
          ) : loaded.kind === 'image' ? (
            <div className={`viewer-img ${actual ? 'actual' : ''}`} onClick={() => setActual((a) => !a)}>
              <img src={loaded.url} alt={file.name} onError={() => setError('El navegador no puede mostrar este formato de imagen.')} />
            </div>
          ) : loaded.kind === 'pdf' ? (
            <Suspense fallback={<p className="muted center-text" style={{ padding: 32 }}>Cargando visor…</p>}>
              <PdfView data={loaded.data} onError={onPdfError} />
            </Suspense>
          ) : (
            <pre className="viewer-text">{loaded.text}{loaded.truncated ? '\n\n… (se muestra solo el principio del archivo)' : ''}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

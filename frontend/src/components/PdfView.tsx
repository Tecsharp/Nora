import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'

type Pdfjs = typeof import('pdfjs-dist')
let lib: Promise<Pdfjs> | null = null

/** pdf.js se carga solo al abrir el primer PDF. */
function loadPdfjs() {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl
    return m
  })
  return lib
}

function Page({ doc, number, zoom, width, onVisible }: { doc: PDFDocumentProxy; number: number; zoom: number; width: number; onVisible: (n: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ratio, setRatio] = useState(1.414)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        setNear(e!.isIntersecting)
        if (e!.isIntersecting && e!.intersectionRatio > 0.3) onVisible(number)
      },
      { rootMargin: '700px 0px', threshold: [0, 0.3] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [number, onVisible])

  useEffect(() => {
    if (!near || width <= 0) return
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    let dead = false
    void doc.getPage(number).then((page) => {
      if (dead) return
      const base = page.getViewport({ scale: 1 })
      setRatio(base.height / base.width)
      const scale = (width * zoom) / base.width
      const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
      const c = canvas.current
      if (!c) return
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      task = page.render({ canvasContext: c.getContext('2d')!, viewport: vp })
      task.promise.catch(() => {}) // una renderización cancelada no es un error
    })
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, number, near, zoom, width])

  const w = width * zoom
  return (
    <div ref={wrap} className="pdf-page" style={{ width: w, height: w * ratio }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

/** Visor de PDF con pdf.js: las páginas se dibujan en canvas, solo las cercanas a la pantalla. */
export default function PdfView({ data, onError }: { data: ArrayBuffer; onError: (msg: string) => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const area = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let dead = false
    let loaded: PDFDocumentProxy | null = null
    void loadPdfjs()
      .then((m) =>
        m.getDocument({
          data: new Uint8Array(data.slice(0)), // pdf.js se queda con el buffer
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
        }).promise,
      )
      .then((d) => {
        loaded = d
        if (dead) void d.destroy()
        else setDoc(d)
      })
      .catch((e: Error) => !dead && onError(e.name === 'PasswordException' ? 'El PDF está protegido con contraseña.' : 'No se pudo abrir este PDF.'))
    return () => {
      dead = true
      void loaded?.destroy()
    }
  }, [data, onError])

  useEffect(() => {
    const el = area.current
    if (!el) return
    const measure = () => setWidth(Math.max(0, el.clientWidth - 32))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const step = (d: number) => setZoom((z) => Math.min(3, Math.max(0.5, Math.round((z + d) * 100) / 100)))
  return (
    <div className="pdf-wrap">
      <div className="pdf-tools">
        <button className="icon-btn sm" aria-label="Alejar" onClick={() => step(-0.25)} disabled={zoom <= 0.5}><Minus size={16} /></button>
        <span className="small">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn sm" aria-label="Acercar" onClick={() => step(0.25)} disabled={zoom >= 3}><Plus size={16} /></button>
        {doc && <span className="small muted" style={{ marginLeft: 12 }}>Página {current} de {doc.numPages}</span>}
      </div>
      <div ref={area} className="pdf-area">
        {!doc && <p className="muted center-text" style={{ padding: 32 }}>Abriendo PDF…</p>}
        {doc && width > 0 && Array.from({ length: doc.numPages }, (_, i) => (
          <Page key={i} doc={doc} number={i + 1} zoom={zoom} width={width} onVisible={setCurrent} />
        ))}
      </div>
    </div>
  )
}

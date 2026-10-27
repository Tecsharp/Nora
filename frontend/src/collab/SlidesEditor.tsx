import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import * as Y from 'yjs'
import {
  ArrowDownToLine, ArrowUpToLine, Bold, Circle, Copy, ImagePlus, Italic, Maximize, Plus, Redo2, Square, Trash2, Type, Undo2, X,
} from 'lucide-react'
import type { CollabProvider } from './provider'
import { SlidesStore, setYText, type Elem } from './slidesModel'
import { shrinkImage } from './image'

type Box = { x: number; y: number; w: number; h: number }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Dibuja un elemento. `px` = alto de la diapositiva en píxeles, para escalar las tipografías (las del archivo están en puntos). */
function ElementView({ e, pxPerPt, text }: { e: Elem; pxPerPt: number; text?: string }) {
  const style: CSSProperties = { left: `${e.x}%`, top: `${e.y}%`, width: `${e.w}%`, height: `${e.h}%` }
  if (e.type === 'image') return <img className="sl-el sl-img" style={style} src={e.data} alt="" draggable={false} />
  const shape: CSSProperties = {
    background: e.fill, border: e.line ? `${Math.max(1, pxPerPt)}px solid ${e.line}` : undefined,
    borderRadius: e.shape === 'ellipse' ? '50%' : e.shape === 'roundRect' ? '10%' : undefined,
  }
  if (e.type === 'shape') return <div className="sl-el" style={{ ...style, ...shape }} />
  return (
    <div className="sl-el sl-text" style={{
      ...style, ...shape, fontSize: (e.fontSize ?? 18) * pxPerPt, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal',
      color: e.color ?? '#111827', textAlign: e.align ?? 'left', padding: 4 * pxPerPt, lineHeight: 1.2,
    }}>
      {text ?? e.text}
    </div>
  )
}

/** Diapositiva de solo lectura (miniaturas, presentación). */
const SlideView = memo(function SlideView({ store, id, width, version }: { store: SlidesStore; id: string; width: number; version: number }) {
  const heightPx = width * (store.height / store.width)
  const pxPerPt = heightPx / (store.height * 72)
  void version
  return (
    <div className="sl-slide" style={{ width, height: heightPx, background: store.bg(id) }}>
      {store.elementIds(id).map((eid) => {
        const e = store.element(id, eid)
        return e ? <ElementView key={eid} e={e} pxPerPt={pxPerPt} /> : null
      })}
    </div>
  )
})

interface Props { provider: CollabProvider; editable: boolean }

export default function SlidesEditor({ provider, editable }: Props) {
  const doc = provider.doc
  const store = useMemo(() => new SlidesStore(doc), [doc])
  const [version, setVersion] = useState(0)
  const [current, setCurrent] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<string | null>(null)
  const [stageW, setStageW] = useState(800)
  const [presenting, setPresenting] = useState(false)
  const [peers, setPeers] = useState<{ clientId: number; name: string; color: string; slide: string; el: string | null }[]>([])
  const stageBox = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const undo = useRef<Y.UndoManager | null>(null)
  const ids = store.ids()
  const slideId = current && ids.includes(current) ? current : ids[0] ?? null

  useEffect(() => {
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setVersion((v) => v + 1))
    }
    doc.on('update', on)
    on()
    return () => {
      doc.off('update', on)
      cancelAnimationFrame(raf)
    }
  }, [doc])

  useEffect(() => {
    const um = new Y.UndoManager([store.order, store.slides, store.deck], { captureTimeout: 400 })
    undo.current = um
    return () => um.destroy()
  }, [store])

  // Ajusta el tamaño de la diapositiva al espacio disponible
  useEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      const ratio = store.width / store.height
      setStageW(Math.max(200, Math.min(el.clientWidth - 40, (el.clientHeight - 40) * ratio)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [store, slideId])

  useEffect(() => {
    provider.awareness.setLocalStateField('slideSel', slideId ? { slide: slideId, el: selected } : null)
  }, [provider, slideId, selected])
  useEffect(() => {
    const read = () => {
      const out: typeof peers = []
      provider.awareness.getStates().forEach((st, clientId) => {
        const s = st as { user?: { name: string; color: string }; slideSel?: { slide: string; el: string | null } }
        if (clientId !== doc.clientID && s.user && s.slideSel) out.push({ clientId, name: s.user.name, color: s.user.color, slide: s.slideSel.slide, el: s.slideSel.el })
      })
      setPeers(out)
    }
    provider.awareness.on('change', read)
    read()
    return () => provider.awareness.off('change', read)
  }, [provider, doc])

  const heightPx = stageW * (store.height / store.width)
  const pxPerPt = heightPx / (store.height * 72)
  const elems = slideId ? store.elementIds(slideId).map((id) => store.element(slideId, id)).filter((e): e is Elem => !!e) : []
  const sel = selected && slideId ? store.element(slideId, selected) : null

  // ---- mover / redimensionar ----
  const drag = useRef<{ mode: string; start: { x: number; y: number }; box: Box } | null>(null)

  const onPointerDown = (e: RPointerEvent, el: Elem, mode: string) => {
    if (!editable || !slideId) return
    e.stopPropagation()
    setSelected(el.id)
    if (editingText === el.id) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { mode, start: { x: e.clientX, y: e.clientY }, box: { x: el.x, y: el.y, w: el.w, h: el.h } }
  }

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || !slideId || !selected) return
    const rect = stageBox.current!.getBoundingClientRect()
    const dx = ((e.clientX - d.start.x) / rect.width) * 100
    const dy = ((e.clientY - d.start.y) / rect.height) * 100
    let { x, y, w, h } = d.box
    if (d.mode === 'move') {
      x = clamp(x + dx, -w + 5, 95)
      y = clamp(y + dy, -h + 5, 95)
    } else {
      if (d.mode.includes('e')) w = Math.max(2, w + dx)
      if (d.mode.includes('s')) h = Math.max(2, h + dy)
      if (d.mode.includes('w')) { const nw = Math.max(2, w - dx); x = x + (w - nw); w = nw }
      if (d.mode.includes('n')) { const nh = Math.max(2, h - dy); y = y + (h - nh); h = nh }
    }
    const r = (n: number) => Math.round(n * 100) / 100
    store.updateElement(slideId, selected, { x: r(x), y: r(y), w: r(w), h: r(h) })
  }

  const endDrag = () => (drag.current = null)

  // ---- acciones ----
  const add = (type: 'text' | 'rect' | 'ellipse') => {
    if (!slideId || !editable) return
    const base = { x: 30, y: 35, w: 40, h: 20 }
    const id = type === 'text'
      ? store.addElement(slideId, { type: 'text', ...base, text: 'Escribe aquí', fontSize: 28, bold: false, italic: false, color: '#111827', align: 'left' })
      : store.addElement(slideId, { type: 'shape', ...base, shape: type === 'ellipse' ? 'ellipse' : 'rect', fill: '#7c6af7' })
    setSelected(id)
  }

  const addImage = async (file: File) => {
    if (!slideId || !editable) return
    const data = await shrinkImage(file, 1600, 0.86)
    const bmp = await createImageBitmap(file)
    const ratio = bmp.width / bmp.height
    bmp.close()
    const w = 40
    const h = Math.min(80, (w * (store.width / store.height)) / ratio)
    setSelected(store.addElement(slideId, { type: 'image', x: 30, y: 20, w, h: Math.round(h * 100) / 100, data }))
  }

  const patch = (p: Partial<Elem>) => slideId && selected && store.updateElement(slideId, selected, p)
  const remove = () => {
    if (!slideId || !selected) return
    store.removeElement(slideId, selected)
    setSelected(null)
  }
  const duplicate = () => {
    if (!slideId || !sel) return
    const { id: _id, ...rest } = sel
    setSelected(store.addElement(slideId, { ...rest, x: Math.min(90, sel.x + 3), y: Math.min(90, sel.y + 3) }))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (editingText || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo.current?.redo(); else undo.current?.undo(); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo.current?.redo(); return }
    if (!editable || !sel) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate() }
    else if (e.key === 'Enter' && sel.type === 'text') { e.preventDefault(); setEditingText(sel.id) }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 2 : 0.5
      patch({ x: sel.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), y: sel.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) })
    }
  }

  if (!slideId) return <div className="empty"><strong>Esta presentación no tiene diapositivas</strong>{editable && <button className="btn" onClick={() => setCurrent(store.addSlide())}>Añadir diapositiva</button>}</div>

  return (
    <div className="slides-editor" onKeyDown={onKeyDown} tabIndex={-1}>
      {editable && (
        <div className="toolbar" role="toolbar" aria-label="Insertar">
          <button className="tb" aria-label="Deshacer" title="Deshacer" onClick={() => undo.current?.undo()}><Undo2 size={16} /></button>
          <button className="tb" aria-label="Rehacer" title="Rehacer" onClick={() => undo.current?.redo()}><Redo2 size={16} /></button>
          <span className="tb-sep" />
          <button className="tb txt" onClick={() => add('text')}><Type size={15} /> Texto</button>
          <button className="tb txt" onClick={() => add('rect')}><Square size={15} /> Rectángulo</button>
          <button className="tb txt" onClick={() => add('ellipse')}><Circle size={15} /> Elipse</button>
          <label className="tb txt"><ImagePlus size={15} /> Imagen<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addImage(f) }} /></label>
          <span className="tb-sep" />
          <label className="tb txt" title="Color de fondo de la diapositiva">Fondo <input type="color" value={store.bg(slideId)} onChange={(e) => store.setBg(slideId, e.target.value)} /></label>
          <span className="grow" />
          <button className="tb txt" onClick={() => setPresenting(true)}><Maximize size={15} /> Presentar</button>
        </div>
      )}
      {!editable && <div className="toolbar"><span className="grow" /><button className="tb txt" onClick={() => setPresenting(true)}><Maximize size={15} /> Presentar</button></div>}

      <div className="slides-main">
        <div className="slide-rail" role="listbox" aria-label="Diapositivas">
          {ids.map((id, i) => (
            <div key={id} className={`slide-thumb ${id === slideId ? 'on' : ''}`} role="option" aria-selected={id === slideId} tabIndex={0}
              onClick={() => { setCurrent(id); setSelected(null) }} onKeyDown={(e) => e.key === 'Enter' && setCurrent(id)}>
              <span className="n">{i + 1}</span>
              <SlideView store={store} id={id} width={150} version={version} />
              <span className="peer-dots">{peers.filter((p) => p.slide === id).map((p) => <i key={p.clientId} title={p.name} style={{ background: p.color }} />)}</span>
              {editable && id === slideId && (
                <span className="thumb-actions">
                  <button className="icon-btn sm" aria-label="Duplicar diapositiva" onClick={(e) => { e.stopPropagation(); setCurrent(store.duplicateSlide(id)) }}><Copy size={14} /></button>
                  {ids.length > 1 && <button className="icon-btn sm" aria-label="Eliminar diapositiva" onClick={(e) => { e.stopPropagation(); store.removeSlide(id) }}><Trash2 size={14} /></button>}
                  {i > 0 && <button className="icon-btn sm" aria-label="Subir diapositiva" onClick={(e) => { e.stopPropagation(); store.moveSlide(id, i - 1) }}><ArrowUpToLine size={14} /></button>}
                  {i < ids.length - 1 && <button className="icon-btn sm" aria-label="Bajar diapositiva" onClick={(e) => { e.stopPropagation(); store.moveSlide(id, i + 1) }}><ArrowDownToLine size={14} /></button>}
                </span>
              )}
            </div>
          ))}
          {editable && <button className="btn sm" onClick={() => setCurrent(store.addSlide(slideId))}><Plus size={14} /> Diapositiva</button>}
        </div>

        <div ref={area} className="stage-area" onPointerDown={() => { setSelected(null); setEditingText(null) }}>
          <div ref={stageBox} className="sl-slide stage" style={{ width: stageW, height: heightPx, background: store.bg(slideId) }}
            onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            {elems.map((el) => (
              <div key={el.id}>
                {editingText === el.id ? (
                  <TextEditBox store={store} slideId={slideId} el={el} pxPerPt={pxPerPt} onDone={() => setEditingText(null)} />
                ) : (
                  <div onPointerDown={(e) => onPointerDown(e, el, 'move')} onDoubleClick={() => editable && el.type === 'text' && setEditingText(el.id)} className="sl-hit">
                    <ElementView e={el} pxPerPt={pxPerPt} />
                  </div>
                )}
                {peers.filter((p) => p.slide === slideId && p.el === el.id).map((p) => (
                  <div key={p.clientId} className="sl-peer" style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, borderColor: p.color }}><span style={{ background: p.color }}>{p.name}</span></div>
                ))}
                {el.id === selected && editable && editingText !== el.id && (
                  <div className="sl-sel" style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}>
                    {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => (
                      <span key={h} className={`sl-handle ${h}`} onPointerDown={(e) => onPointerDown(e, el, h)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {editable && sel && (
          <aside className="props" aria-label="Propiedades">
            <strong className="small">{sel.type === 'text' ? 'Texto' : sel.type === 'image' ? 'Imagen' : 'Forma'}</strong>
            {sel.type === 'text' && (
              <>
                <label>Tamaño (pt)<input type="number" min={6} max={200} value={sel.fontSize ?? 18} onChange={(e) => patch({ fontSize: clamp(Number(e.target.value) || 18, 6, 200) })} /></label>
                <div className="row">
                  <button className={`tb ${sel.bold ? 'on' : ''}`} aria-label="Negrita" onClick={() => patch({ bold: !sel.bold })}><Bold size={16} /></button>
                  <button className={`tb ${sel.italic ? 'on' : ''}`} aria-label="Cursiva" onClick={() => patch({ italic: !sel.italic })}><Italic size={16} /></button>
                  <select className="tb-select" aria-label="Alineación" value={sel.align ?? 'left'} onChange={(e) => patch({ align: e.target.value as Elem['align'] })}>
                    <option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option>
                  </select>
                </div>
                <label>Color del texto<input type="color" value={sel.color ?? '#111827'} onChange={(e) => patch({ color: e.target.value })} /></label>
              </>
            )}
            {sel.type !== 'image' && (
              <>
                <label>Relleno<input type="color" value={sel.fill ?? '#ffffff'} onChange={(e) => patch({ fill: e.target.value })} /></label>
                {sel.fill && <button className="btn sm" onClick={() => patch({ fill: undefined })}>Sin relleno</button>}
                <label>Borde<input type="color" value={sel.line ?? '#000000'} onChange={(e) => patch({ line: e.target.value })} /></label>
                {sel.line && <button className="btn sm" onClick={() => patch({ line: undefined })}>Sin borde</button>}
                <label>Forma<select value={sel.shape ?? 'rect'} onChange={(e) => patch({ shape: e.target.value as Elem['shape'] })}><option value="rect">Rectángulo</option><option value="roundRect">Redondeado</option><option value="ellipse">Elipse</option></select></label>
              </>
            )}
            <div className="row">
              <button className="btn sm" onClick={() => slideId && selected && store.restack(slideId, selected, 'front')}>Al frente</button>
              <button className="btn sm" onClick={() => slideId && selected && store.restack(slideId, selected, 'back')}>Al fondo</button>
            </div>
            <div className="row">
              <button className="btn sm" onClick={duplicate}><Copy size={14} /> Duplicar</button>
              <button className="btn sm danger" onClick={remove}><Trash2 size={14} /> Eliminar</button>
            </div>
          </aside>
        )}
      </div>
      {presenting && <Presenter store={store} ids={ids} start={ids.indexOf(slideId)} version={version} onClose={() => setPresenting(false)} />}
    </div>
  )
}

/** Cuadro de edición de texto de un elemento, enlazado al Y.Text (las ediciones simultáneas se mezclan). */
function TextEditBox({ store, slideId, el, pxPerPt, onDone }: { store: SlidesStore; slideId: string; el: Elem; pxPerPt: number; onDone: () => void }) {
  const ytext = store.textOf(slideId, el.id)
  const ref = useRef<HTMLTextAreaElement>(null)
  const sync = useCallback(() => {
    const ta = ref.current
    if (!ta || !ytext) return
    const v = ytext.toString()
    if (ta.value !== v) {
      const pos = ta.selectionStart
      ta.value = v
      ta.setSelectionRange(Math.min(pos, v.length), Math.min(pos, v.length))
    }
  }, [ytext])
  useEffect(() => {
    ytext?.observe(sync)
    ref.current?.focus()
    ref.current?.select()
    return () => ytext?.unobserve(sync)
  }, [ytext, sync])
  if (!ytext) return null
  return (
    <textarea ref={ref} className="sl-el sl-edit" defaultValue={ytext.toString()} aria-label="Texto de la diapositiva"
      style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, fontSize: (el.fontSize ?? 18) * pxPerPt, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal', color: el.color ?? '#111827', textAlign: el.align ?? 'left', padding: 4 * pxPerPt, lineHeight: 1.2 }}
      onChange={(e) => setYText(ytext, e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onDone() }}
      onBlur={onDone} onPointerDown={(e) => e.stopPropagation()} />
  )
}

function Presenter({ store, ids, start, version, onClose }: { store: SlidesStore; ids: string[]; start: number; version: number; onClose: () => void }) {
  const [i, setI] = useState(Math.max(0, start))
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const go = useCallback((d: number) => setI((n) => clamp(n + d, 0, ids.length - 1)), [ids.length])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) go(1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) go(-1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])
  const ratio = store.width / store.height
  const w = Math.min(size.w, size.h * ratio)
  return (
    <div className="presenter" onClick={() => go(1)} role="dialog" aria-label="Presentación">
      <button className="icon-btn presenter-x" aria-label="Salir de la presentación" onClick={(e) => { e.stopPropagation(); onClose() }}><X size={20} /></button>
      <SlideView store={store} id={ids[i]!} width={w} version={version} />
      <span className="presenter-n">{i + 1} / {ids.length}</span>
    </div>
  )
}

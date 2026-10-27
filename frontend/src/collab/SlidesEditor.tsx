import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import * as Y from 'yjs'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import Collaboration from '@tiptap/extension-collaboration'
import { ArrowDownToLine, ArrowUpToLine, Copy, Plus, Trash2, X } from 'lucide-react'
import type { CollabProvider } from './provider'
import { SlidesStore, plainOf, setYText, type Elem, type ShapeKind } from './slidesModel'
import { shrinkImage } from './image'
import { ChartDialog, type ChartSpec } from './chart'
import { FontSize } from './textExtras'
import { DEFAULT_FONT, ElementView, RichText, SlideView, parseSpec } from './SlideRender'
import { LAYOUTS } from './slideLayouts'
import SlidesRibbon, { type SlidesApi } from './SlidesRibbon'

type Box = { x: number; y: number; w: number; h: number }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const r2 = (n: number) => Math.round(n * 100) / 100
const RATIOS: Record<string, [number, number]> = { '16:9': [13.333, 7.5], '16:10': [12, 7.5], '4:3': [10, 7.5] }
const SNAP = 0.9

interface Drag { mode: string; start: { x: number; y: number }; boxes: Map<string, Box>; rect: DOMRect; moved: boolean }

interface Props { provider: CollabProvider; editable: boolean }

export default function SlidesEditor({ provider, editable }: Props) {
  const doc = provider.doc
  const store = useMemo(() => new SlidesStore(doc), [doc])
  const [version, setVersion] = useState(0)
  const [current, setCurrent] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [editingText, setEditingText] = useState<string | null>(null)
  const [editingTable, setEditingTable] = useState<string | null>(null)
  const [ed, setEd] = useState<Editor | null>(null)
  const [stageW, setStageW] = useState(800)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [chartDlg, setChartDlg] = useState<null | { id: string | null; spec: ChartSpec | null }>(null)
  const [peers, setPeers] = useState<{ clientId: number; name: string; color: string; slide: string; el: string | null }[]>([])
  const stageBox = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const undo = useRef<Y.UndoManager | null>(null)
  const drag = useRef<Drag | null>(null)
  const clipboard = useRef<Omit<Elem, 'id'>[]>([])
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
    // los cambios de texto (origen 'html-sync') no se deshacen aquí: de eso se ocupa el editor del propio cuadro
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
  }, [store, slideId, notesOpen])

  useEffect(() => {
    provider.awareness.setLocalStateField('slideSel', slideId ? { slide: slideId, el: selected[0] ?? null } : null)
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

  const stageH = stageW * (store.height / store.width)
  const k = stageH / (store.height * 72) // píxeles por punto tipográfico
  const elems = slideId ? store.elementIds(slideId).map((id) => store.element(slideId, id)).filter((e): e is Elem => !!e) : []
  const sel = elems.filter((e) => selected.includes(e.id))
  // lo seleccionado que ya no existe (otra persona lo borró) se descarta
  useEffect(() => {
    if (selected.length && sel.length !== selected.length) setSelected(sel.map((e) => e.id))
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<Elem>) => {
    if (!slideId || !editable) return
    doc.transact(() => sel.forEach((e) => store.updateElement(slideId, e.id, p)))
  }

  // ---- mover / redimensionar / girar ----
  const snapTargets = (exclude: Set<string>) => {
    const xs = [0, 50, 100]
    const ys = [0, 50, 100]
    for (const e of elems) {
      if (exclude.has(e.id)) continue
      xs.push(e.x, e.x + e.w / 2, e.x + e.w)
      ys.push(e.y, e.y + e.h / 2, e.y + e.h)
    }
    return { xs, ys }
  }

  const beginDrag = (e: RPointerEvent, mode: string, ids: string[]) => {
    if (!slideId) return
    const rect = stageBox.current!.getBoundingClientRect()
    const boxes = new Map<string, Box>()
    for (const id of ids) {
      const el = elems.find((x) => x.id === id)
      if (el) boxes.set(id, { x: el.x, y: el.y, w: el.w, h: el.h })
    }
    drag.current = { mode, start: { x: e.clientX, y: e.clientY }, boxes, rect, moved: false }
    const move = (ev: globalThis.PointerEvent) => onDragMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      drag.current = null
      setGuides({ x: [], y: [] })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onDragMove = (ev: globalThis.PointerEvent) => {
    const d = drag.current
    if (!d || !slideId) return
    const dxPct = ((ev.clientX - d.start.x) / d.rect.width) * 100
    const dyPct = ((ev.clientY - d.start.y) / d.rect.height) * 100
    if (!d.moved && Math.abs(ev.clientX - d.start.x) + Math.abs(ev.clientY - d.start.y) < 3) return
    d.moved = true
    const ids = [...d.boxes.keys()]
    if (d.mode === 'move') {
      const boxes = [...d.boxes.values()]
      const gx = Math.min(...boxes.map((b) => b.x)), gy = Math.min(...boxes.map((b) => b.y))
      const gw = Math.max(...boxes.map((b) => b.x + b.w)) - gx, gh = Math.max(...boxes.map((b) => b.y + b.h)) - gy
      let nx = gx + dxPct
      let ny = gy + dyPct
      const { xs, ys } = snapTargets(new Set(ids))
      const gX: number[] = []
      const gY: number[] = []
      if (!ev.altKey) {
        let bestX = SNAP, bestY = SNAP
        for (const edge of [0, gw / 2, gw]) for (const t of xs) { const diff = t - (nx + edge); if (Math.abs(diff) < Math.abs(bestX)) bestX = diff }
        for (const edge of [0, gh / 2, gh]) for (const t of ys) { const diff = t - (ny + edge); if (Math.abs(diff) < Math.abs(bestY)) bestY = diff }
        if (Math.abs(bestX) < SNAP) { nx += bestX; for (const edge of [0, gw / 2, gw]) if (xs.some((t) => Math.abs(t - (nx + edge)) < 0.05)) gX.push(r2(nx + edge)) }
        if (Math.abs(bestY) < SNAP) { ny += bestY; for (const edge of [0, gh / 2, gh]) if (ys.some((t) => Math.abs(t - (ny + edge)) < 0.05)) gY.push(r2(ny + edge)) }
      }
      setGuides({ x: gX, y: gY })
      const ddx = nx - gx, ddy = ny - gy
      doc.transact(() => {
        for (const [id, b] of d.boxes) store.updateElement(slideId, id, { x: r2(clamp(b.x + ddx, -b.w + 5, 95)), y: r2(clamp(b.y + ddy, -b.h + 5, 95)) })
      })
      return
    }
    const id = ids[0]!
    const b = d.boxes.get(id)!
    if (d.mode === 'rot') {
      const cx = d.rect.left + ((b.x + b.w / 2) / 100) * d.rect.width
      const cy = d.rect.top + ((b.y + b.h / 2) / 100) * d.rect.height
      let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      store.updateElement(slideId, id, { rot: ((Math.round(deg) % 360) + 360) % 360 })
      return
    }
    let { x, y, w, h } = b
    const ratio = b.w / b.h
    if (d.mode.includes('e')) w = Math.max(1.5, w + dxPct)
    if (d.mode.includes('s')) h = Math.max(1.5, h + dyPct)
    if (d.mode.includes('w')) { const nw = Math.max(1.5, w - dxPct); x += w - nw; w = nw }
    if (d.mode.includes('n')) { const nh = Math.max(1.5, h - dyPct); y += h - nh; h = nh }
    if (ev.shiftKey && d.mode.length === 2) {
      const nh = (w * (d.rect.width / d.rect.height)) / (ratio * (d.rect.width / d.rect.height))
      if (d.mode.includes('n')) y += h - nh
      h = nh
    }
    store.updateElement(slideId, id, { x: r2(x), y: r2(y), w: r2(w), h: r2(h) })
  }

  const onElementDown = (e: RPointerEvent, el: Elem) => {
    if (!editable || !slideId || e.button !== 0) return
    e.stopPropagation()
    let next = selected
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      next = selected.includes(el.id) ? selected.filter((x) => x !== el.id) : [...selected, el.id]
      setSelected(next)
      if (!next.includes(el.id)) return
    } else if (!selected.includes(el.id)) {
      next = [el.id]
      setSelected(next)
    }
    if (editingText && editingText !== el.id) setEditingText(null)
    if (editingTable && editingTable !== el.id) setEditingTable(null)
    if (editingText === el.id || editingTable === el.id) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    beginDrag(e, 'move', next)
  }

  /** Arrastrar sobre el fondo de la diapositiva dibuja un recuadro de selección. */
  const onStageDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    setEditingText(null)
    setEditingTable(null)
    if (!slideId) return
    const rect = stageBox.current!.getBoundingClientRect()
    const toPct = (cx: number, cy: number) => ({ x: ((cx - rect.left) / rect.width) * 100, y: ((cy - rect.top) / rect.height) * 100 })
    const s = toPct(e.clientX, e.clientY)
    const base = e.shiftKey ? selected : []
    if (!e.shiftKey) setSelected([])
    if (!editable) return
    const move = (ev: globalThis.PointerEvent) => {
      const p = toPct(ev.clientX, ev.clientY)
      const box = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }
      setMarquee(box)
      const hit = elems.filter((el) => el.x < box.x + box.w && el.x + el.w > box.x && el.y < box.y + box.h && el.y + el.h > box.y).map((el) => el.id)
      setSelected([...new Set([...base, ...hit])])
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- acciones ----
  const select = (id: string | string[]) => setSelected(Array.isArray(id) ? id : [id])

  const addText = () => {
    if (!slideId || !editable) return
    const id = store.addElement(slideId, { type: 'text', x: 30, y: 40, w: 40, h: 14, html: '<p>Escribe aquí</p>', fontSize: 28, color: '#111827', align: 'left', valign: 'top' })
    select(id)
    setEditingText(id)
  }
  const addShape = (shape: ShapeKind) => {
    if (!slideId || !editable) return
    select(store.addElement(slideId, shape === 'line'
      ? { type: 'shape', shape, x: 30, y: 48, w: 40, h: 4, line: '#111827', lw: 3 }
      : { type: 'shape', shape, x: 35, y: 30, w: 30, h: shape === 'ellipse' ? 36 : 32, fill: '#7c6af7', line: '#5b4bd8', lw: 1, color: '#ffffff', align: 'center', valign: 'middle', fontSize: 24 }))
  }
  const addImage = async (file: File) => {
    if (!slideId || !editable) return
    const data = await shrinkImage(file, 1600, 0.86)
    const bmp = await createImageBitmap(file)
    const ratio = bmp.width / bmp.height
    bmp.close()
    const w = 40
    const h = Math.min(80, (w * (store.width / store.height)) / ratio)
    select(store.addElement(slideId, { type: 'image', x: 30, y: 20, w, h: r2(h), data }))
  }
  const addTable = (rows: number, cols: number) => {
    if (!slideId || !editable) return
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `Columna ${c + 1}` : '')))
    select(store.addElement(slideId, { type: 'table', x: 12, y: 30, w: 76, h: Math.min(60, rows * 9), cells: JSON.stringify(cells), hdr: true, fontSize: 16, color: '#111827', fill: '#dbe4ff', line: '#9ca3af' }))
  }
  const tableOp = (op: 'addRow' | 'addCol' | 'delRow' | 'delCol' | 'header') => {
    const t = sel[0]
    if (!slideId || !t || t.type !== 'table') return
    if (op === 'header') return store.updateElement(slideId, t.id, { hdr: !t.hdr })
    const cells = (JSON.parse(t.cells ?? '[]') as string[][]).map((r) => [...r])
    if (op === 'addRow') cells.push(Array(cells[0]?.length ?? 1).fill(''))
    else if (op === 'addCol') cells.forEach((r) => r.push(''))
    else if (op === 'delRow' && cells.length > 1) cells.pop()
    else if (op === 'delCol' && (cells[0]?.length ?? 0) > 1) cells.forEach((r) => r.pop())
    store.updateElement(slideId, t.id, { cells: JSON.stringify(cells) })
  }
  const remove = () => {
    if (!slideId || !editable) return
    doc.transact(() => sel.forEach((e) => store.removeElement(slideId, e.id)))
    setSelected([])
  }
  const duplicate = () => {
    if (!slideId || !editable || !sel.length) return
    const ids2 = sel.map((e) => {
      const { id: _id, ...rest } = e
      return store.addElement(slideId, { ...rest, x: Math.min(90, e.x + 3), y: Math.min(90, e.y + 3) })
    })
    setSelected(ids2)
  }
  const align = (kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!sel.length) return
    patchEach((e) => (kind === 'left' ? { x: 0 } : kind === 'center' ? { x: r2(50 - e.w / 2) } : kind === 'right' ? { x: r2(100 - e.w) } : kind === 'top' ? { y: 0 } : kind === 'middle' ? { y: r2(50 - e.h / 2) } : { y: r2(100 - e.h) }))
  }
  const patchEach = (fn: (e: Elem) => Partial<Elem>) => {
    if (!slideId || !editable) return
    doc.transact(() => sel.forEach((e) => store.updateElement(slideId, e.id, fn(e))))
  }
  const restack = (where: 'front' | 'back' | 'forward' | 'backward') => {
    if (!slideId) return
    doc.transact(() => (where === 'front' || where === 'forward' ? sel : [...sel].reverse()).forEach((e) => store.restack(slideId, e.id, where)))
  }
  const setBg = (color: string, all: boolean) => {
    if (!slideId) return
    doc.transact(() => (all ? ids : [slideId]).forEach((id) => store.setBg(id, color)))
  }
  const ratioKey = Object.entries(RATIOS).find(([, [w, h]]) => Math.abs(w / h - store.width / store.height) < 0.01)?.[0] ?? '16:9'

  const copy = () => {
    clipboard.current = sel.map(({ id: _id, ...rest }) => rest)
  }
  const paste = () => {
    if (!slideId || !editable || !clipboard.current.length) return
    select(clipboard.current.map((e) => store.addElement(slideId, { ...e, x: Math.min(90, e.x + 3), y: Math.min(90, e.y + 3) })))
    clipboard.current = clipboard.current.map((e) => ({ ...e, x: Math.min(90, e.x + 3), y: Math.min(90, e.y + 3) }))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (editingText || editingTable || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) undo.current?.redo(); else undo.current?.undo(); return }
    if (mod && key === 'y') { e.preventDefault(); undo.current?.redo(); return }
    if (!editable) return
    if (mod && key === 'a') { e.preventDefault(); setSelected(elems.map((x) => x.id)); return }
    if (mod && key === 'c') { e.preventDefault(); copy(); return }
    if (mod && key === 'x') { e.preventDefault(); copy(); remove(); return }
    if (mod && key === 'v') { e.preventDefault(); paste(); return }
    if (!sel.length) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
    else if (mod && key === 'd') { e.preventDefault(); duplicate() }
    else if (e.key === 'Escape') setSelected([])
    else if (e.key === 'Enter' && sel.length === 1 && (sel[0]!.type === 'text' || sel[0]!.type === 'shape')) { e.preventDefault(); setEditingText(sel[0]!.id) }
    else if (e.key === 'Enter' && sel.length === 1 && sel[0]!.type === 'table') { e.preventDefault(); setEditingTable(sel[0]!.id) }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 2 : 0.5
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
      patchEach((x) => ({ x: r2(x.x + dx), y: r2(x.y + dy) }))
    }
  }

  const newSlide = (layout: string) => {
    if (!slideId) return
    const l = LAYOUTS.find((x) => x.id === layout) ?? LAYOUTS[1]!
    setCurrent(store.addSlide(slideId, l.make()))
    setSelected([])
  }

  const api: SlidesApi = {
    canEdit: editable, sel, ed, bg: slideId ? store.bg(slideId) : '#ffffff', notesOpen, slideCount: ids.length, ratio: ratioKey,
    undo: () => undo.current?.undo(), redo: () => undo.current?.redo(),
    newSlide, duplicateSlide: () => slideId && setCurrent(store.duplicateSlide(slideId)), deleteSlide: () => slideId && store.removeSlide(slideId),
    addText, addShape, addImage: (f) => void addImage(f), addChart: () => setChartDlg({ id: null, spec: null }), addTable,
    patch, restack, align, rotate: (deg) => patchEach((e) => ({ rot: (((e.rot ?? 0) + deg) % 360 + 360) % 360 })), duplicate, remove, setBg,
    setRatio: (r) => { const [w, h] = RATIOS[r] ?? RATIOS['16:9']!; store.setSize(w, h) },
    present: (fromStart) => setPresenting(fromStart ? 0 : Math.max(0, ids.indexOf(slideId!))),
    toggleNotes: () => setNotesOpen((o) => !o), tableOp,
    editChart: () => { const c = sel[0]; if (c?.type === 'chart') setChartDlg({ id: c.id, spec: parseSpec(c.spec) }) },
  }

  const applyChart = (spec: ChartSpec) => {
    if (!slideId || !chartDlg) return
    if (chartDlg.id) store.updateElement(slideId, chartDlg.id, { spec: JSON.stringify(spec) })
    else select(store.addElement(slideId, { type: 'chart', x: 20, y: 18, w: 60, h: 68, spec: JSON.stringify(spec) }))
    setChartDlg(null)
  }

  if (!slideId) return <div className="empty"><strong>Esta presentación no tiene diapositivas</strong>{editable && <button className="btn" onClick={() => setCurrent(store.addSlide())}>Añadir diapositiva</button>}</div>

  const single = sel.length === 1 ? sel[0]! : null
  const boxStyle = (el: Elem) => ({ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, transform: el.rot ? `rotate(${el.rot}deg)` : undefined })

  return (
    <div className="slides-editor" onKeyDown={onKeyDown} tabIndex={-1}>
      {editable ? <SlidesRibbon api={api} /> : (
        <div className="toolbar"><span className="grow" /><button className="tb txt" onClick={() => setPresenting(Math.max(0, ids.indexOf(slideId)))}>Presentar</button></div>
      )}

      <div className="slides-main">
        <div className="slide-rail" role="listbox" aria-label="Diapositivas">
          {ids.map((id, i) => (
            <div key={id} className={`slide-thumb ${id === slideId ? 'on' : ''}`} role="option" aria-selected={id === slideId} tabIndex={0} draggable={editable}
              onDragStart={(e) => e.dataTransfer.setData('text/x-nora-slide', id)} onDragOver={(e) => e.dataTransfer.types.includes('text/x-nora-slide') && e.preventDefault()}
              onDrop={(e) => { const from = e.dataTransfer.getData('text/x-nora-slide'); if (from && from !== id) { e.preventDefault(); store.moveSlide(from, i) } }}
              onClick={() => { setCurrent(id); setSelected([]); setEditingText(null) }} onKeyDown={(e) => e.key === 'Enter' && setCurrent(id)}>
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
          {editable && <button className="btn sm" onClick={() => newSlide('content')}><Plus size={14} /> Diapositiva</button>}
        </div>

        <div className="stage-col">
          <div ref={area} className="stage-area" onPointerDown={onStageDown}>
            <div ref={stageBox} className="sl-slide stage" style={{ width: stageW, height: stageH, background: store.bg(slideId) }} onPointerDown={(e) => { if (e.target === e.currentTarget) { e.stopPropagation(); onStageDown(e) } }}>
              {elems.map((el) => {
                const editingThis = editingText === el.id
                return (
                  <div key={el.id}>
                    <ElementView e={el} stageW={stageW} stageH={stageH} k={k}
                      textOverride={editingThis ? <TextEditing provider={provider} store={store} slideId={slideId} el={el} k={k} onEditor={setEd} onDone={() => setEditingText(null)} /> : undefined} />
                    {editingTable === el.id && <TableEdit store={store} slideId={slideId} el={el} k={k} onDone={() => setEditingTable(null)} />}
                    {!editingThis && editingTable !== el.id && (
                      <div className="sl-hit" style={boxStyle(el)} onPointerDown={(e) => onElementDown(e, el)}
                        onDoubleClick={() => {
                          if (!editable) return
                          if (el.type === 'text' || el.type === 'shape') setEditingText(el.id)
                          else if (el.type === 'table') setEditingTable(el.id)
                          else if (el.type === 'chart') setChartDlg({ id: el.id, spec: parseSpec(el.spec) })
                        }} />
                    )}
                    {peers.filter((p) => p.slide === slideId && p.el === el.id).map((p) => (
                      <div key={p.clientId} className="sl-peer" style={{ ...boxStyle(el), borderColor: p.color }}><span style={{ background: p.color }}>{p.name}</span></div>
                    ))}
                    {selected.includes(el.id) && editable && !editingThis && editingTable !== el.id && (
                      <div className="sl-sel" style={boxStyle(el)}>
                        {single?.id === el.id && (
                          <>
                            {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => <span key={h} className={`sl-handle ${h}`} onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, h, [el.id]) }} />)}
                            <span className="sl-rot" title="Girar" onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, 'rot', [el.id]) }} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {guides.x.map((x) => <i key={`gx${x}`} className="sl-guide v" style={{ left: `${x}%` }} />)}
              {guides.y.map((y) => <i key={`gy${y}`} className="sl-guide h" style={{ top: `${y}%` }} />)}
              {marquee && <div className="sl-marquee" style={{ left: `${marquee.x}%`, top: `${marquee.y}%`, width: `${marquee.w}%`, height: `${marquee.h}%` }} />}
            </div>
          </div>
          {notesOpen && <NotesBox store={store} slideId={slideId} editable={editable} />}
        </div>
      </div>
      {presenting !== null && <Presenter store={store} ids={ids} start={presenting} version={version} onClose={() => setPresenting(null)} />}
      {chartDlg && <ChartDialog initial={chartDlg.spec ?? undefined} onOk={applyChart} onCancel={() => setChartDlg(null)} />}
    </div>
  )
}

/** Editor del texto de un cuadro: TipTap enlazado a un fragmento Yjs propio, así varias personas escriben a la vez y con formato. */
function TextEditing({ provider, store, slideId, el, k, onEditor, onDone }: { provider: CollabProvider; store: SlidesStore; slideId: string; el: Elem; k: number; onEditor: (e: Editor | null) => void; onDone: () => void }) {
  const elRef = useRef(el)
  elRef.current = el
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const field = `t:${el.id}`
  const extensions = useMemo(() => [
    StarterKit.configure({ history: false, heading: false, blockquote: false, codeBlock: false, horizontalRule: false, code: false }),
    Underline, TextStyle, Color, FontFamily, FontSize, Subscript, Superscript, TextAlign.configure({ types: ['paragraph'] }),
    Collaboration.configure({ document: provider.doc, field }),
  ], [provider.doc, field])

  const sync = useCallback((editor: Editor) => {
    store.updateElement(slideId, elRef.current.id, { html: editor.getHTML(), text: plainOf(editor.getHTML()) }, 'html-sync')
  }, [store, slideId])

  const editor = useEditor({
    extensions,
    injectCSS: false,
    autofocus: 'end',
    editorProps: { attributes: { class: 'sl-prose', 'aria-label': 'Texto de la diapositiva' } },
    onCreate: ({ editor }) => {
      const frag = provider.doc.getXmlFragment(field)
      if (frag.length === 0 && elRef.current.html) editor.commands.setContent(elRef.current.html, false)
      onEditor(editor)
    },
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => sync(editor), 150)
    },
  }, [extensions])

  useEffect(() => () => {
    clearTimeout(timer.current)
    if (editor && !editor.isDestroyed) sync(editor)
    onEditor(null)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <RichText e={el} k={k}>
      <div className="sl-editing" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onDone() }} onPointerDown={(e) => e.stopPropagation()}>
        <EditorContent editor={editor} />
      </div>
    </RichText>
  )
}

/** Celdas de una tabla en edición. */
function TableEdit({ store, slideId, el, k, onDone }: { store: SlidesStore; slideId: string; el: Elem; k: number; onDone: () => void }) {
  const cells = useMemo(() => { try { return JSON.parse(el.cells ?? '[]') as string[][] } catch { return [] } }, [el.cells])
  const set = (r: number, c: number, v: string) => {
    const next = cells.map((row) => [...row])
    next[r]![c] = v
    store.updateElement(slideId, el.id, { cells: JSON.stringify(next) })
  }
  return (
    <div className="sl-el sl-table-edit" style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onDone() }}>
      <table className="sl-table" style={{ zoom: k * 0.75, fontFamily: el.ff ? `${el.ff}, ${DEFAULT_FONT}` : DEFAULT_FONT, fontSize: `${el.fontSize ?? 14}pt` }}>
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>{row.map((c, i) => (
              <td key={i}><input autoFocus={r === 0 && i === 0} value={c} aria-label={`Fila ${r + 1}, columna ${i + 1}`} onChange={(e) => set(r, i, e.target.value)} /></td>
            ))}</tr>
          ))}
        </tbody>
      </table>
      <button className="btn sm sl-table-done" onClick={onDone}>Listo</button>
    </div>
  )
}

/** Notas del orador de la diapositiva (texto compartido). */
function NotesBox({ store, slideId, editable }: { store: SlidesStore; slideId: string; editable: boolean }) {
  const ytext = store.notesOf(slideId)
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
    sync()
    return () => ytext?.unobserve(sync)
  }, [ytext, sync, slideId])
  if (!ytext) return null
  return (
    <div className="notes-box">
      <strong className="small">Notas del orador</strong>
      <textarea ref={ref} key={slideId} defaultValue={ytext.toString()} readOnly={!editable} placeholder="Escribe aquí las notas de esta diapositiva…" aria-label="Notas del orador"
        onChange={(e) => setYText(ytext, e.target.value)} />
    </div>
  )
}

function Presenter({ store, ids, start, version, onClose }: { store: SlidesStore; ids: string[]; start: number; version: number; onClose: () => void }) {
  const [i, setI] = useState(Math.max(0, start))
  const [notes, setNotes] = useState(false)
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
      else if (e.key.toLowerCase() === 'n') setNotes((v) => !v)
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(ids.length - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose, ids.length])
  const ratio = store.width / store.height
  const w = Math.min(size.w, size.h * ratio)
  const note = store.notesOf(ids[i]!)?.toString() ?? ''
  return (
    <div className="presenter" onClick={() => go(1)} role="dialog" aria-label="Presentación">
      <button className="icon-btn presenter-x" aria-label="Salir de la presentación" onClick={(e) => { e.stopPropagation(); onClose() }}><X size={20} /></button>
      <SlideView store={store} id={ids[i]!} width={w} version={version} />
      <span className="presenter-n">{i + 1} / {ids.length} · N: notas</span>
      {notes && <div className="presenter-notes" onClick={(e) => e.stopPropagation()}>{note || 'Sin notas en esta diapositiva.'}</div>}
    </div>
  )
}

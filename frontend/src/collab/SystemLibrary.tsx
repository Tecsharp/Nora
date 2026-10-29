import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { exportToSvg } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { ChevronDown, ChevronRight, Library } from 'lucide-react'
import { prettyLibraryName } from './libraryNames'

export interface SysItem { id: string; name?: string; elements: unknown[] }
export interface SysGroup { id: string; name: string; items: SysItem[] }

const SHOWN = 8 // elementos que se ven de cada biblioteca hasta pulsar «Ver todos»
const previews = new Map<string, string>() // id+tema → data URL del SVG (se dibuja una sola vez)

/** Miniatura de un elemento de biblioteca: se dibuja solo cuando entra en pantalla, para no cargar la app. */
const Tile = memo(function Tile({ item, dark, onInsert }: { item: SysItem; dark: boolean; onInsert: (i: SysItem) => void }) {
  const key = `${item.id}:${dark ? 'd' : 'l'}`
  const [src, setSrc] = useState<string | null>(previews.get(key) ?? null)
  const box = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (src || !box.current) return
    let alive = true
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      void exportToSvg({ elements: item.elements as never, appState: { exportBackground: false, exportWithDarkMode: dark } as never, files: null, exportPadding: 6 })
        .then((svg: SVGSVGElement) => {
          const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
          previews.set(key, url)
          if (alive) setSrc(url)
        })
        .catch(() => undefined)
    }, { rootMargin: '120px' })
    io.observe(box.current)
    return () => { alive = false; io.disconnect() }
  }, [src, key, item.elements, dark])
  return (
    <button ref={box} type="button" className="syslib-tile" title={item.name ? `${item.name} · clic para añadir` : 'Clic para añadirlo a la pizarra'} onClick={() => onInsert(item)}>
      {src ? <img src={src} alt={item.name ?? ''} draggable={false} /> : <span className="syslib-ph" />}
    </button>
  )
})

function Group({ g, dark, onInsert }: { g: SysGroup; dark: boolean; onInsert: (i: SysItem) => void }) {
  const [open, setOpen] = useState(true) // de entrada desplegada
  const [all, setAll] = useState(false)
  const items = all ? g.items : g.items.slice(0, SHOWN)
  return (
    <section className="syslib-group">
      <button type="button" className="syslib-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="truncate">{prettyLibraryName(g.name)}</span>
        <span className="syslib-count">{g.items.length}</span>
      </button>
      {open && (
        <>
          <div className="syslib-grid">{items.map((i) => <Tile key={i.id} item={i} dark={dark} onInsert={onInsert} />)}</div>
          {g.items.length > SHOWN && (
            <button type="button" className="syslib-more" onClick={() => setAll((a) => !a)}>{all ? 'Ver menos' : `Ver todos (${g.items.length})`}</button>
          )}
        </>
      )}
    </section>
  )
}

/** Pestaña «SISTEMA» de la biblioteca de la pizarra: cada biblioteca del sistema por separado, plegable y con sus elementos. */
export default function SystemLibrary({ groups, dark, onInsert }: { groups: SysGroup[]; dark: boolean; onInsert: (i: SysItem) => void }) {
  const sorted = useMemo(() => [...groups].sort((a, b) => prettyLibraryName(a.name).localeCompare(prettyLibraryName(b.name), 'es', { numeric: true })), [groups])
  return (
    <div className="syslib">
      <h3 className="syslib-title"><Library size={16} /> SISTEMA</h3>
      {groups.length === 0 ? <p className="syslib-empty">Todavía no hay bibliotecas del sistema.</p> : sorted.map((g) => <Group key={g.id} g={g} dark={dark} onInsert={onInsert} />)}
    </div>
  )
}

export type { ExcalidrawImperativeAPI }

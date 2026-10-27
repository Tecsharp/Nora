import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import CharacterCount from '@tiptap/extension-character-count'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, BarChart3, Bold, CalendarDays, ChevronLeft, ChevronRight, Code, Eraser, Highlighter, ImagePlus, Indent as IndentIcon,
  Italic, Link2, List, ListOrdered, ListTree, Minus, Outdent, Quote, Redo2, Search, Strikethrough, Subscript as SubIcon, Superscript as SupIcon, Table2, Underline as UnderlineIcon, Undo2, X,
} from 'lucide-react'
import type { CollabProvider } from './provider'
import { shrinkImage } from './image'
import { ChartDialog, chartPng, type ChartSpec } from './chart'
import { ChartNode, CellWithBg, FindReplace, FontSize, HeaderWithBg, Indent, LineHeight, SizedImage, findKey } from './textExtras'
import { ColorPick, Group, Ribbon, Sel, TB } from './ui'
import Menu from '../components/Menu'

/** Cursor de otra persona. Se construye con la API de estilos (no con atributos style) para cumplir la CSP del gateway. */
function renderCursor(user: { name: string; color: string }) {
  const cursor = document.createElement('span')
  cursor.classList.add('collab-caret')
  cursor.style.setProperty('border-color', user.color)
  const label = document.createElement('div')
  label.classList.add('collab-caret-label')
  label.style.setProperty('background-color', user.color)
  label.textContent = user.name
  cursor.appendChild(label)
  return cursor
}

const FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Verdana']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]
const DEFAULT_SIZE = 11

interface Props {
  provider: CollabProvider
  editable: boolean
  onEditor: (e: Editor | null) => void
}

export default function TextEditor({ provider, editable, onEditor }: Props) {
  const self = provider.user
  const [zoom, setZoom] = useState(100)
  const [outline, setOutline] = useState(false)
  const [finding, setFinding] = useState(false)
  const [chartDlg, setChartDlg] = useState<null | { pos: number | null; spec: ChartSpec | null }>(null)

  const extensions = useMemo(
    () => [
      StarterKit.configure({ history: false }), // el historial lo lleva Yjs (deshacer solo lo propio)
      Underline, TextStyle, Color, FontFamily, FontSize, Highlight.configure({ multicolor: true }), Subscript, Superscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }), LineHeight, Indent,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      SizedImage.configure({ allowBase64: true, inline: false }), ChartNode,
      Table.configure({ resizable: false }), TableRow, HeaderWithBg, CellWithBg,
      CharacterCount, FindReplace,
      Placeholder.configure({ placeholder: 'Empieza a escribir…' }),
      Collaboration.configure({ document: provider.doc }),
      CollaborationCursor.configure({ provider: { awareness: provider.awareness }, user: { id: self.id, name: self.name, color: self.color }, render: renderCursor }),
    ],
    [provider, self.id, self.name, self.color],
  )

  const editor = useEditor(
    {
      extensions,
      editable,
      injectCSS: false, // la CSP no permite <style> inyectados: los estilos del editor están en styles.css
      editorProps: { attributes: { class: 'doc-page', 'aria-label': 'Documento', spellcheck: 'true' } },
    },
    [extensions],
  )

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])
  useEffect(() => {
    onEditor(editor)
    return () => onEditor(null)
  }, [editor, onEditor])
  useEffect(() => {
    if (!editor) return
    editor.storage.chart.onEdit = (pos: number, spec: string) => {
      if (!editable) return
      try {
        setChartDlg({ pos, spec: JSON.parse(spec) as ChartSpec })
      } catch { /* gráfico sin datos (importado): no se puede editar */ }
    }
  }, [editor, editable])
  // Ctrl/Cmd+F abre «Buscar y reemplazar» en lugar de la búsqueda del navegador
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFinding(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function applyChart(spec: ChartSpec) {
    if (!editor) return
    const dlg = chartDlg
    setChartDlg(null)
    const node = dlg?.pos != null ? editor.state.doc.nodeAt(dlg.pos) : null
    const w = (node?.attrs.width as number) ?? 480
    const h = Math.round(w * 0.6)
    const src = await chartPng(spec, w * 1.3, h * 1.3, 2)
    const attrs = { src, spec: JSON.stringify(spec), width: w, height: h, alt: spec.title || 'Gráfico' }
    if (dlg?.pos != null && node) editor.chain().command(({ tr }) => (tr.setNodeMarkup(dlg.pos!, undefined, attrs), true)).run()
    else editor.chain().focus().insertChart(attrs).run()
  }

  const stats = editor ? { words: editor.storage.characterCount.words() as number, chars: editor.storage.characterCount.characters() as number } : { words: 0, chars: 0 }
  const headings: { level: number; text: string; pos: number }[] = []
  if (editor && outline) editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') headings.push({ level: n.attrs.level as number, text: n.textContent, pos }) })

  return (
    <div className="text-editor">
      {editor && editable && <TextRibbon editor={editor} zoom={zoom} setZoom={setZoom} outline={outline} setOutline={setOutline} onFind={() => setFinding(true)} onChart={() => setChartDlg({ pos: null, spec: null })} />}
      <div className="doc-work">
        {outline && (
          <nav className="doc-outline" aria-label="Esquema del documento">
            <strong className="small">Esquema</strong>
            {headings.length === 0 ? <span className="muted small">Los títulos del documento aparecerán aquí.</span> : headings.map((h) => (
              <button key={h.pos} className="outline-item" data-level={h.level} onClick={() => { editor?.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run() }}>{h.text || '(sin texto)'}</button>
            ))}
          </nav>
        )}
        <div className="doc-scroll">
          {finding && editor && <FindBar editor={editor} editable={editable} onClose={() => { editor.commands.setFind(''); setFinding(false) }} />}
          <div className="doc-zoom" style={{ zoom: zoom / 100 }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <div className="doc-status" role="status">
        <span>{stats.words} palabras</span><span>{stats.chars} caracteres</span><span>≈ {Math.max(1, Math.ceil(stats.words / 450))} pág.</span>
        <span className="grow" />
        {!editable && <button className="btn sm" onClick={() => setFinding(true)}><Search size={13} /> Buscar</button>}
        <label className="zoom-ctl">Zoom <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" /> {zoom}%</label>
      </div>
      {chartDlg && <ChartDialog initial={chartDlg.spec ?? undefined} onOk={(s) => void applyChart(s)} onCancel={() => setChartDlg(null)} />}
    </div>
  )
}

function FindBar({ editor, editable, onClose }: { editor: Editor; editable: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const [rep, setRep] = useState('')
  const [cs, setCs] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const st = findKey.getState(editor.state)
  const n = st?.matches.length ?? 0
  const run = (t: string, c: boolean) => editor.commands.setFind(t, c)
  return (
    <div className="findbar" role="search" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="row">
        <input ref={ref} placeholder="Buscar" aria-label="Buscar" value={term} onChange={(e) => { setTerm(e.target.value); run(e.target.value, cs) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.findStep(e.shiftKey ? -1 : 1) } }} />
        <span className="muted small nowrap">{term ? (n ? `${(st?.index ?? 0) + 1} de ${n}` : 'Sin resultados') : ''}</span>
        <button className="icon-btn sm" aria-label="Anterior" onClick={() => editor.commands.findStep(-1)}><ChevronLeft size={15} /></button>
        <button className="icon-btn sm" aria-label="Siguiente" onClick={() => editor.commands.findStep(1)}><ChevronRight size={15} /></button>
        <label className="small nowrap"><input type="checkbox" checked={cs} onChange={(e) => { setCs(e.target.checked); run(term, e.target.checked) }} /> Aa</label>
        <button className="icon-btn sm" aria-label="Cerrar la búsqueda" onClick={onClose}><X size={15} /></button>
      </div>
      {editable && (
        <div className="row">
          <input placeholder="Reemplazar con" aria-label="Reemplazar con" value={rep} onChange={(e) => setRep(e.target.value)} />
          <button className="btn sm" disabled={!n} onClick={() => editor.commands.replaceCurrent(rep)}>Reemplazar</button>
          <button className="btn sm" disabled={!n} onClick={() => editor.commands.replaceAll(rep)}>Todo</button>
        </div>
      )}
    </div>
  )
}

function TextRibbon({ editor, zoom, setZoom, outline, setOutline, onFind, onChart }: {
  editor: Editor; zoom: number; setZoom: (z: number) => void; outline: boolean; setOutline: (b: boolean) => void; onFind: () => void; onChart: () => void
}) {
  const chain = () => editor.chain().focus()
  const ts = editor.getAttributes('textStyle') as { color?: string; fontFamily?: string; fontSize?: string }
  const family = ts.fontFamily ? ts.fontFamily.split(',')[0]!.replace(/['"]/g, '').trim() : ''
  const size = ts.fontSize ? Math.round(parseFloat(ts.fontSize)) : DEFAULT_SIZE
  const stepSize = (d: number) => {
    const next = d > 0 ? SIZES.find((s) => s > size) ?? size : [...SIZES].reverse().find((s) => s < size) ?? size
    chain().setFontSize(`${next}pt`).run()
  }
  const heading = [1, 2, 3, 4].find((l) => editor.isActive('heading', { level: l })) ?? 0
  const lh = (editor.getAttributes('paragraph').lineHeight ?? editor.getAttributes('heading').lineHeight ?? '') as string
  const inTable = editor.isActive('table')
  const imgSel = editor.isActive('image')
  const chartSel = editor.isActive('chart')

  async function onImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const src = await shrinkImage(file, 1600, 0.86)
    chain().setImage({ src, alt: file.name }).run()
  }

  function setLink() {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Dirección del enlace (vacío para quitarlo)', prev ?? 'https://')
    if (url === null) return
    if (url.trim() === '') chain().extendMarkRange('link').unsetLink().run()
    else if (/^(https?:|mailto:)/i.test(url.trim())) chain().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  function resizeChart(w: number) {
    const a = editor.getAttributes('chart') as { width: number; height: number }
    const ratio = a.width ? a.height / a.width : 0.6
    chart(w, Math.round(w * ratio))
  }
  const chart = (width: number, height: number) => chain().updateAttributes('chart', { width, height }).run()

  const tableMenu = [2, 3, 4, 5, 6].map((n) => ({ label: `${n} × ${n}`, icon: <Table2 size={16} />, onClick: () => chain().insertTable({ rows: n, cols: n, withHeaderRow: true }).run() }))

  return (
    <Ribbon initial="home" tabs={[
      {
        id: 'home', label: 'Inicio', content: (
          <>
            <Group title="Deshacer">
              <TB label="Deshacer (Ctrl+Z)" icon={<Undo2 size={16} />} onClick={() => chain().undo().run()} />
              <TB label="Rehacer (Ctrl+Y)" icon={<Redo2 size={16} />} onClick={() => chain().redo().run()} />
            </Group>
            <Group title="Fuente">
              <Sel label="Fuente" width={150} value={FONTS.includes(family) ? family : ''} onChange={(v) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run())}
                options={[['', family && !FONTS.includes(family) ? family : 'Predeterminada'], ...FONTS.map((f): [string, string] => [f, f])]} />
              <TB label="Reducir tamaño" text="A−" onClick={() => stepSize(-1)} />
              <Sel label="Tamaño de letra" width={64} value={String(SIZES.includes(size) ? size : '')} onChange={(v) => chain().setFontSize(`${v}pt`).run()}
                options={[...(SIZES.includes(size) ? [] : [['', String(size)] as [string, string]]), ...SIZES.map((s): [string, string] => [String(s), String(s)])]} />
              <TB label="Aumentar tamaño" text="A+" onClick={() => stepSize(1)} />
              <TB label="Negrita (Ctrl+B)" icon={<Bold size={16} />} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
              <TB label="Cursiva (Ctrl+I)" icon={<Italic size={16} />} active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
              <TB label="Subrayado (Ctrl+U)" icon={<UnderlineIcon size={16} />} active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
              <TB label="Tachado" icon={<Strikethrough size={16} />} active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
              <TB label="Subíndice" icon={<SubIcon size={16} />} active={editor.isActive('subscript')} onClick={() => chain().toggleSubscript().run()} />
              <TB label="Superíndice" icon={<SupIcon size={16} />} active={editor.isActive('superscript')} onClick={() => chain().toggleSuperscript().run()} />
              <ColorPick label="Color del texto" icon={<span className="tb-a">A</span>} value={ts.color} onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())} none="Automático" />
              <ColorPick label="Resaltado" icon={<Highlighter size={16} />} value={(editor.getAttributes('highlight').color as string) ?? '#ffec99'} onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())} none="Sin resaltado" />
              <TB label="Borrar formato" icon={<Eraser size={16} />} onClick={() => chain().unsetAllMarks().clearNodes().run()} />
            </Group>
            <Group title="Párrafo">
              <Sel label="Estilo de párrafo" width={118} value={String(heading)} onChange={(v) => (v === '0' ? chain().setParagraph().run() : chain().setHeading({ level: Number(v) as 1 | 2 | 3 | 4 }).run())}
                options={[['0', 'Texto normal'], ['1', 'Título 1'], ['2', 'Título 2'], ['3', 'Título 3'], ['4', 'Título 4']]} />
              <TB label="Alinear a la izquierda" icon={<AlignLeft size={16} />} active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()} />
              <TB label="Centrar" icon={<AlignCenter size={16} />} active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()} />
              <TB label="Alinear a la derecha" icon={<AlignRight size={16} />} active={editor.isActive({ textAlign: 'right' })} onClick={() => chain().setTextAlign('right').run()} />
              <TB label="Justificar" icon={<AlignJustify size={16} />} active={editor.isActive({ textAlign: 'justify' })} onClick={() => chain().setTextAlign('justify').run()} />
              <Sel label="Interlineado" width={74} value={lh} onChange={(v) => chain().setLineHeight(v).run()} options={[['', 'Interl.'], ['1', '1,0'], ['1.15', '1,15'], ['1.5', '1,5'], ['2', '2,0']]} />
              <TB label="Lista con viñetas" icon={<List size={16} />} active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
              <TB label="Lista numerada" icon={<ListOrdered size={16} />} active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
              <TB label="Disminuir sangría" icon={<Outdent size={16} />} onClick={() => (editor.isActive('listItem') ? chain().liftListItem('listItem').run() : chain().changeIndent(-1).run())} />
              <TB label="Aumentar sangría" icon={<IndentIcon size={16} />} onClick={() => (editor.isActive('listItem') ? chain().sinkListItem('listItem').run() : chain().changeIndent(1).run())} />
              <TB label="Cita" icon={<Quote size={16} />} active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} />
            </Group>
            <Group title="Edición">
              <TB label="Buscar y reemplazar (Ctrl+F)" icon={<Search size={16} />} text="Buscar" onClick={onFind} />
            </Group>
          </>
        ),
      },
      {
        id: 'insert', label: 'Insertar', content: (
          <>
            <Group title="Ilustraciones">
              <label className="tb txt" title="Insertar imagen"><ImagePlus size={16} /><span>Imagen</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onImage} /></label>
              <TB label="Insertar gráfico" icon={<BarChart3 size={16} />} text="Gráfico" onClick={onChart} />
              <Menu label="Insertar tabla" trigger={<span className="tb txt"><Table2 size={16} /><span>Tabla</span></span>} items={tableMenu} />
            </Group>
            <Group title="Elementos">
              <TB label="Enlace" icon={<Link2 size={16} />} text="Enlace" active={editor.isActive('link')} onClick={setLink} />
              <TB label="Línea separadora" icon={<Minus size={16} />} text="Línea" onClick={() => chain().setHorizontalRule().run()} />
              <TB label="Bloque de código" icon={<Code size={16} />} text="Código" active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()} />
              <TB label="Insertar la fecha de hoy" icon={<CalendarDays size={16} />} text="Fecha" onClick={() => chain().insertContent(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })).run()} />
            </Group>
            {imgSel && (
              <Group title="Imagen seleccionada">
                {['25%', '50%', '75%', '100%'].map((w) => <TB key={w} label={`Ancho ${w}`} text={w} active={editor.getAttributes('image').width === w} onClick={() => chain().updateAttributes('image', { width: w }).run()} />)}
              </Group>
            )}
            {chartSel && (
              <Group title="Gráfico seleccionado">
                {[320, 480, 640].map((w) => <TB key={w} label={`Ancho ${w}`} text={w === 320 ? 'Pequeño' : w === 480 ? 'Mediano' : 'Grande'} active={editor.getAttributes('chart').width === w} onClick={() => resizeChart(w)} />)}
                <TB label="Editar datos del gráfico" text="Editar datos" onClick={() => editor.storage.chart.onEdit?.(editor.state.selection.from, editor.getAttributes('chart').spec)} />
                <TB label="Quitar gráfico" icon={<X size={15} />} danger onClick={() => chain().deleteSelection().run()} />
              </Group>
            )}
          </>
        ),
      },
      {
        id: 'table', label: 'Tabla', content: (
          <>
            <Group title="Filas y columnas">
              <TB label="Insertar fila arriba" text="+ Fila arriba" disabled={!inTable} onClick={() => chain().addRowBefore().run()} />
              <TB label="Insertar fila abajo" text="+ Fila abajo" disabled={!inTable} onClick={() => chain().addRowAfter().run()} />
              <TB label="Insertar columna a la izquierda" text="+ Col. izq." disabled={!inTable} onClick={() => chain().addColumnBefore().run()} />
              <TB label="Insertar columna a la derecha" text="+ Col. der." disabled={!inTable} onClick={() => chain().addColumnAfter().run()} />
              <TB label="Eliminar fila" text="− Fila" disabled={!inTable} onClick={() => chain().deleteRow().run()} />
              <TB label="Eliminar columna" text="− Columna" disabled={!inTable} onClick={() => chain().deleteColumn().run()} />
            </Group>
            <Group title="Celdas">
              <TB label="Combinar celdas" text="Combinar" disabled={!inTable} onClick={() => chain().mergeCells().run()} />
              <TB label="Dividir celda" text="Dividir" disabled={!inTable} onClick={() => chain().splitCell().run()} />
              <TB label="Fila de encabezado" text="Encabezado" disabled={!inTable} onClick={() => chain().toggleHeaderRow().run()} />
              <ColorPick label="Color de fondo de la celda" icon={<span className="tb-fill-ico" />} value={(editor.getAttributes('tableCell').backgroundColor as string) ?? undefined}
                onPick={(c) => chain().setCellAttribute('backgroundColor', c).run()} none="Sin color" />
            </Group>
            <Group title="Tabla">
              <TB label="Eliminar tabla" text="Eliminar tabla" danger disabled={!inTable} onClick={() => chain().deleteTable().run()} />
            </Group>
            {!inTable && <span className="muted small" style={{ alignSelf: 'center', paddingLeft: 8 }}>Coloca el cursor dentro de una tabla para usar estas opciones.</span>}
          </>
        ),
      },
      {
        id: 'view', label: 'Vista', content: (
          <>
            <Group title="Mostrar">
              <TB label="Esquema del documento" icon={<ListTree size={16} />} text="Esquema" active={outline} onClick={() => setOutline(!outline)} />
              <TB label="Buscar y reemplazar" icon={<Search size={16} />} text="Buscar" onClick={onFind} />
            </Group>
            <Group title="Zoom">
              <Sel label="Zoom" width={80} value={String(zoom)} onChange={(v) => setZoom(Number(v))} options={[50, 75, 90, 100, 125, 150, 200].map((z): [string, string] => [String(z), `${z}%`])} />
            </Group>
          </>
        ),
      },
    ]} />
  )
}

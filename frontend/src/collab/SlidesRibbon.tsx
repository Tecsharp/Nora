import type { Editor } from '@tiptap/react'
import {
  AlignCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, ArrowDownToLine, ArrowUpToLine, BarChart3, Bold, ChevronDown, Copy, Italic, List, ListOrdered, Maximize, Notebook, Plus, Redo2, RotateCw, Shapes, Strikethrough,
  Table2, Trash2, Type, Underline, Undo2, ImagePlus, MoveDown, MoveUp, PlayCircle,
} from 'lucide-react'
import Menu from '../components/Menu'
import { ColorPick, Group, Ribbon, Sel, TB } from './ui'
import { LAYOUTS } from './slideLayouts'
import { SHAPES } from './SlideRender'
import type { Elem, ShapeKind } from './slidesModel'

export interface SlidesApi {
  canEdit: boolean
  sel: Elem[]
  ed: Editor | null
  bg: string
  notesOpen: boolean
  slideCount: number
  ratio: string
  undo: () => void
  redo: () => void
  newSlide: (layout: string) => void
  duplicateSlide: () => void
  deleteSlide: () => void
  addText: () => void
  addShape: (k: ShapeKind) => void
  addImage: (f: File) => void
  addChart: () => void
  addTable: (rows: number, cols: number) => void
  patch: (p: Partial<Elem>) => void
  restack: (w: 'front' | 'back' | 'forward' | 'backward') => void
  align: (k: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void
  rotate: (deg: number) => void
  duplicate: () => void
  remove: () => void
  setBg: (c: string, all: boolean) => void
  setRatio: (r: string) => void
  present: (fromStart: boolean) => void
  toggleNotes: () => void
  tableOp: (op: 'addRow' | 'addCol' | 'delRow' | 'delCol' | 'header') => void
  editChart: () => void
}

const FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Verdana']
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 66, 80, 96]

export default function SlidesRibbon({ api: a }: { api: SlidesApi }) {
  const el = a.sel[0]
  const ed = a.ed
  const textual = a.sel.some((e) => e.type === 'text' || e.type === 'shape' || e.type === 'table')
  const ts = ed ? (ed.getAttributes('textStyle') as { color?: string; fontFamily?: string; fontSize?: string }) : {}
  const family = ed ? (ts.fontFamily ?? '').split(',')[0]!.replace(/['"]/g, '').trim() || el?.ff || '' : el?.ff ?? ''
  const size = ed && ts.fontSize ? Math.round(parseFloat(ts.fontSize)) : el?.fontSize ?? 18
  const color = ed ? ts.color ?? el?.color : el?.color
  const flag = (k: 'bold' | 'italic' | 'underline') => (ed ? ed.isActive(k) : !!el?.[k])
  const toggle = (k: 'bold' | 'italic' | 'underline' | 'strike') => {
    if (ed) {
      const chain = ed.chain().focus()
      ;(k === 'bold' ? chain.toggleBold() : k === 'italic' ? chain.toggleItalic() : k === 'underline' ? chain.toggleUnderline() : chain.toggleStrike()).run()
    } else if (k !== 'strike') a.patch({ [k]: !el?.[k] } as Partial<Elem>)
  }
  const setAlign = (v: 'left' | 'center' | 'right' | 'justify') => (ed ? ed.chain().focus().setTextAlign(v).run() : a.patch({ align: v }))
  const alignOf = ed ? (['left', 'center', 'right', 'justify'] as const).find((v) => ed.isActive({ textAlign: v })) ?? el?.align ?? 'left' : el?.align ?? 'left'
  const noSel = a.sel.length === 0
  const isTable = el?.type === 'table'
  const isChart = el?.type === 'chart'

  return (
    <Ribbon initial="home" tabs={[
      {
        id: 'home', label: 'Inicio', content: (
          <>
            <Group title="Deshacer">
              <TB label="Deshacer (Ctrl+Z)" icon={<Undo2 size={16} />} onClick={a.undo} />
              <TB label="Rehacer (Ctrl+Y)" icon={<Redo2 size={16} />} onClick={a.redo} />
            </Group>
            <Group title="Diapositivas">
              <Menu label="Nueva diapositiva" trigger={<span className="tb txt"><Plus size={16} /><span>Nueva</span><ChevronDown size={11} /></span>}
                items={[{ heading: 'Diseño de la nueva diapositiva' }, ...LAYOUTS.map((l) => ({ label: l.label, onClick: () => a.newSlide(l.id) }))]} />
              <TB label="Duplicar diapositiva" icon={<Copy size={16} />} onClick={a.duplicateSlide} />
              <TB label="Eliminar diapositiva" icon={<Trash2 size={16} />} disabled={a.slideCount < 2} onClick={a.deleteSlide} />
            </Group>
            <Group title="Fuente">
              <Sel label="Fuente" width={120} value={FONTS.includes(family) ? family : ''} onChange={(v) => (ed ? (v ? ed.chain().focus().setFontFamily(v).run() : ed.chain().focus().unsetFontFamily().run()) : a.patch({ ff: v || undefined }))}
                options={[['', family && !FONTS.includes(family) ? family : 'Calibri'], ...FONTS.map((f): [string, string] => [f, f])]} />
              <Sel label="Tamaño de letra" width={62} value={String(size)} onChange={(v) => (ed ? ed.chain().focus().setFontSize(`${v}pt`).run() : a.patch({ fontSize: Number(v) }))}
                options={[...(SIZES.includes(size) ? [] : [[String(size), String(size)] as [string, string]]), ...SIZES.map((s): [string, string] => [String(s), String(s)])]} />
              <TB label="Negrita (Ctrl+B)" icon={<Bold size={16} />} active={flag('bold')} disabled={!textual && !ed} onClick={() => toggle('bold')} />
              <TB label="Cursiva (Ctrl+I)" icon={<Italic size={16} />} active={flag('italic')} disabled={!textual && !ed} onClick={() => toggle('italic')} />
              <TB label="Subrayado (Ctrl+U)" icon={<Underline size={16} />} active={flag('underline')} disabled={!textual && !ed} onClick={() => toggle('underline')} />
              {ed && <TB label="Tachado" icon={<Strikethrough size={16} />} active={ed.isActive('strike')} onClick={() => toggle('strike')} />}
              <ColorPick label="Color del texto" icon={<span className="tb-a">A</span>} value={color} onPick={(c) => (ed ? (c ? ed.chain().focus().setColor(c).run() : ed.chain().focus().unsetColor().run()) : a.patch({ color: c ?? undefined }))} />
            </Group>
            <Group title="Párrafo">
              <TB label="Alinear a la izquierda" icon={<AlignLeft size={16} />} active={alignOf === 'left'} disabled={!textual && !ed} onClick={() => setAlign('left')} />
              <TB label="Centrar" icon={<AlignCenter size={16} />} active={alignOf === 'center'} disabled={!textual && !ed} onClick={() => setAlign('center')} />
              <TB label="Alinear a la derecha" icon={<AlignRight size={16} />} active={alignOf === 'right'} disabled={!textual && !ed} onClick={() => setAlign('right')} />
              <TB label="Justificar" icon={<AlignJustify size={16} />} active={alignOf === 'justify'} disabled={!textual && !ed} onClick={() => setAlign('justify')} />
              <TB label="Alinear arriba" icon={<AlignVerticalJustifyStart size={16} />} active={(el?.valign ?? 'top') === 'top'} disabled={noSel} onClick={() => a.patch({ valign: 'top' })} />
              <TB label="Centrar verticalmente" icon={<AlignVerticalJustifyCenter size={16} />} active={el?.valign === 'middle'} disabled={noSel} onClick={() => a.patch({ valign: 'middle' })} />
              <TB label="Alinear abajo" icon={<AlignVerticalJustifyEnd size={16} />} active={el?.valign === 'bottom'} disabled={noSel} onClick={() => a.patch({ valign: 'bottom' })} />
              <TB label="Lista con viñetas" icon={<List size={16} />} active={!!ed?.isActive('bulletList')} disabled={!ed} onClick={() => ed?.chain().focus().toggleBulletList().run()} />
              <TB label="Lista numerada" icon={<ListOrdered size={16} />} active={!!ed?.isActive('orderedList')} disabled={!ed} onClick={() => ed?.chain().focus().toggleOrderedList().run()} />
              <Sel label="Interlineado" width={70} value={String(el?.ls ?? 1)} onChange={(v) => a.patch({ ls: Number(v) })} options={[['1', '1,0'], ['1.15', '1,15'], ['1.5', '1,5'], ['2', '2,0']]} />
            </Group>
            <Group title="Dibujo">
              <ColorPick label="Relleno" icon={<span className="tb-fill-ico" />} value={el?.fill} onPick={(c) => a.patch({ fill: c ?? undefined })} none="Sin relleno" />
              <ColorPick label="Contorno" icon={<span className="tb-fill-ico thick" />} value={el?.line} onPick={(c) => a.patch({ line: c ?? undefined })} none="Sin contorno" />
              <Sel label="Grosor del contorno" width={66} value={String(el?.lw ?? 1)} onChange={(v) => a.patch({ lw: Number(v) })} options={[['0.5', '0,5 pt'], ['1', '1 pt'], ['2', '2 pt'], ['3', '3 pt'], ['4.5', '4,5 pt'], ['6', '6 pt']]} />
              <Sel label="Opacidad del relleno" width={70} value={String(el?.op ?? 1)} onChange={(v) => a.patch({ op: Number(v) })} options={[['1', '100 %'], ['0.75', '75 %'], ['0.5', '50 %'], ['0.25', '25 %']]} />
            </Group>
          </>
        ),
      },
      {
        id: 'insert', label: 'Insertar', content: (
          <>
            <Group title="Texto">
              <TB label="Insertar cuadro de texto" icon={<Type size={16} />} text="Cuadro de texto" onClick={a.addText} />
            </Group>
            <Group title="Ilustraciones">
              <Menu label="Formas" trigger={<span className="tb txt"><Shapes size={16} /><span>Formas</span><ChevronDown size={11} /></span>} items={SHAPES.map((s) => ({ label: s.label, onClick: () => a.addShape(s.id) }))} />
              <label className="tb txt" title="Insertar imagen"><ImagePlus size={16} /><span>Imagen</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) a.addImage(f) }} /></label>
              <TB label="Insertar gráfico" icon={<BarChart3 size={16} />} text="Gráfico" onClick={a.addChart} />
              <Menu label="Insertar tabla" trigger={<span className="tb txt"><Table2 size={16} /><span>Tabla</span><ChevronDown size={11} /></span>}
                items={[[2, 2], [3, 3], [4, 3], [5, 4], [6, 5]].map(([r, c]) => ({ label: `${r} filas × ${c} columnas`, onClick: () => a.addTable(r!, c!) }))} />
            </Group>
            {isTable && (
              <Group title="Tabla seleccionada">
                <TB label="Añadir fila" text="+ Fila" onClick={() => a.tableOp('addRow')} />
                <TB label="Añadir columna" text="+ Columna" onClick={() => a.tableOp('addCol')} />
                <TB label="Quitar fila" text="− Fila" onClick={() => a.tableOp('delRow')} />
                <TB label="Quitar columna" text="− Columna" onClick={() => a.tableOp('delCol')} />
                <TB label="Primera fila como encabezado" text="Encabezado" active={!!el?.hdr} onClick={() => a.tableOp('header')} />
              </Group>
            )}
            {isChart && (
              <Group title="Gráfico seleccionado">
                <TB label="Editar los datos del gráfico" text="Editar datos" onClick={a.editChart} />
              </Group>
            )}
          </>
        ),
      },
      {
        id: 'arrange', label: 'Organizar', content: (
          <>
            <Group title="Orden">
              <TB label="Traer al frente" icon={<ArrowUpToLine size={16} />} text="Al frente" disabled={noSel} onClick={() => a.restack('front')} />
              <TB label="Enviar al fondo" icon={<ArrowDownToLine size={16} />} text="Al fondo" disabled={noSel} onClick={() => a.restack('back')} />
              <TB label="Subir un nivel" icon={<MoveUp size={16} />} disabled={noSel} onClick={() => a.restack('forward')} />
              <TB label="Bajar un nivel" icon={<MoveDown size={16} />} disabled={noSel} onClick={() => a.restack('backward')} />
            </Group>
            <Group title="Alinear a la diapositiva">
              <TB label="Alinear a la izquierda" icon={<AlignHorizontalJustifyStart size={16} />} disabled={noSel} onClick={() => a.align('left')} />
              <TB label="Centrar horizontalmente" icon={<AlignHorizontalJustifyCenter size={16} />} disabled={noSel} onClick={() => a.align('center')} />
              <TB label="Alinear a la derecha" icon={<AlignHorizontalJustifyEnd size={16} />} disabled={noSel} onClick={() => a.align('right')} />
              <TB label="Alinear arriba" icon={<AlignVerticalJustifyStart size={16} />} disabled={noSel} onClick={() => a.align('top')} />
              <TB label="Centrar verticalmente" icon={<AlignVerticalJustifyCenter size={16} />} disabled={noSel} onClick={() => a.align('middle')} />
              <TB label="Alinear abajo" icon={<AlignVerticalJustifyEnd size={16} />} disabled={noSel} onClick={() => a.align('bottom')} />
            </Group>
            <Group title="Girar y copiar">
              <TB label="Girar 90°" icon={<RotateCw size={16} />} text="Girar 90°" disabled={noSel} onClick={() => a.rotate(90)} />
              <TB label="Duplicar (Ctrl+D)" icon={<Copy size={16} />} text="Duplicar" disabled={noSel} onClick={a.duplicate} />
              <TB label="Eliminar (Supr)" icon={<Trash2 size={16} />} text="Eliminar" danger disabled={noSel} onClick={a.remove} />
            </Group>
          </>
        ),
      },
      {
        id: 'design', label: 'Diseño', content: (
          <>
            <Group title="Fondo">
              <ColorPick label="Color de fondo de esta diapositiva" icon={<span className="tb-fill-ico" />} value={a.bg} onPick={(c) => c && a.setBg(c, false)} />
              <TB label="Usar este fondo en todas las diapositivas" text="Aplicar a todas" onClick={() => a.setBg(a.bg, true)} />
            </Group>
            <Group title="Tamaño">
              <Sel label="Proporción de la diapositiva" width={130} value={a.ratio} onChange={a.setRatio} options={[['16:9', 'Panorámica 16:9'], ['16:10', 'Panorámica 16:10'], ['4:3', 'Estándar 4:3']]} />
            </Group>
          </>
        ),
      },
      {
        id: 'show', label: 'Presentación', content: (
          <>
            <Group title="Iniciar">
              <TB label="Presentar desde el principio" icon={<PlayCircle size={16} />} text="Desde el inicio" onClick={() => a.present(true)} />
              <TB label="Presentar desde esta diapositiva" icon={<Maximize size={16} />} text="Desde esta" onClick={() => a.present(false)} />
            </Group>
            <Group title="Mostrar">
              <TB label="Notas del orador" icon={<Notebook size={16} />} text="Notas" active={a.notesOpen} onClick={a.toggleNotes} />
            </Group>
          </>
        ),
      },
    ]} />
  )
}

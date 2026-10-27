import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowDownToLine, ArrowUpAZ, ArrowUpToLine, BarChart3, Bold, Grid3x3, ChevronDown, Eraser, Merge, Italic, LineChart, PieChart,
  Redo2, Search, Sigma, Snowflake, Strikethrough, Type, Underline, Undo2, AreaChart, AlignVerticalJustifyCenter, Percent, DollarSign, Table2, Trash2,
} from 'lucide-react'
import Menu from '../components/Menu'
import type { CellStyle } from './sheetModel'
import type { ChartType } from './chart'
import { FUNCTION_GROUPS, NUMBER_FORMATS } from './formulas'
import { ColorPick, Group, Ribbon, Sel, TB } from './ui'

export interface RibbonApi {
  canEdit: boolean
  style: CellStyle
  sel: { r1: number; c1: number; r2: number; c2: number }
  merged: boolean
  freeze: number
  undo: () => void
  redo: () => void
  apply: (patch: Partial<CellStyle> | null) => void
  toggle: (k: 'b' | 'i' | 'u' | 'st') => void
  borders: (kind: string) => void
  merge: () => void
  decimals: (d: number) => void
  insertRows: (below: boolean) => void
  insertCols: (right: boolean) => void
  deleteRows: () => void
  deleteCols: () => void
  clear: () => void
  autosum: (fn: string) => void
  fill: (dir: 'down' | 'right') => void
  sort: (asc: boolean) => void
  insertFunction: (name: string) => void
  newChart: (type: ChartType) => void
  find: () => void
  setFreeze: (rows: number) => void
}

const FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Verdana']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36]
const DEFAULT_SIZE = 10

/** Cinta de la hoja de cálculo (Inicio, Insertar, Datos). */
export default function SheetRibbon({ api: a }: { api: RibbonApi }) {
  const st = a.style
  const multiRow = a.sel.r2 > a.sel.r1
  const multiCol = a.sel.c2 > a.sel.c1
  const rowsLabel = multiRow ? 'filas' : 'fila'
  const colsLabel = multiCol ? 'columnas' : 'columna'

  return (
    <Ribbon initial="home" tabs={[
      {
        id: 'home', label: 'Inicio', content: (
          <>
            <Group title="Deshacer">
              <TB label="Deshacer (Ctrl+Z)" icon={<Undo2 size={16} />} onClick={a.undo} />
              <TB label="Rehacer (Ctrl+Y)" icon={<Redo2 size={16} />} onClick={a.redo} />
            </Group>
            <Group title="Fuente">
              <Sel label="Fuente" width={120} value={st.ff && FONTS.includes(st.ff) ? st.ff : ''} onChange={(v) => a.apply({ ff: v || undefined })}
                options={[['', st.ff && !FONTS.includes(st.ff) ? st.ff : 'Predeterminada'], ...FONTS.map((f): [string, string] => [f, f])]} />
              <Sel label="Tamaño de letra" width={62} value={String(st.fs ?? DEFAULT_SIZE)} onChange={(v) => a.apply({ fs: Number(v) === DEFAULT_SIZE ? undefined : Number(v) })}
                options={[...(SIZES.includes(st.fs ?? DEFAULT_SIZE) ? [] : [[String(st.fs), String(st.fs)] as [string, string]]), ...SIZES.map((s): [string, string] => [String(s), String(s)])]} />
              <TB label="Negrita (Ctrl+B)" icon={<Bold size={16} />} active={!!st.b} onClick={() => a.toggle('b')} />
              <TB label="Cursiva (Ctrl+I)" icon={<Italic size={16} />} active={!!st.i} onClick={() => a.toggle('i')} />
              <TB label="Subrayado (Ctrl+U)" icon={<Underline size={16} />} active={!!st.u} onClick={() => a.toggle('u')} />
              <TB label="Tachado" icon={<Strikethrough size={16} />} active={!!st.st} onClick={() => a.toggle('st')} />
              <ColorPick label="Color del texto" icon={<span className="tb-a">A</span>} value={st.color} onPick={(c) => a.apply({ color: c ?? undefined })} none="Automático" />
              <ColorPick label="Color de relleno" icon={<span className="tb-fill-ico" />} value={st.bg} onPick={(c) => a.apply({ bg: c ?? undefined })} none="Sin relleno" />
              <Menu label="Bordes" trigger={<span className="tb"><Grid3x3 size={16} /><ChevronDown size={11} /></span>} items={[
                { label: 'Todos los bordes', onClick: () => a.borders('all') }, { label: 'Borde exterior', onClick: () => a.borders('outer') },
                { label: 'Borde superior', onClick: () => a.borders('t') }, { label: 'Borde inferior', onClick: () => a.borders('b') },
                { label: 'Borde izquierdo', onClick: () => a.borders('l') }, { label: 'Borde derecho', onClick: () => a.borders('r') },
                'separator', { label: 'Sin bordes', onClick: () => a.borders('none') },
              ]} />
            </Group>
            <Group title="Alineación">
              <TB label="Alinear a la izquierda" icon={<AlignLeft size={16} />} active={st.align === 'left'} onClick={() => a.apply({ align: st.align === 'left' ? undefined : 'left' })} />
              <TB label="Centrar" icon={<AlignCenter size={16} />} active={st.align === 'center'} onClick={() => a.apply({ align: st.align === 'center' ? undefined : 'center' })} />
              <TB label="Alinear a la derecha" icon={<AlignRight size={16} />} active={st.align === 'right'} onClick={() => a.apply({ align: st.align === 'right' ? undefined : 'right' })} />
              <TB label="Alinear arriba" icon={<ArrowUpToLine size={16} />} active={st.va === 'top'} onClick={() => a.apply({ va: st.va === 'top' ? undefined : 'top' })} />
              <TB label="Centrar verticalmente" icon={<AlignVerticalJustifyCenter size={16} />} active={st.va === 'middle'} onClick={() => a.apply({ va: st.va === 'middle' ? undefined : 'middle' })} />
              <TB label="Alinear abajo" icon={<ArrowDownToLine size={16} />} active={st.va === 'bottom'} onClick={() => a.apply({ va: st.va === 'bottom' ? undefined : 'bottom' })} />
              <TB label={a.merged ? 'Separar celdas' : 'Combinar celdas'} icon={<Merge size={16} />} text={a.merged ? 'Separar' : 'Combinar'} active={a.merged} onClick={a.merge} />
            </Group>
            <Group title="Número">
              <Sel label="Formato numérico" width={150} value={NUMBER_FORMATS.some(([v]) => v === (st.fmt ?? '')) ? st.fmt ?? '' : '__custom'} onChange={(v) => a.apply({ fmt: v || undefined })}
                options={[...(NUMBER_FORMATS.some(([v]) => v === (st.fmt ?? '')) ? [] : [['__custom', st.fmt ?? ''] as [string, string]]), ...NUMBER_FORMATS]} />
              <TB label="Formato de moneda" icon={<DollarSign size={16} />} onClick={() => a.apply({ fmt: '$#,##0.00' })} />
              <TB label="Formato de porcentaje" icon={<Percent size={16} />} onClick={() => a.apply({ fmt: '0%' })} />
              <TB label="Disminuir decimales" text=".0←" onClick={() => a.decimals(-1)} />
              <TB label="Aumentar decimales" text=".00→" onClick={() => a.decimals(1)} />
            </Group>
            <Group title="Celdas">
              <Menu label="Insertar" trigger={<span className="tb txt"><Table2 size={16} /><span>Insertar</span><ChevronDown size={11} /></span>} items={[
                { label: `Insertar ${rowsLabel} arriba`, onClick: () => a.insertRows(false) }, { label: `Insertar ${rowsLabel} abajo`, onClick: () => a.insertRows(true) },
                { label: `Insertar ${colsLabel} a la izquierda`, onClick: () => a.insertCols(false) }, { label: `Insertar ${colsLabel} a la derecha`, onClick: () => a.insertCols(true) },
              ]} />
              <Menu label="Eliminar" trigger={<span className="tb txt"><Trash2 size={16} /><span>Eliminar</span><ChevronDown size={11} /></span>} items={[
                { label: `Eliminar ${rowsLabel}`, onClick: a.deleteRows }, { label: `Eliminar ${colsLabel}`, onClick: a.deleteCols },
              ]} />
            </Group>
            <Group title="Edición">
              <Menu label="Autosuma" trigger={<span className="tb txt"><Sigma size={16} /><span>Autosuma</span><ChevronDown size={11} /></span>} items={[
                { label: 'Suma', onClick: () => a.autosum('SUM') }, { label: 'Promedio', onClick: () => a.autosum('AVERAGE') }, { label: 'Contar números', onClick: () => a.autosum('COUNT') },
                { label: 'Máximo', onClick: () => a.autosum('MAX') }, { label: 'Mínimo', onClick: () => a.autosum('MIN') },
              ]} />
              <Menu label="Rellenar" trigger={<span className="tb txt"><span>Rellenar</span><ChevronDown size={11} /></span>} items={[
                { label: 'Hacia abajo (Ctrl+D)', onClick: () => a.fill('down') }, { label: 'Hacia la derecha (Ctrl+R)', onClick: () => a.fill('right') },
              ]} />
              <Menu label="Borrar" trigger={<span className="tb txt"><Eraser size={16} /><span>Borrar</span><ChevronDown size={11} /></span>} items={[
                { label: 'Borrar contenido', onClick: a.clear }, { label: 'Borrar formato', onClick: () => a.apply(null) },
              ]} />
              <TB label="Buscar (Ctrl+F)" icon={<Search size={16} />} text="Buscar" onClick={a.find} />
            </Group>
          </>
        ),
      },
      {
        id: 'insert', label: 'Insertar', content: (
          <>
            <Group title="Gráficos">
              <TB label="Gráfico de columnas" icon={<BarChart3 size={16} />} text="Columnas" onClick={() => a.newChart('column')} />
              <TB label="Gráfico de barras" icon={<BarChart3 size={16} className="rot90" />} text="Barras" onClick={() => a.newChart('bar')} />
              <TB label="Gráfico de líneas" icon={<LineChart size={16} />} text="Líneas" onClick={() => a.newChart('line')} />
              <TB label="Gráfico de áreas" icon={<AreaChart size={16} />} text="Áreas" onClick={() => a.newChart('area')} />
              <TB label="Gráfico circular" icon={<PieChart size={16} />} text="Circular" onClick={() => a.newChart('pie')} />
              <TB label="Gráfico de anillo" icon={<PieChart size={16} />} text="Anillo" onClick={() => a.newChart('doughnut')} />
            </Group>
            <Group title="Funciones">
              <Menu label="Insertar función" trigger={<span className="tb txt"><span className="fx-ico">ƒx</span><span>Función</span><ChevronDown size={11} /></span>}
                items={FUNCTION_GROUPS.flatMap((g) => [{ heading: g.title }, ...g.items.map(([name, hint]) => ({ label: `${name} — ${hint}`, onClick: () => a.insertFunction(name) }))])} />
              <TB label="Autosuma" icon={<Sigma size={16} />} text="Suma" onClick={() => a.autosum('SUM')} />
            </Group>
          </>
        ),
      },
      {
        id: 'data', label: 'Datos', content: (
          <>
            <Group title="Ordenar">
              <TB label="Ordenar de A a Z según la primera columna de la selección" icon={<ArrowDownAZ size={16} />} text="A → Z" onClick={() => a.sort(true)} />
              <TB label="Ordenar de Z a A según la primera columna de la selección" icon={<ArrowUpAZ size={16} />} text="Z → A" onClick={() => a.sort(false)} />
            </Group>
            <Group title="Ver">
              <TB label="Fijar la fila superior" icon={<Snowflake size={16} />} text="Fijar fila 1" active={a.freeze === 1} onClick={() => a.setFreeze(1)} />
              <TB label="Fijar hasta la fila seleccionada" icon={<Snowflake size={16} />} text="Fijar hasta aquí" onClick={() => a.setFreeze(a.sel.r2 + 1)} />
              <TB label="Dejar de fijar filas" icon={<Type size={16} />} text="Soltar" disabled={!a.freeze} onClick={() => a.setFreeze(0)} />
            </Group>
          </>
        ),
      },
    ]} />
  )
}

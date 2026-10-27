import { Extension, Node, mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType }
    lineHeight: { setLineHeight: (h: string) => ReturnType }
    indent: { changeIndent: (delta: number) => ReturnType }
    find: {
      setFind: (term: string, caseSensitive?: boolean) => ReturnType
      findStep: (dir: 1 | -1) => ReturnType
      replaceCurrent: (text: string) => ReturnType
      replaceAll: (text: string) => ReturnType
    }
    chart: { insertChart: (a: { src: string; spec: string; width: number; height: number; alt?: string }) => ReturnType }
  }
}

/** Tamaño de letra en puntos (se guarda en la marca textStyle, igual que el color y la fuente). */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
          renderHTML: (a) => (a.fontSize ? { style: `font-size: ${a.fontSize}` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

/** Interlineado de párrafos y títulos. */
export const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).style.lineHeight || null,
          renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      setLineHeight: (h) => ({ commands }) => ['paragraph', 'heading'].map((t) => commands.updateAttributes(t, { lineHeight: h === '' ? null : h })).some(Boolean),
    }
  },
})

const INDENT_PT = 36

/** Sangría de párrafos (niveles de 36 pt, como Word). */
export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => Math.max(0, Math.min(8, Math.round((parseFloat((el as HTMLElement).style.marginLeft) || 0) / INDENT_PT))),
          renderHTML: (a) => (a.indent ? { style: `margin-left: ${a.indent * INDENT_PT}pt` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      changeIndent: (delta) => ({ state, tr, dispatch }) => {
        const { from, to } = state.selection
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const next = Math.max(0, Math.min(8, ((node.attrs.indent as number) || 0) + delta))
            if (next !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
          }
        })
        dispatch?.(tr)
        return true
      },
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-]': () => this.editor.commands.changeIndent(1), 'Mod-[': () => this.editor.commands.changeIndent(-1) }
  },
})

const bgAttr = {
  backgroundColor: {
    default: null,
    parseHTML: (el: Element) => (el as HTMLElement).style.backgroundColor || null,
    renderHTML: (a: Record<string, unknown>) => (a.backgroundColor ? { style: `background-color: ${a.backgroundColor}` } : {}),
  },
}
/** Celdas de tabla con color de fondo. */
export const CellWithBg = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...bgAttr } } })
export const HeaderWithBg = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...bgAttr } } })

/** Imagen con ancho relativo a la página (25 %, 50 %, 100 %…). */
export const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('width'),
        renderHTML: (a) => (a.width ? { width: a.width } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]:not([data-chart])' }]
  },
})

/**
 * Gráfico en el documento: se guarda como imagen PNG (lo que se exporta a DOCX/ODT) junto con sus datos (`data-chart`),
 * así se puede volver a editar con doble clic mientras siga en el documento.
 */
export const ChartNode = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addStorage() {
    return { onEdit: null as null | ((pos: number, spec: string) => void) }
  },
  addAttributes() {
    return {
      src: { default: '' },
      spec: { default: '', parseHTML: (el) => (el as HTMLElement).getAttribute('data-chart') ?? '', renderHTML: (a) => ({ 'data-chart': a.spec }) },
      width: { default: 480, parseHTML: (el) => Number((el as HTMLElement).getAttribute('width')) || 480 },
      height: { default: 300, parseHTML: (el) => Number((el as HTMLElement).getAttribute('height')) || 300 },
      alt: { default: 'Gráfico' },
    }
  },
  parseHTML() {
    return [{ tag: 'img[data-chart]', priority: 1000 }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('img')
      dom.className = 'doc-chart'
      dom.src = node.attrs.src as string
      dom.alt = node.attrs.alt as string
      dom.width = node.attrs.width as number
      dom.height = node.attrs.height as number
      dom.title = 'Doble clic para editar el gráfico'
      dom.addEventListener('dblclick', () => {
        const pos = getPos()
        if (typeof pos === 'number') this.storage.onEdit?.(pos, node.attrs.spec as string)
      })
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'chart') return false
          dom.src = n.attrs.src as string
          dom.width = n.attrs.width as number
          dom.height = n.attrs.height as number
          return true
        },
      }
    }
  },
  addCommands() {
    return { insertChart: (a) => ({ commands }) => commands.insertContent({ type: 'chart', attrs: a }) }
  },
})

// ---- buscar y reemplazar ----
export interface FindState { term: string; cs: boolean; matches: { from: number; to: number }[]; index: number; deco: DecorationSet }
export const findKey = new PluginKey<FindState>('nora-find')

function compute(doc: import('@tiptap/pm/model').Node, term: string, cs: boolean) {
  const matches: { from: number; to: number }[] = []
  if (!term) return matches
  const needle = cs ? term : term.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const hay = cs ? node.text : node.text.toLowerCase()
    for (let i = hay.indexOf(needle); i >= 0 && matches.length < 5000; i = hay.indexOf(needle, i + needle.length)) matches.push({ from: pos + i, to: pos + i + needle.length })
  })
  return matches
}

const decorate = (doc: import('@tiptap/pm/model').Node, matches: FindState['matches'], index: number) =>
  DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? 'find-hit find-cur' : 'find-hit' })))

export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => ({ term: '', cs: false, matches: [], index: 0, deco: DecorationSet.empty }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(findKey) as Partial<Pick<FindState, 'term' | 'cs' | 'index'>> | undefined
          if (!meta && !tr.docChanged) return prev
          const term = meta?.term ?? prev.term
          const cs = meta?.cs ?? prev.cs
          const matches = compute(state.doc, term, cs)
          const index = matches.length ? Math.max(0, Math.min(matches.length - 1, meta?.index ?? prev.index)) : 0
          return { term, cs, matches, index, deco: decorate(state.doc, matches, index) }
        },
      },
      props: { decorations: (state) => findKey.getState(state)?.deco },
    })]
  },
  addCommands() {
    const goto = (tr: import('@tiptap/pm/state').Transaction, m: { from: number; to: number } | undefined) => {
      if (m) tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
    }
    return {
      setFind: (term, cs = false) => ({ tr, dispatch }) => {
        tr.setMeta(findKey, { term, cs, index: 0 })
        dispatch?.(tr)
        return true
      },
      findStep: (dir) => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state)
        if (!st?.matches.length) return false
        const index = (st.index + dir + st.matches.length) % st.matches.length
        tr.setMeta(findKey, { index })
        goto(tr, st.matches[index])
        dispatch?.(tr)
        return true
      },
      replaceCurrent: (text) => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state)
        const m = st?.matches[st.index]
        if (!st || !m) return false
        tr.insertText(text, m.from, m.to)
        tr.setMeta(findKey, { index: st.index })
        dispatch?.(tr)
        return true
      },
      replaceAll: (text) => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state)
        if (!st?.matches.length) return false
        for (const m of [...st.matches].reverse()) tr.insertText(text, m.from, m.to)
        dispatch?.(tr)
        return true
      },
    }
  },
})

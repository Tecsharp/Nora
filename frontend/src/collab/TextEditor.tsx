import { useEffect, useMemo, type ChangeEvent } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote,
  Redo2, Strikethrough, Table2, Underline as UnderlineIcon, Undo2,
} from 'lucide-react'
import type { CollabProvider } from './provider'
import { shrinkImage } from './image'

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

interface Props {
  provider: CollabProvider
  editable: boolean
  onEditor: (e: Editor | null) => void
}

export default function TextEditor({ provider, editable, onEditor }: Props) {
  const self = provider.user
  const extensions = useMemo(
    () => [
      StarterKit.configure({ history: false }), // el historial lo lleva Yjs (deshacer solo lo propio)
      Underline, TextStyle, Color, Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      Image.configure({ allowBase64: true, inline: false }),
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: 'Empieza a escribir…' }),
      Collaboration.configure({ document: provider.doc }),
      CollaborationCursor.configure({ provider: { awareness: provider.awareness }, user: { name: self.name, color: self.color }, render: renderCursor }),
    ],
    [provider, self.name, self.color],
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

  return (
    <div className="text-editor">
      {editor && editable && <Toolbar editor={editor} />}
      <div className="doc-scroll">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (label: string, icon: React.ReactNode, active: boolean, run: () => void, disabled = false) => (
    <button type="button" className={`tb ${active ? 'on' : ''}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </button>
  )
  const chain = () => editor.chain().focus()

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

  const heading = editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : '0'
  return (
    <div className="toolbar" role="toolbar" aria-label="Formato">
      {btn('Deshacer', <Undo2 size={16} />, false, () => chain().undo().run())}
      {btn('Rehacer', <Redo2 size={16} />, false, () => chain().redo().run())}
      <span className="tb-sep" />
      <select className="tb-select" aria-label="Estilo de párrafo" value={heading}
        onChange={(e) => (e.target.value === '0' ? chain().setParagraph().run() : chain().toggleHeading({ level: Number(e.target.value) as 1 | 2 | 3 }).run())}>
        <option value="0">Texto normal</option>
        <option value="1">Título 1</option>
        <option value="2">Título 2</option>
        <option value="3">Título 3</option>
      </select>
      <span className="tb-sep" />
      {btn('Negrita', <Bold size={16} />, editor.isActive('bold'), () => chain().toggleBold().run())}
      {btn('Cursiva', <Italic size={16} />, editor.isActive('italic'), () => chain().toggleItalic().run())}
      {btn('Subrayado', <UnderlineIcon size={16} />, editor.isActive('underline'), () => chain().toggleUnderline().run())}
      {btn('Tachado', <Strikethrough size={16} />, editor.isActive('strike'), () => chain().toggleStrike().run())}
      <label className="tb color" title="Color del texto">
        <span className="sr-only">Color del texto</span>
        <span className="tb-a" style={{ ['--c' as string]: (editor.getAttributes('textStyle').color as string) ?? 'var(--text)' }}>A</span>
        <input type="color" value={(editor.getAttributes('textStyle').color as string) ?? '#000000'} onChange={(e) => chain().setColor(e.target.value).run()} />
      </label>
      {btn('Resaltar', <Highlighter size={16} />, editor.isActive('highlight'), () => chain().toggleHighlight({ color: '#fde68a' }).run())}
      <span className="tb-sep" />
      {btn('Alinear a la izquierda', <AlignLeft size={16} />, editor.isActive({ textAlign: 'left' }), () => chain().setTextAlign('left').run())}
      {btn('Centrar', <AlignCenter size={16} />, editor.isActive({ textAlign: 'center' }), () => chain().setTextAlign('center').run())}
      {btn('Alinear a la derecha', <AlignRight size={16} />, editor.isActive({ textAlign: 'right' }), () => chain().setTextAlign('right').run())}
      {btn('Justificar', <AlignJustify size={16} />, editor.isActive({ textAlign: 'justify' }), () => chain().setTextAlign('justify').run())}
      <span className="tb-sep" />
      {btn('Lista con viñetas', <List size={16} />, editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
      {btn('Lista numerada', <ListOrdered size={16} />, editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
      {btn('Cita', <Quote size={16} />, editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
      {btn('Bloque de código', <Code size={16} />, editor.isActive('codeBlock'), () => chain().toggleCodeBlock().run())}
      {btn('Línea separadora', <Minus size={16} />, false, () => chain().setHorizontalRule().run())}
      <span className="tb-sep" />
      {btn('Enlace', <Link2 size={16} />, editor.isActive('link'), setLink)}
      <label className="tb" title="Insertar imagen">
        <ImagePlus size={16} />
        <span className="sr-only">Insertar imagen</span>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onImage} />
      </label>
      {btn('Insertar tabla', <Table2 size={16} />, false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {editor.isActive('table') && (
        <>
          <button type="button" className="tb txt" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()}>+ Fila</button>
          <button type="button" className="tb txt" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()}>+ Columna</button>
          <button type="button" className="tb txt" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()}>− Fila</button>
          <button type="button" className="tb txt" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()}>− Columna</button>
          <button type="button" className="tb txt danger" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteTable().run()}>Quitar tabla</button>
        </>
      )}
    </div>
  )
}

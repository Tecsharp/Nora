// Documentos de texto: DOCX / ODT / DOC / RTF  <->  HTML (formato nativo del editor TipTap).
import { convert } from './lo.mjs'

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
}

/** Abre un documento de texto y devuelve { kind: 'DOC', html }. */
export async function importDoc(buf, ext) {
  const files = await convert(buf, ext, 'html', { filter: 'HTML (StarWriter)', all: true })
  const name = [...files.keys()].find((f) => f.endsWith('.html'))
  if (!name) throw new Error('No se pudo leer el documento')
  let html = files.get(name).toString('utf8')
  // Las imágenes salen como archivos aparte: se incrustan como data URI para que viajen con el documento.
  for (const [file, data] of files) {
    if (file === name) continue
    const mime = MIME[file.split('.').pop().toLowerCase()]
    if (mime) html = html.split(`src="${file}"`).join(`src="data:${mime};base64,${data.toString('base64')}"`)
  }
  return { kind: 'DOC', html: tidy(html) }
}

/**
 * Limpia el HTML de LibreOffice para el editor: solo el cuerpo, sin clases, y con los atributos de formato antiguos
 * (align, font color) convertidos a estilos en línea, que es lo que entiende el editor.
 */
export function tidy(html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta)\b[\s\S]*?(<\/\1>|>)/gi, '')
    .replace(/<font\s+color="(#[0-9a-f]{3,8})"[^>]*>/gi, (_m, c) => `<span style="color:${c}">`)
    .replace(/<font[^>]*>/gi, '<span>')
    .replace(/<\/font>/gi, '</span>')
    .replace(/<\/?(col|colgroup|a)\b[^>]*>/gi, '')
    .replace(/<([a-z][a-z0-9]*)((?:\s+[^>]*?)?)(\/?)>/gi, (_m, tag, attrs, close) => `<${tag}${cleanAttrs(tag.toLowerCase(), attrs)}${close}>`)
    .replace(/\n\s*/g, ' ')
    .replace(/<p[^>]*>\s*<\/p>/g, '<p></p>')
    .trim()
}

const KEEP_STYLE = new Set(['text-align', 'color', 'background-color', 'font-weight', 'font-style', 'text-decoration'])

/** Deja solo los atributos y estilos que el editor entiende (y fusiona los estilos duplicados). */
function cleanAttrs(tag, attrs) {
  const styles = new Map()
  const addStyle = (decl) => {
    for (const part of decl.split(';')) {
      const i = part.indexOf(':')
      if (i < 0) continue
      const k = part.slice(0, i).trim().toLowerCase()
      const v = part.slice(i + 1).trim()
      if (k === 'background') { if (/^#[0-9a-f]{3,8}$/i.test(v)) styles.set('background-color', v); continue }
      if (KEEP_STYLE.has(k) && v && !/^(transparent|inherit|initial)$/i.test(v) && !/url\(|expression/i.test(v)) styles.set(k, v)
    }
  }
  let out = ''
  for (const m of attrs.matchAll(/([a-zA-Z-:]+)\s*=\s*"([^"]*)"/g)) {
    const [, name, value] = m
    const n = name.toLowerCase()
    if (n === 'style') addStyle(value)
    else if (n === 'align' && /^(left|center|right|justify)$/i.test(value)) styles.set('text-align', value.toLowerCase())
    else if (tag === 'img' && (n === 'src' || n === 'alt') && (n === 'alt' || /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test(value))) out += ` ${n}="${value}"`
    else if ((tag === 'td' || tag === 'th') && (n === 'colspan' || n === 'rowspan') && /^\d{1,3}$/.test(value)) out += ` ${n}="${value}"`
    else if (tag === 'ol' && n === 'start' && /^\d{1,4}$/.test(value)) out += ` start="${value}"`
  }
  if (styles.size) out += ` style="${[...styles].map(([k, v]) => `${k}:${v}`).join(';')}"`
  return out
}

const PAGE = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:"Liberation Sans",Arial,sans-serif;font-size:11pt}table{border-collapse:collapse}td,th{border:1px solid #808080;padding:3px 6px}</style></head><body>'

/** Guarda el HTML del editor como DOCX / ODT / PDF. */
export async function exportDoc(html, format) {
  const page = Buffer.from(`${PAGE}${html}</body></html>`, 'utf8')
  const opts = { infilter: 'HTML (StarWriter)' }
  if (format === 'docx') return convert(page, 'html', 'docx', { ...opts, filter: 'MS Word 2007 XML' })
  if (format === 'odt') return convert(page, 'html', 'odt', { ...opts, filter: 'writer8' })
  if (format === 'pdf') return convert(page, 'html', 'pdf', { ...opts, filter: 'writer_web_pdf_Export' })
  throw new Error(`Formato no admitido para documentos: ${format}`)
}

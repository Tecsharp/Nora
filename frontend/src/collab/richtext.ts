/** HTML restringido de los cuadros de texto de las diapositivas. Lo escribe cualquier persona con permiso de edición, así que se limpia siempre antes de mostrarlo. */
const TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'ul', 'ol', 'li', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4'])
const STYLE: Record<string, RegExp> = {
  'font-size': /^\d{1,3}(\.\d+)?pt$/,
  'font-family': /^[\w\s,'"-]{1,80}$/,
  color: /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i,
  'background-color': /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i,
  'text-align': /^(left|center|right|justify)$/,
  'line-height': /^\d(\.\d+)?$/,
  'margin-left': /^\d{1,3}(\.\d+)?pt$/,
}

function clean(node: Node, out: string[]) {
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out.push((n.textContent ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (!TAGS.has(tag)) {
      if (!['script', 'style', 'iframe', 'object', 'embed'].includes(tag)) clean(el, out) // se conserva el texto de lo desconocido
      return
    }
    const styles: string[] = []
    for (const decl of (el.getAttribute('style') ?? '').split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const k = decl.slice(0, i).trim().toLowerCase()
      const v = decl.slice(i + 1).trim()
      if (STYLE[k]?.test(v)) styles.push(`${k}: ${v}`)
    }
    const start = el.getAttribute('start')
    out.push(`<${tag}${styles.length ? ` style="${styles.join('; ').replace(/"/g, "'")}"` : ''}${tag === 'ol' && start && /^\d{1,4}$/.test(start) ? ` start="${start}"` : ''}>`)
    if (tag !== 'br') {
      clean(el, out)
      out.push(`</${tag}>`)
    }
  })
}

const cache = new Map<string, string>()

export function sanitizeRich(html: string): string {
  const hit = cache.get(html)
  if (hit !== undefined) return hit
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: string[] = []
  clean(doc.body, out)
  const res = out.join('')
  if (cache.size > 500) cache.clear()
  cache.set(html, res)
  return res
}

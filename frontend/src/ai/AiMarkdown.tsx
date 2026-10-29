import type { ReactNode } from 'react'

/** Markdown mínimo y seguro (sin HTML): títulos, listas, negrita, cursiva, código y párrafos. Es lo que suele devolver la IA. */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>)
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

export default function AiMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  let k = 0
  const flushPara = () => {
    if (para.length) blocks.push(<p key={k++}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(<Tag key={k++}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); blocks.push(<h5 key={k++}>{inline(h[2]!)}</h5>) }
    else if (ul || ol) {
      flushPara()
      const ordered = !!ol
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((ul ?? ol)![1]!)
    } else if (!line.trim()) { flushPara(); flushList() }
    else { flushList(); para.push(line.trim()) }
  }
  flushPara()
  flushList()
  return <div className="ai-md">{blocks}</div>
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inlineHtml = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>')

/** Markdown de la IA → HTML (escapado) para insertarlo en un editor de texto enriquecido. */
export function markdownToHtml(text: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) out.push(`<p>${inlineHtml(para.join(' '))}</p>`); para = [] }
  const closeList = () => { if (list) out.push(`</${list}>`); list = null }
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) { flushPara(); closeList(); out.push(`<h${Math.min(4, h[1]!.length + 1)}>${inlineHtml(h[2]!)}</h${Math.min(4, h[1]!.length + 1)}>`) }
    else if (ul || ol) {
      flushPara()
      const want = ol ? 'ol' : 'ul'
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want }
      out.push(`<li><p>${inlineHtml((ul ?? ol)![1]!)}</p></li>`)
    } else if (!line.trim()) { flushPara(); closeList() }
    else { closeList(); para.push(line.trim()) }
  }
  flushPara()
  closeList()
  return out.join('')
}

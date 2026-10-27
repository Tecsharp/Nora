// Presentaciones: PPTX / ODP / PPT  <->  lista de diapositivas con elementos posicionados (formato nativo del editor).
// Las coordenadas del formato nativo son porcentajes del tamaño de la diapositiva (x, y, w, h entre 0 y 100).
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import PptxGenJS from 'pptxgenjs'
import { convert } from './lo.mjs'

const EMU = 914_400
const MAX_SLIDES = 300
const MAX_IMG = 6 * 1024 * 1024
const MAX_IMG_TOTAL = 30 * 1024 * 1024
const MAX_XML = 8 * 1024 * 1024

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, processEntities: true, parseTagValue: false, trimValues: false })

// ---- utilidades sobre el árbol "preserveOrder" ----
const nameOf = (n) => Object.keys(n).find((k) => k !== ':@')
const at = (n) => n?.[':@'] ?? {}
const kids = (n) => (n ? n[nameOf(n)] ?? [] : [])
const find = (n, name) => kids(n).find((k) => nameOf(k) === name)
const all = (n, name) => kids(n).filter((k) => nameOf(k) === name)
const path = (n, ...names) => names.reduce((cur, nm) => (cur ? find(cur, nm) : undefined), n)
const root = (doc) => doc.find((n) => nameOf(n) !== '?xml')

async function xml(zip, file) {
  const f = zip.file(file)
  if (!f) return null
  const text = await f.async('string')
  if (text.length > MAX_XML) throw new Error(`${file} es demasiado grande`)
  return root(parser.parse(text))
}

function relsOf(rels) {
  const map = new Map()
  for (const r of all(rels, 'Relationship')) map.set(at(r).Id, at(r).Target)
  return map
}

const dirname = (p) => p.slice(0, p.lastIndexOf('/'))
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = dirname(base).split('/')
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
async function relsFor(zip, file) {
  const rels = await xml(zip, `${dirname(file)}/_rels/${file.split('/').pop()}.rels`)
  return rels ? relsOf(rels) : new Map()
}

// ---- colores ----
const SCHEME = { dk1: 'dk1', lt1: 'lt1', dk2: 'dk2', lt2: 'lt2', tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }

function themeColors(theme) {
  const out = {}
  const scheme = path(theme, 'themeElements', 'clrScheme')
  for (const c of kids(scheme)) {
    const v = kids(c)[0]
    if (!v) continue
    out[nameOf(c)] = nameOf(v) === 'sysClr' ? `#${at(v).lastClr ?? '000000'}` : `#${at(v).val}`
  }
  return out
}

function colorOf(fillNode, theme) {
  const c = kids(fillNode).find((k) => ['srgbClr', 'schemeClr', 'sysClr'].includes(nameOf(k)))
  if (!c) return undefined
  const n = nameOf(c)
  if (n === 'srgbClr') return /^[0-9a-f]{6}$/i.test(at(c).val) ? `#${at(c).val}` : undefined
  if (n === 'sysClr') return `#${at(c).lastClr ?? '000000'}`
  const key = at(c).val
  return theme[SCHEME[key] ?? key]
}

const solid = (spPr, theme) => {
  const f = find(spPr, 'solidFill')
  return f ? colorOf(f, theme) : undefined
}

/** Opacidad (0–1) de un relleno sólido, si tiene transparencia. */
const alphaOf = (spPr) => {
  const f = find(spPr, 'solidFill')
  const c = f && kids(f).find((k) => ['srgbClr', 'schemeClr', 'sysClr'].includes(nameOf(k)))
  const a = c && at(find(c, 'alpha')).val
  return a !== undefined ? Math.max(0, Math.min(1, Number(a) / 100000)) : undefined
}

// ---- geometría ----
function xfrmOf(spPr) {
  const x = find(spPr, 'xfrm')
  if (!x) return null
  const off = find(x, 'off')
  const ext = find(x, 'ext')
  if (!off || !ext) return null
  const chOff = find(x, 'chOff')
  const chExt = find(x, 'chExt')
  return {
    rot: Number(at(x).rot ?? 0) / 60000,
    x: Number(at(off).x), y: Number(at(off).y), cx: Number(at(ext).cx), cy: Number(at(ext).cy),
    chX: chOff ? Number(at(chOff).x) : 0, chY: chOff ? Number(at(chOff).y) : 0,
    chCx: chExt ? Number(at(chExt).cx) : Number(at(ext).cx), chCy: chExt ? Number(at(chExt).cy) : Number(at(ext).cy),
  }
}

/** Placeholders de un layout/master: clave tipo o idx -> xfrm. */
function placeholders(tree) {
  const map = new Map()
  const spTree = path(tree, 'cSld', 'spTree')
  for (const sp of all(spTree, 'sp')) {
    const ph = path(sp, 'nvSpPr', 'nvPr', 'ph')
    const xf = xfrmOf(find(sp, 'spPr'))
    if (ph && xf) {
      if (at(ph).idx !== undefined) map.set(`idx:${at(ph).idx}`, xf)
      map.set(`type:${at(ph).type ?? 'body'}`, xf)
    }
  }
  return map
}

function defaultSize(master, type) {
  const styles = find(master, 'txStyles')
  const which = type === 'title' || type === 'ctrTitle' ? 'titleStyle' : 'bodyStyle'
  const sz = at(path(styles, which, 'lvl1pPr', 'defRPr')).sz
  return sz ? Number(sz) / 100 : which === 'titleStyle' ? 40 : 18
}

// ---- texto ----
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function runStyle(rPr, theme) {
  return {
    size: at(rPr).sz ? Number(at(rPr).sz) / 100 : undefined,
    bold: at(rPr).b === '1' || at(rPr).b === 'true',
    italic: at(rPr).i === '1' || at(rPr).i === 'true',
    underline: !!at(rPr).u && at(rPr).u !== 'none',
    strike: !!at(rPr).strike && at(rPr).strike !== 'noStrike',
    color: rPr ? solid(rPr, theme) : undefined,
    font: at(find(rPr, 'latin')).typeface && !String(at(find(rPr, 'latin')).typeface).startsWith('+') ? at(find(rPr, 'latin')).typeface : undefined,
    base: at(rPr).baseline ? Number(at(rPr).baseline) : 0,
  }
}

/** Texto de un cuadro: HTML restringido con el formato de cada fragmento, más el formato base (el del primer fragmento). */
function readRich(txBody, theme) {
  const paras = []
  let first = null
  for (const p of all(txBody, 'p')) {
    const pPr = find(p, 'pPr')
    const algn = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[at(pPr).algn]
    const list = find(pPr, 'buAutoNum') ? 'number' : find(pPr, 'buChar') ? 'bullet' : null
    const runs = []
    for (const node of kids(p)) {
      const n = nameOf(node)
      if (n === 'r' || n === 'fld') {
        const text = kids(find(node, 't')).map((t) => t['#text'] ?? '').join('')
        const rPr = find(node, 'rPr')
        const st = runStyle(rPr, theme)
        if (!first && text.trim()) first = st
        runs.push({ text, st })
      } else if (n === 'br') runs.push({ text: '\n', st: {} })
    }
    paras.push({ algn, list, runs, lvl: Number(at(pPr).lvl ?? 0) })
  }
  return { paras, first: first ?? {} }
}

function richToHtml(rich, base) {
  const out = []
  let open = null
  const close = () => { if (open) out.push(`</${open}>`); open = null }
  for (const p of rich.paras) {
    const html = p.runs.map(({ text, st }) => {
      if (text === '\n') return '<br>'
      let h = esc(text)
      if (!h) return ''
      const css = []
      if (st.size && Math.round(st.size) !== Math.round(base.fontSize)) css.push(`font-size: ${Math.round(st.size * 10) / 10}pt`)
      if (st.color && st.color.toLowerCase() !== (base.color ?? '').toLowerCase()) css.push(`color: ${st.color}`)
      if (st.font && st.font !== base.ff) css.push(`font-family: ${st.font}`)
      if (css.length) h = `<span style="${css.join('; ')}">${h}</span>`
      if (st.base > 0) h = `<sup>${h}</sup>`
      else if (st.base < 0) h = `<sub>${h}</sub>`
      if (st.strike) h = `<s>${h}</s>`
      if (st.underline) h = `<u>${h}</u>`
      if (st.italic) h = `<em>${h}</em>`
      if (st.bold) h = `<strong>${h}</strong>`
      return h
    }).join('')
    const align = p.algn && p.algn !== 'left' ? ` style="text-align: ${p.algn}"` : ''
    if (p.list) {
      const tag = p.list === 'number' ? 'ol' : 'ul'
      if (open !== tag) { close(); out.push(`<${tag}>`); open = tag }
      out.push(`<li><p${align}>${html}</p></li>`)
    } else {
      close()
      out.push(`<p${align}>${html}</p>`)
    }
  }
  close()
  return out.join('')
}

const plainOfRich = (rich) => rich.paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n').replace(/\s+$/, '')

function readTable(tbl, theme) {
  const rows = all(tbl, 'tr').map((tr) => all(tr, 'tc').map((tc) => plainOfRich(readRich(find(tc, 'txBody'), theme)).replace(/\n/g, ' ')))
  const width = Math.max(1, ...rows.map((r) => r.length))
  const first = readRich(find(find(all(tbl, 'tr')[0], 'tc'), 'txBody'), theme).first
  const firstRowBold = !!readRich(find(find(all(tbl, 'tr')[0], 'tc'), 'txBody'), theme).first?.bold
  const hdr = at(find(tbl, 'tblPr')).firstRow === '1' || firstRowBold
  const fill = hdr ? solid(find(find(all(tbl, 'tr')[0], 'tc'), 'tcPr'), theme) : undefined
  return { cells: rows.map((r) => [...r, ...Array(width - r.length).fill('')]), hdr, fontSize: first?.size, fill }
}

/** Gráfico de PowerPoint -> datos del editor (tipo, categorías y series con sus valores). */
function readChart(chartRoot) {
  const plot = path(chartRoot, 'chart', 'plotArea')
  if (!plot) return null
  const node = kids(plot).find((k) => /^(bar|bar3D|line|line3D|area|area3D|pie|pie3D|doughnut)Chart$/.test(nameOf(k) ?? ''))
  if (!node) return null
  const kind = nameOf(node).replace('3D', '').replace('Chart', '')
  const type = kind === 'bar' ? (at(find(node, 'barDir')).val === 'bar' ? 'bar' : 'column') : kind
  const pts = (n) => {
    const cache = path(n, 'strCache') ?? path(n, 'numCache') ?? path(n, 'multiLvlStrCache', 'lvl') ?? n
    return all(cache, 'pt').map((p) => kids(find(p, 'v')).map((t) => t['#text'] ?? '').join(''))
  }
  const labels = []
  const series = []
  for (const ser of all(node, 'ser').slice(0, 8)) {
    const tx = find(ser, 'tx')
    const name = tx ? pts(find(tx, 'strRef'))[0] ?? '' : ''
    const cat = find(ser, 'cat')
    if (cat && !labels.length) labels.push(...pts(find(cat, 'strRef') ?? find(cat, 'numRef') ?? find(cat, 'multiLvlStrRef') ?? cat))
    const val = find(ser, 'val')
    series.push({ name: name || `Serie ${series.length + 1}`, values: pts(find(val, 'numRef') ?? val).map((v) => Number(v) || 0) })
  }
  if (!series.length) return null
  const n = Math.max(...series.map((s) => s.values.length))
  while (labels.length < n) labels.push(String(labels.length + 1))
  let title = ''
  const t = path(chartRoot, 'chart', 'title', 'tx', 'rich')
  if (t) title = all(t, 'p').map((p) => all(p, 'r').map((r) => kids(find(r, 't')).map((x) => x['#text'] ?? '').join('')).join('')).join(' ').trim()
  return { type, title, labels: labels.slice(0, n), series: series.map((s) => ({ ...s, values: s.values.slice(0, n) })) }
}

/** El prefijo de espacio de nombres (r:) se elimina al leer: el atributo que apunta a una relación es el que vale rIdN. */
const rel = (attrs) => Object.values(attrs).find((v) => /^rId\d+$/.test(v))

const pct = (v, total) => Math.round((v / total) * 10_000) / 100
let seq = 0
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`

/** Abre una presentación y devuelve { kind: 'SLIDES', width, height, slides }. */
export async function importSlides(buf, ext) {
  const pptx = ext === 'pptx' ? buf : await convert(buf, ext, 'pptx')
  const zip = await JSZip.loadAsync(pptx)
  const pres = await xml(zip, 'ppt/presentation.xml')
  if (!pres) throw new Error('No es una presentación válida')
  const sz = at(path(pres, 'sldSz'))
  const W = Number(sz.cx) || 9_144_000
  const H = Number(sz.cy) || 5_143_500
  const presRels = await relsFor(zip, 'ppt/presentation.xml')
  const themeFile = [...presRels.values()].find((t) => t.includes('theme/'))
  const theme = themeFile ? themeColors(await xml(zip, resolvePath('ppt/presentation.xml', themeFile))) : {}
  const order = all(path(pres, 'sldIdLst'), 'sldId').map((s) => presRels.get(rel(at(s)))).filter(Boolean)
  let imgTotal = 0
  const slides = []

  for (const target of order.slice(0, MAX_SLIDES)) {
    const file = resolvePath('ppt/presentation.xml', target)
    const sld = await xml(zip, file)
    if (!sld) continue
    const rels = await relsFor(zip, file)
    const layoutT = [...rels.values()].find((t) => t.includes('slideLayout'))
    const layoutFile = layoutT ? resolvePath(file, layoutT) : null
    const layout = layoutFile ? await xml(zip, layoutFile) : null
    const lrels = layoutFile ? await relsFor(zip, layoutFile) : new Map()
    const masterT = [...lrels.values()].find((t) => t.includes('slideMaster'))
    const master = masterT ? await xml(zip, resolvePath(layoutFile, masterT)) : null
    const phLayout = layout ? placeholders(layout) : new Map()
    const phMaster = master ? placeholders(master) : new Map()

    const bgOf = (tree) => (tree ? solid(path(tree, 'cSld', 'bg', 'bgPr'), theme) : undefined)
    const elements = []

    const walk = async (spTree, tf) => {
      for (const node of kids(spTree)) {
        const n = nameOf(node)
        if (n === 'grpSp') {
          const x = xfrmOf(find(node, 'grpSpPr'))
          const sx = x && x.chCx ? x.cx / x.chCx : 1
          const sy = x && x.chCy ? x.cy / x.chCy : 1
          const inner = x ? { ox: x.x - x.chX * sx, oy: x.y - x.chY * sy, sx, sy } : { ox: 0, oy: 0, sx: 1, sy: 1 }
          await walk(node, { ox: tf.ox + inner.ox * tf.sx, oy: tf.oy + inner.oy * tf.sy, sx: tf.sx * inner.sx, sy: tf.sy * inner.sy })
        } else if (n === 'sp' || n === 'pic' || n === 'graphicFrame' || n === 'cxnSp') {
          const spPr = find(node, n === 'graphicFrame' ? 'xfrm' : 'spPr')
          const ph = path(node, 'nvSpPr', 'nvPr', 'ph')
          let xf = n === 'graphicFrame' ? (() => { const o = find(spPr, 'off'); const e = find(spPr, 'ext'); return o && e ? { x: Number(at(o).x), y: Number(at(o).y), cx: Number(at(e).cx), cy: Number(at(e).cy) } : null })() : xfrmOf(spPr)
          let inherited = false
          if (!xf && ph) {
            xf = (at(ph).idx !== undefined && (phLayout.get(`idx:${at(ph).idx}`) ?? phMaster.get(`idx:${at(ph).idx}`))) || phLayout.get(`type:${at(ph).type ?? 'body'}`) || phMaster.get(`type:${at(ph).type ?? 'body'}`)
            inherited = true
          }
          if (!xf) continue
          const g = inherited ? { ox: 0, oy: 0, sx: 1, sy: 1 } : tf
          const box = {
            x: pct(g.ox + xf.x * g.sx, W), y: pct(g.oy + xf.y * g.sy, H),
            w: pct(xf.cx * g.sx, W), h: pct(xf.cy * g.sy, H),
          }
          const rot = xf.rot ? Math.round(((xf.rot % 360) + 360) % 360) : 0
          if (n === 'pic') {
            const rid = rel(at(path(node, 'blipFill', 'blip')))
            const t = rid && rels.get(rid)
            const mime = t && { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[t.split('.').pop().toLowerCase()]
            const f = t && zip.file(resolvePath(file, t))
            if (mime && f) {
              const data = await f.async('nodebuffer')
              if (data.length <= MAX_IMG && (imgTotal += data.length) <= MAX_IMG_TOTAL) {
                elements.push({ id: eid(), type: 'image', ...box, ...(rot ? { rot } : {}), data: `data:${mime};base64,${data.toString('base64')}` })
              }
            }
          } else if (n === 'graphicFrame') {
            const gd = path(node, 'graphic', 'graphicData')
            const tbl = find(gd, 'tbl')
            const chartRef = find(gd, 'chart')
            if (tbl) {
              const t = readTable(tbl, theme)
              elements.push({ id: eid(), type: 'table', ...box, cells: JSON.stringify(t.cells), hdr: t.hdr, fontSize: t.fontSize ?? 14, color: '#111827', line: '#9ca3af', ...(t.fill ? { fill: t.fill } : {}) })
            } else if (chartRef) {
              const target = rels.get(rel(at(chartRef)))
              const spec = target ? readChart(await xml(zip, resolvePath(file, target))) : null
              if (spec) elements.push({ id: eid(), type: 'chart', ...box, spec: JSON.stringify(spec) })
            }
          } else if (n === 'cxnSp' || (n === 'sp' && /^(line|straightConnector1)$/.test(at(path(spPr, 'prstGeom')).prst ?? ''))) {
            // líneas: se dibujan como una línea horizontal; si es más alta que ancha, se gira 90°
            const ln = find(spPr, 'ln')
            const color = (ln && solid(ln, theme)) ?? theme.dk1 ?? '#111827'
            const lw = at(ln).w ? Math.max(0.5, Number(at(ln).w) / 12700) : 1
            const vertical = xf.cy > xf.cx
            if (vertical) {
              const cx = box.x + box.w / 2
              const cy = box.y + box.h / 2
              const len = pct(xf.cy * g.sy, W)
              elements.push({ id: eid(), type: 'shape', shape: 'line', x: Math.round((cx - len / 2) * 100) / 100, y: Math.round((cy - 1) * 100) / 100, w: len, h: 2, rot: 90, line: color, lw })
            } else elements.push({ id: eid(), type: 'shape', shape: 'line', ...box, h: Math.max(1, box.h), line: color, lw, ...(rot ? { rot } : {}) })
          } else {
            const fill = solid(spPr, theme)
            const op = alphaOf(spPr)
            const prst = at(path(spPr, 'prstGeom')).prst
            const shape = SHAPE_OF[prst] ?? 'rect'
            const ln = find(spPr, 'ln')
            const line = ln ? solid(ln, theme) : undefined
            const lw = ln && at(ln).w ? Math.max(0.25, Number(at(ln).w) / 12700) : undefined
            const rich = readRich(find(node, 'txBody'), theme)
            const text = plainOfRich(rich)
            const anchor = at(path(node, 'txBody', 'bodyPr')).anchor
            const valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'
            const geom = { ...(rot ? { rot } : {}), ...(fill ? { fill } : {}), ...(line ? { line, ...(lw ? { lw } : {}) } : {}), ...(op !== undefined && op < 1 ? { op } : {}) }
            if (text) {
              const base = {
                fontSize: rich.first.size ?? defaultSize(master, at(ph).type), color: rich.first.color ?? theme.dk1 ?? '#000000', ff: rich.first.font,
              }
              const first = rich.paras.find((p) => p.runs.some((r) => r.text.trim()))
              elements.push({
                id: eid(), type: fill || line || shape !== 'rect' ? 'shape' : 'text', ...box, shape, html: richToHtml(rich, base), text,
                fontSize: base.fontSize, color: base.color, ...(base.ff ? { ff: base.ff } : {}), bold: false, italic: false, align: first?.algn ?? 'left', valign, ...geom,
              })
            } else if (fill || line) {
              elements.push({ id: eid(), type: 'shape', ...box, shape, ...geom })
            }
          }
        }
      }
    }
    await walk(path(sld, 'cSld', 'spTree'), { ox: 0, oy: 0, sx: 1, sy: 1 })
    let notes = ''
    const notesT = [...rels.values()].find((t) => t.includes('notesSlide'))
    if (notesT) {
      const nx = await xml(zip, resolvePath(file, notesT))
      for (const sp of all(path(nx, 'cSld', 'spTree'), 'sp')) {
        if (at(path(sp, 'nvSpPr', 'nvPr', 'ph')).type === 'body') notes = plainOfRich(readRich(find(sp, 'txBody'), theme))
      }
    }
    slides.push({ id: `p${slides.length + 1}`, bg: bgOf(sld) ?? bgOf(layout) ?? bgOf(master) ?? '#ffffff', elements, ...(notes ? { notes } : {}) })
  }
  if (!slides.length) slides.push({ id: 'p1', bg: '#ffffff', elements: [] })
  return { kind: 'SLIDES', width: Math.round((W / EMU) * 1000) / 1000, height: Math.round((H / EMU) * 1000) / 1000, slides }
}

const SHAPE_OF = {
  ellipse: 'ellipse', roundRect: 'roundRect', triangle: 'triangle', rtTriangle: 'rtTriangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon',
  star5: 'star5', rightArrow: 'rightArrow', leftArrow: 'leftArrow', upArrow: 'upArrow', downArrow: 'downArrow',
}

const hex = (c, d = '000000') => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c.slice(1).toUpperCase() : d)

const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const cssOf = (style) => Object.fromEntries((style ?? '').split(';').map((d) => d.split(':').map((x) => x.trim())).filter((p) => p.length === 2 && p[0]))

/** HTML del cuadro de texto -> párrafos con fragmentos formateados. */
export function htmlToParas(html) {
  const paras = []
  let cur = null
  const stack = []
  const lists = []
  const startPara = (extra = {}) => { cur = { runs: [], align: undefined, list: lists.at(-1) ?? null, ...extra }; paras.push(cur) }
  const fmt = () => stack.reduce((acc, f) => ({ ...acc, ...f }), {})
  const re = /<(\/?)([a-z0-9]+)((?:\s[^>]*)?)>|([^<]+)/gi
  for (let m; (m = re.exec(html ?? ''));) {
    const [, closing, tagRaw, attrs, text] = m
    if (text !== undefined) {
      const t = decode(text)
      if (!t) continue
      if (!cur) startPara()
      cur.runs.push({ text: t, ...fmt() })
      continue
    }
    const tag = tagRaw.toLowerCase()
    const style = cssOf(/style="([^"]*)"/i.exec(attrs ?? '')?.[1])
    if (!closing) {
      if (tag === 'p' || /^h[1-4]$/.test(tag)) { startPara({ align: style['text-align'] }); if (/^h[1-4]$/.test(tag)) stack.push({ bold: true }) ; else stack.push({}) }
      else if (tag === 'ul' || tag === 'ol') lists.push(tag === 'ol' ? 'number' : 'bullet')
      else if (tag === 'li') { /* el párrafo interior lleva la viñeta */ }
      else if (tag === 'br') { if (!cur) startPara(); cur.runs.push({ text: '\n' }) }
      else if (tag === 'strong' || tag === 'b') stack.push({ bold: true })
      else if (tag === 'em' || tag === 'i') stack.push({ italic: true })
      else if (tag === 'u') stack.push({ underline: true })
      else if (tag === 's') stack.push({ strike: true })
      else if (tag === 'sup') stack.push({ sup: true })
      else if (tag === 'sub') stack.push({ sub: true })
      else if (tag === 'span') {
        const f = {}
        if (/^#[0-9a-f]{6}$/i.test(style.color ?? '')) f.color = style.color.slice(1).toUpperCase()
        if (/^\d+(\.\d+)?pt$/.test(style['font-size'] ?? '')) f.size = parseFloat(style['font-size'])
        if (style['font-family']) f.font = style['font-family'].replace(/['"]/g, '').split(',')[0].trim()
        stack.push(f)
      }
    } else if (tag === 'p' || /^h[1-4]$/.test(tag)) { stack.pop(); cur = null }
    else if (tag === 'ul' || tag === 'ol') lists.pop()
    else if (['strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'span'].includes(tag)) stack.pop()
  }
  return paras.length ? paras : [{ runs: [], list: null }]
}

/** Fragmentos de texto en el formato de pptxgenjs (las propiedades del párrafo van en el primer fragmento). */
function textRuns(html, e) {
  const paras = htmlToParas(html)
  const out = []
  paras.forEach((p, pi) => {
    const runs = p.runs.length ? p.runs : [{ text: ' ' }]
    runs.forEach((r, ri) => {
      const o = {}
      if (r.bold) o.bold = true
      if (r.italic) o.italic = true
      if (r.underline) o.underline = { style: 'sng' }
      if (r.strike) o.strike = 'sngStrike'
      if (r.color) o.color = r.color
      if (r.size) o.fontSize = Math.max(6, Math.min(200, r.size))
      if (r.font) o.fontFace = r.font
      if (r.sup) o.superscript = true
      if (r.sub) o.subscript = true
      // pptxgenjs abre un párrafo nuevo si las propiedades de párrafo cambian entre fragmentos: van iguales en todos
      if (['left', 'center', 'right', 'justify'].includes(p.align)) o.align = p.align
      if (p.list === 'bullet') o.bullet = true
      else if (p.list === 'number') o.bullet = { type: 'number' }
      if (ri === runs.length - 1 && pi < paras.length - 1) o.breakLine = true
      const text = r.text === '\n' ? '' : r.text
      if (r.text === '\n') o.breakLine = true
      out.push({ text, options: o })
    })
  })
  void e
  return out
}

const CHART_KIND = { column: ['BAR', 'col'], bar: ['BAR', 'bar'], line: ['LINE'], area: ['AREA'], pie: ['PIE'], doughnut: ['DOUGHNUT'] }
const PALETTE = ['4F7CF0', 'EF7A4F', '3FB98A', 'E2B53B', '9A6AE8', 'E3598B', '37AEBF', '8A94A6']

/** Guarda la presentación como PPTX / ODP / PDF. */
export async function exportSlides(native, format) {
  const W = Number(native.width) || 13.333
  const H = Number(native.height) || 7.5
  const pres = new PptxGenJS()
  pres.defineLayout({ name: 'NORA', width: W, height: H })
  pres.layout = 'NORA'
  for (const s of native.slides ?? []) {
    const slide = pres.addSlide()
    slide.background = { color: hex(s.bg, 'FFFFFF') }
    if (s.notes) slide.addNotes(String(s.notes).slice(0, 20000))
    for (const e of s.elements ?? []) {
      const pos = { x: (e.x / 100) * W, y: (e.y / 100) * H, w: Math.max(0.05, (e.w / 100) * W), h: Math.max(0.05, (e.h / 100) * H) }
      const rotate = Number(e.rot) ? { rotate: Number(e.rot) } : {}
      const shapeType = pres.ShapeType[e.shape] ?? pres.ShapeType.rect
      const fill = e.fill ? { fill: { color: hex(e.fill), ...(e.op !== undefined && e.op < 1 ? { transparency: Math.round((1 - e.op) * 100) } : {}) } } : {}
      const line = e.line ? { line: { color: hex(e.line), width: Math.max(0.25, Number(e.lw) || 1) } } : {}
      if (e.type === 'image' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(e.data ?? '')) {
        slide.addImage({ data: e.data.replace(/^data:/, ''), ...pos, ...rotate })
      } else if (e.type === 'chart') {
        let spec
        try { spec = JSON.parse(e.spec) } catch { continue }
        const [kind, dir] = CHART_KIND[spec.type] ?? CHART_KIND.column
        const labels = (spec.labels ?? []).map(String)
        const data = (spec.series ?? []).slice(0, 8).map((sr) => ({ name: String(sr.name ?? ''), labels, values: (sr.values ?? []).map((v) => Number(v) || 0) }))
        if (!data.length) continue
        const pie = kind === 'PIE' || kind === 'DOUGHNUT'
        slide.addChart(pres.charts[kind], data, {
          ...pos, ...(dir ? { barDir: dir } : {}), chartColors: pie ? labels.map((_, i) => PALETTE[i % 8]) : PALETTE.slice(0, data.length),
          showLegend: pie || data.length > 1, legendPos: 'b', ...(spec.title ? { showTitle: true, title: String(spec.title), titleFontSize: 14 } : {}),
          ...(pie ? { showPercent: true, showValue: false } : {}),
        })
      } else if (e.type === 'table') {
        let cells
        try { cells = JSON.parse(e.cells) } catch { continue }
        if (!Array.isArray(cells) || !cells.length) continue
        const rows = cells.map((row, r) => row.map((c) => ({
          text: String(c ?? ''),
          options: { ...(e.hdr && r === 0 ? { bold: true, fill: { color: hex(e.fill, 'DBE4FF') } } : {}) },
        })))
        slide.addTable(rows, { x: pos.x, y: pos.y, w: pos.w, fontSize: Number(e.fontSize) || 14, fontFace: e.ff || undefined, color: hex(e.color, '111827'), border: { type: 'solid', pt: 1, color: hex(e.line, '9CA3AF') }, valign: 'top', margin: 4 })
      } else if (e.type === 'shape' && e.shape === 'line') {
        slide.addShape(pres.ShapeType.line, { ...pos, h: 0, y: pos.y + pos.h / 2, line: { color: hex(e.line, '111827'), width: Math.max(0.25, Number(e.lw) || 2) }, ...rotate })
      } else if (e.type === 'text' || e.type === 'shape') {
        const html = e.html ?? (e.text ? `<p>${String(e.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p>` : '')
        const hasText = /[^<>\s]/.test(html.replace(/<[^>]+>/g, ''))
        const common = {
          ...pos, ...rotate, shape: shapeType, ...fill, ...line,
          fontSize: Math.max(6, Math.min(200, Number(e.fontSize) || 18)), bold: !!e.bold, italic: !!e.italic, color: hex(e.color, '111827'), ...(e.underline ? { underline: { style: 'sng' } } : {}),
          ...(e.ff ? { fontFace: e.ff } : {}), align: ['left', 'center', 'right', 'justify'].includes(e.align) ? e.align : 'left', valign: ['top', 'middle', 'bottom'].includes(e.valign) ? e.valign : 'top',
          margin: 4, ...(Number(e.ls) > 1 ? { lineSpacingMultiple: Number(e.ls) } : {}),
        }
        if (hasText) slide.addText(textRuns(html, e), common)
        else if (e.type === 'shape') slide.addShape(shapeType, { ...pos, ...rotate, ...(e.fill ? fill : { fill: { type: 'none' } }), ...(e.line ? line : { line: { type: 'none' } }) })
      }
    }
  }
  const pptx = Buffer.from(await pres.write({ outputType: 'nodebuffer' }))
  if (format === 'pptx') return pptx
  if (format === 'odp') return convert(pptx, 'pptx', 'odp')
  if (format === 'pdf') return convert(pptx, 'pptx', 'pdf')
  throw new Error(`Formato no admitido para presentaciones: ${format}`)
}

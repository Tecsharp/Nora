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
function readText(txBody, theme) {
  const paras = []
  let style = null
  let align
  for (const p of all(txBody, 'p')) {
    let line = ''
    const pPr = find(p, 'pPr')
    if (!align && at(pPr).algn) align = { l: 'left', ctr: 'center', r: 'right', just: 'left' }[at(pPr).algn]
    for (const node of kids(p)) {
      const n = nameOf(node)
      if (n === 'r' || n === 'fld') {
        line += kids(find(node, 't')).map((t) => t['#text'] ?? '').join('')
        const rPr = find(node, 'rPr')
        if (!style && rPr) {
          style = {
            fontSize: at(rPr).sz ? Number(at(rPr).sz) / 100 : undefined,
            bold: at(rPr).b === '1' || at(rPr).b === 'true',
            italic: at(rPr).i === '1' || at(rPr).i === 'true',
            color: solid(rPr, theme),
          }
        }
      } else if (n === 'br') line += '\n'
    }
    paras.push(line)
  }
  const text = paras.join('\n').replace(/\s+$/, '')
  return { text, style: style ?? {}, align }
}

function tableText(tbl) {
  return all(tbl, 'tr').map((tr) => all(tr, 'tc').map((tc) => readText(find(tc, 'txBody'), {}).text.replace(/\n/g, ' ')).join('  |  ')).join('\n')
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
        } else if (n === 'sp' || n === 'pic' || n === 'graphicFrame') {
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
          if (n === 'pic') {
            const rid = rel(at(path(node, 'blipFill', 'blip')))
            const t = rid && rels.get(rid)
            const mime = t && { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[t.split('.').pop().toLowerCase()]
            const f = t && zip.file(resolvePath(file, t))
            if (mime && f) {
              const data = await f.async('nodebuffer')
              if (data.length <= MAX_IMG && (imgTotal += data.length) <= MAX_IMG_TOTAL) {
                elements.push({ id: eid(), type: 'image', ...box, data: `data:${mime};base64,${data.toString('base64')}` })
              }
            }
          } else if (n === 'graphicFrame') {
            const tbl = path(node, 'graphic', 'graphicData', 'tbl')
            if (tbl) elements.push({ id: eid(), type: 'text', ...box, text: tableText(tbl), fontSize: 12, bold: false, italic: false, color: '#000000', align: 'left', fill: '#f3f4f6', note: 'tabla' })
          } else {
            const fill = solid(spPr, theme)
            const prst = at(path(spPr, 'prstGeom')).prst
            const shape = prst === 'ellipse' ? 'ellipse' : prst === 'roundRect' ? 'roundRect' : 'rect'
            const ln = find(spPr, 'ln')
            const line = ln ? solid(ln, theme) : undefined
            const tx = readText(find(node, 'txBody'), theme)
            if (tx.text) {
              elements.push({
                id: eid(), type: 'text', ...box, shape, text: tx.text,
                fontSize: tx.style.fontSize ?? defaultSize(master, at(ph).type), bold: !!tx.style.bold, italic: !!tx.style.italic,
                color: tx.style.color ?? theme.dk1 ?? '#000000', align: tx.align ?? 'left', ...(fill ? { fill } : {}), ...(line ? { line } : {}),
              })
            } else if (fill || line) {
              elements.push({ id: eid(), type: 'shape', ...box, shape, ...(fill ? { fill } : {}), ...(line ? { line } : {}) })
            }
          }
        }
      }
    }
    await walk(path(sld, 'cSld', 'spTree'), { ox: 0, oy: 0, sx: 1, sy: 1 })
    slides.push({ id: `p${slides.length + 1}`, bg: bgOf(sld) ?? bgOf(layout) ?? bgOf(master) ?? '#ffffff', elements })
  }
  if (!slides.length) slides.push({ id: 'p1', bg: '#ffffff', elements: [] })
  return { kind: 'SLIDES', width: Math.round((W / EMU) * 1000) / 1000, height: Math.round((H / EMU) * 1000) / 1000, slides }
}

const hex = (c, d = '000000') => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c.slice(1).toUpperCase() : d)

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
    for (const e of s.elements ?? []) {
      const pos = { x: (e.x / 100) * W, y: (e.y / 100) * H, w: Math.max(0.05, (e.w / 100) * W), h: Math.max(0.05, (e.h / 100) * H) }
      const shapeType = e.shape === 'ellipse' ? pres.ShapeType.ellipse : e.shape === 'roundRect' ? pres.ShapeType.roundRect : pres.ShapeType.rect
      if (e.type === 'image' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(e.data ?? '')) {
        slide.addImage({ data: e.data.replace(/^data:/, ''), ...pos })
      } else if (e.type === 'text') {
        slide.addText(String(e.text ?? ''), {
          ...pos, shape: shapeType, fontSize: Math.max(6, Math.min(200, Number(e.fontSize) || 18)), bold: !!e.bold, italic: !!e.italic,
          color: hex(e.color), align: ['left', 'center', 'right'].includes(e.align) ? e.align : 'left', valign: 'top', margin: 4,
          ...(e.fill ? { fill: { color: hex(e.fill) } } : {}), ...(e.line ? { line: { color: hex(e.line), width: 1 } } : {}),
        })
      } else if (e.type === 'shape') {
        slide.addShape(shapeType, { ...pos, fill: { color: hex(e.fill, 'FFFFFF') }, line: e.line ? { color: hex(e.line), width: 1 } : { type: 'none' } })
      }
    }
  }
  const pptx = Buffer.from(await pres.write({ outputType: 'nodebuffer' }))
  if (format === 'pptx') return pptx
  if (format === 'odp') return convert(pptx, 'pptx', 'odp')
  if (format === 'pdf') return convert(pptx, 'pptx', 'pdf')
  throw new Error(`Formato no admitido para presentaciones: ${format}`)
}

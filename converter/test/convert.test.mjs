import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import { server } from '../src/server.mjs'

let base
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const post = (path, body, json = false) => fetch(base + path, { method: 'POST', body: json ? JSON.stringify(body) : body })

test('documento: HTML -> DOCX/ODT/PDF -> HTML conserva formato', async () => {
  const html = '<h1 style="text-align:center">Título</h1><p>Texto <strong>negrita</strong>, <em>cursiva</em>, <u>sub</u> y <span style="color:#ff0000">rojo</span>.</p><ul><li><p>uno</p></li></ul><table><tbody><tr><th>A</th><td>B</td></tr></tbody></table>'
  for (const fmt of ['docx', 'odt']) {
    const r = await post(`/v1/export?kind=DOC&format=${fmt}`, { html }, true)
    assert.equal(r.status, 200)
    const file = Buffer.from(await r.arrayBuffer())
    assert.equal(file.subarray(0, 2).toString(), 'PK')
    const back = await (await post(`/v1/import?ext=${fmt}`, file)).json()
    assert.equal(back.kind, 'DOC')
    assert.match(back.html, /<h1 style="text-align:center">\s*Título/)
    assert.match(back.html, /<(b|strong)>negrita<\/(b|strong)>/)
    assert.match(back.html, /<span style="color:#ff0000">rojo<\/span>/)
    assert.match(back.html, /<table>/)
  }
  const pdf = await post('/v1/export?kind=DOC&format=pdf', { html }, true)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
})

test('hoja: XLSX con fórmulas, estilos y fechas -> nativo -> XLSX/ODS/CSV', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Ventas')
  ws.getCell('A1').value = 'Producto'; ws.getCell('A1').font = { bold: true }
  ws.getCell('B1').value = 3.5; ws.getCell('C1').value = 4; ws.getCell('D1').value = { formula: 'B1*C1', result: 14 }
  ws.getCell('D2').value = { formula: 'SUM(D1:D1)', result: 14 }; ws.getCell('D2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer())
  const native = await (await post('/v1/import?ext=xlsx', xlsx)).json()
  const c = native.sheets[0].cells
  assert.deepEqual(c['0,3'], { v: 14, f: 'B1*C1' })
  assert.equal(c['0,0'].s.b, 1)
  assert.equal(c['1,3'].s.bg, '#FFFF00')
  for (const fmt of ['xlsx', 'ods']) {
    const out = Buffer.from(await (await post(`/v1/export?kind=SHEET&format=${fmt}`, native, true)).arrayBuffer())
    const again = await (await post(`/v1/import?ext=${fmt}`, out)).json()
    assert.equal(again.sheets[0].cells['0,3'].f, 'B1*C1', fmt)
    assert.equal(again.sheets[0].cells['0,3'].v, 14, fmt)
  }
  const csv = await (await post('/v1/export?kind=SHEET&format=csv', native, true)).text()
  assert.match(csv, /Producto,3\.5,4,14/)
})

test('hoja: CSV con separador ; y comillas', async () => {
  const n = await (await post('/v1/import?ext=csv', Buffer.from('a;b;c\n1;2,5;"x;y"\n'))).json()
  assert.deepEqual(n.sheets[0].cells['1,1'], { v: 2.5 })
  assert.equal(n.sheets[0].cells['1,2'].v, 'x;y')
})

test('presentación: PPTX -> nativo -> PPTX/ODP conserva textos, formas e imágenes', async () => {
  const p = new PptxGenJS(); p.layout = 'LAYOUT_WIDE'
  const s = p.addSlide(); s.background = { color: 'F5F5F5' }
  s.addText('Título', { x: 0.5, y: 0.4, w: 12, h: 1, fontSize: 36, bold: true, color: '1F2937', align: 'center' })
  s.addShape(p.ShapeType.ellipse, { x: 8, y: 2, w: 2, h: 2, fill: { color: 'FF0000' } })
  s.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', x: 10, y: 5, w: 2, h: 1 })
  p.addSlide().addText('Dos', { x: 1, y: 1, w: 4, h: 1, fontSize: 30 })
  const pptx = Buffer.from(await p.write({ outputType: 'nodebuffer' }))
  const n = await (await post('/v1/import?ext=pptx', pptx)).json()
  assert.equal(n.slides.length, 2)
  assert.deepEqual(n.slides[0].elements.map((e) => e.type), ['text', 'shape', 'image'])
  assert.equal(n.slides[0].bg, '#F5F5F5')
  assert.equal(n.slides[0].elements[0].bold, true)
  for (const fmt of ['pptx', 'odp']) {
    const out = Buffer.from(await (await post(`/v1/export?kind=SLIDES&format=${fmt}`, n, true)).arrayBuffer())
    const again = await (await post(`/v1/import?ext=${fmt}`, out)).json()
    assert.equal(again.slides.length, 2, fmt)
    assert.equal(again.slides[0].elements.find((e) => e.type === 'text').text, 'Título', fmt)
  }
})

test('rechaza formatos no admitidos y cuerpos vacíos', async () => {
  assert.equal((await post('/v1/import?ext=exe', Buffer.from('x'))).status, 400)
  assert.equal((await post('/v1/import?ext=docx', Buffer.alloc(0))).status, 400)
  assert.equal((await post('/v1/export?kind=DOC&format=exe', { html: '' }, true)).status, 400)
})

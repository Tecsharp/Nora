// Servicio interno de conversión. Solo lo llama el backend de Nora (red interna, sin salida a Internet).
//   POST /v1/import?ext=docx|odt|doc|rtf|xlsx|ods|xls|csv|tsv|pptx|odp|ppt   (cuerpo = archivo)  ->  JSON nativo
//   POST /v1/export?kind=DOC|SHEET|SLIDES&format=docx|odt|pdf|xlsx|ods|csv|pptx|odp   (cuerpo = JSON nativo) -> archivo
//   GET  /health
import { createServer } from 'node:http'
import { exportDoc, importDoc } from './doc.mjs'
import { exportSheet, importSheet } from './sheet.mjs'
import { exportSlides, importSlides } from './slides.mjs'

const PORT = Number(process.env.PORT ?? 3100)
const TOKEN = process.env.CONVERTER_TOKEN ?? ''
const MAX_BODY = Number(process.env.MAX_BODY_MB ?? 40) * 1024 * 1024

const KIND_OF_EXT = {
  docx: 'DOC', odt: 'DOC', doc: 'DOC', rtf: 'DOC',
  xlsx: 'SHEET', ods: 'SHEET', xls: 'SHEET', csv: 'SHEET', tsv: 'SHEET',
  pptx: 'SLIDES', odp: 'SLIDES', ppt: 'SLIDES',
}
const FORMATS = { DOC: ['docx', 'odt', 'pdf'], SHEET: ['xlsx', 'ods', 'csv', 'pdf'], SLIDES: ['pptx', 'odp', 'pdf'] }
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odp: 'application/vnd.oasis.opendocument.presentation',
  csv: 'text/csv; charset=utf-8', pdf: 'application/pdf',
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw new HttpError(413, 'Archivo demasiado grande')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body))
  }
  try {
    if (url.pathname === '/health') return send(200, { ok: true })
    if (TOKEN && req.headers['x-converter-token'] !== TOKEN) throw new HttpError(401, 'No autorizado')
    if (req.method !== 'POST') throw new HttpError(404, 'No encontrado')

    if (url.pathname === '/v1/import') {
      const ext = (url.searchParams.get('ext') ?? '').toLowerCase()
      const kind = KIND_OF_EXT[ext]
      if (!kind) throw new HttpError(400, `Formato no admitido: ${ext}`)
      const body = await readBody(req)
      if (!body.length) throw new HttpError(400, 'Archivo vacío')
      const native = kind === 'DOC' ? await importDoc(body, ext) : kind === 'SHEET' ? await importSheet(body, ext) : await importSlides(body, ext)
      return send(200, native)
    }

    if (url.pathname === '/v1/export') {
      const kind = url.searchParams.get('kind')
      const format = url.searchParams.get('format')
      if (!FORMATS[kind]?.includes(format)) throw new HttpError(400, `Formato no admitido: ${kind}/${format}`)
      let native
      try {
        native = JSON.parse((await readBody(req)).toString('utf8'))
      } catch {
        throw new HttpError(400, 'Contenido no válido')
      }
      const out = kind === 'DOC' ? await exportDoc(String(native.html ?? ''), format)
        : kind === 'SHEET' ? await exportSheet(native, format, Number(url.searchParams.get('active') ?? 0))
        : await exportSlides(native, format)
      return send(200, out, MIME[format])
    }
    throw new HttpError(404, 'No encontrado')
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 422
    if (status === 422) console.error('Error de conversión:', e)
    send(status, { message: e instanceof HttpError ? e.message : 'No se pudo convertir el archivo' })
  }
})

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => console.log(`Conversor escuchando en :${PORT}`))
}

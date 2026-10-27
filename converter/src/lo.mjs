// Conversión con LibreOffice headless. Cada conversión usa un perfil propio (soffice no admite dos procesos con el
// mismo perfil) y hay un máximo de conversiones simultáneas; el resto espera en cola.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_PARALLEL = Number(process.env.LO_PARALLEL ?? 2)
const TIMEOUT_MS = Number(process.env.LO_TIMEOUT_MS ?? 90_000)
const SOFFICE = process.env.SOFFICE ?? 'soffice'

const free = Array.from({ length: MAX_PARALLEL }, (_, i) => i)
const waiting = []

async function acquire() {
  if (free.length) return free.pop()
  return new Promise((resolve) => waiting.push(resolve))
}

function release(slot) {
  const next = waiting.shift()
  if (next) next(slot)
  else free.push(slot)
}

export class ConversionError extends Error {}

/**
 * Convierte `input` (bytes con extensión `inExt`) al formato `outExt` con el filtro indicado (opcional).
 * @returns {Promise<Buffer>} el archivo generado; con `all: true`, un Map nombre → Buffer con todos los archivos (p. ej. imágenes del HTML)
 */
export async function convert(input, inExt, outExt, { filter, infilter, all } = {}) {
  const slot = await acquire()
  const work = await mkdtemp(join(tmpdir(), 'nora-conv-'))
  try {
    const src = join(work, `in.${inExt}`)
    const out = join(work, 'out')
    await mkdir(out)
    await writeFile(src, input)
    const profile = join(tmpdir(), `nora-lo-profile-${slot}`)
    const args = [
      '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nologo',
      `-env:UserInstallation=file://${profile}`,
      ...(infilter ? [`--infilter=${infilter}`] : []),
      '--convert-to', filter ? `${outExt}:${filter}` : outExt,
      '--outdir', out, src,
    ]
    await run(SOFFICE, args)
    const files = await readdir(out)
    if (all) return new Map(await Promise.all(files.map(async (f) => [f, await readFile(join(out, f))])))
    const produced = files.find((f) => f.endsWith(`.${outExt}`)) ?? files[0]
    if (!produced) throw new ConversionError('LibreOffice no generó ningún archivo')
    return await readFile(join(out, produced))
  } finally {
    await rm(work, { recursive: true, force: true })
    release(slot)
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString().slice(0, 2000) })
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* ya terminó */ }
      reject(new ConversionError('La conversión tardó demasiado'))
    }, TIMEOUT_MS)
    child.on('error', (e) => { clearTimeout(timer); reject(new ConversionError(`No se pudo ejecutar LibreOffice: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new ConversionError(`LibreOffice terminó con código ${code}: ${err.trim().split('\n').pop() ?? ''}`))
    })
  })
}

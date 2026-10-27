/** Un archivo con la ruta de carpetas (relativa al destino) donde debe quedar. */
export interface PendingFile {
  file: File
  dir: string[]
}

export interface Collected {
  files: PendingFile[]
  /** Todas las carpetas encontradas, también las vacías. */
  dirs: string[][]
}

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const MAX_FILES = 5000
const MAX_DEPTH = 6

/** Carpeta elegida con el selector: la ruta viene en webkitRelativePath ("carpeta/sub/archivo.txt"). */
export function collectFromFiles(list: File[]): Collected {
  const out: Collected = { files: [], dirs: [] }
  const seen = new Set<string>()
  for (const file of list.slice(0, MAX_FILES)) {
    if (JUNK.has(file.name)) continue
    const parts = (file.webkitRelativePath || file.name).split('/')
    const dir = parts.slice(0, -1).slice(0, MAX_DEPTH)
    out.files.push({ file, dir })
    for (let i = 1; i <= dir.length; i++) {
      const key = dir.slice(0, i).join('/')
      if (!seen.has(key)) {
        seen.add(key)
        out.dirs.push(dir.slice(0, i))
      }
    }
  }
  return out
}

type FsEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void }
}

/** Primer paso, síncrono: las entradas de un drop solo son válidas mientras dura el evento. */
export function entriesFromDrop(items: DataTransferItemList): FsEntry[] {
  const out: FsEntry[] = []
  for (const it of Array.from(items)) {
    const entry = it.kind === 'file' ? (it as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() : null
    if (entry) out.push(entry)
  }
  return out
}

/** Recorre carpetas soltadas (con sus subcarpetas) y devuelve archivos y carpetas. */
export async function collectFromEntries(entries: FsEntry[]): Promise<Collected> {
  const out: Collected = { files: [], dirs: [] }
  const readAll = (reader: NonNullable<FsEntry['createReader']> extends () => infer R ? R : never) =>
    new Promise<FsEntry[]>((resolve, reject) => {
      const acc: FsEntry[] = []
      const next = () =>
        reader.readEntries((batch) => {
          if (batch.length === 0) return resolve(acc)
          acc.push(...batch) // readEntries devuelve como mucho 100 a la vez
          next()
        }, reject)
      next()
    })

  async function walk(entry: FsEntry, dir: string[]) {
    if (out.files.length >= MAX_FILES) return
    if (entry.isFile && entry.file) {
      if (JUNK.has(entry.name)) return
      const file = await new Promise<File>((ok, err) => entry.file!(ok, err))
      out.files.push({ file, dir })
    } else if (entry.isDirectory && entry.createReader && dir.length < MAX_DEPTH) {
      const here = [...dir, entry.name]
      out.dirs.push(here)
      for (const child of await readAll(entry.createReader())) await walk(child, here)
    }
  }
  for (const e of entries) await walk(e, [])
  return out
}

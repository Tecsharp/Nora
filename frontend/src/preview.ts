export type PreviewKind = 'image' | 'pdf' | 'text'

const IMAGE: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', apng: 'image/apng', heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl',
}

const TEXT = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'env', 'sql', 'sh', 'bat',
  'js', 'mjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'html', 'htm', 'java', 'kt', 'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'php', 'swift',
])

/** Tamaño máximo para previsualizar (por encima, se ofrece descargar). */
export const PREVIEW_LIMIT: Record<PreviewKind, number> = { image: 40 * 1024 * 1024, pdf: 100 * 1024 * 1024, text: 2 * 1024 * 1024 }

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

/** Qué visor corresponde al archivo. Los vídeos (y el resto) no se previsualizan: se descargan. */
export function previewKind(name: string): PreviewKind | null {
  const e = ext(name)
  if (e in IMAGE) return 'image'
  if (e === 'pdf') return 'pdf'
  if (TEXT.has(e)) return 'text'
  return null
}

/** El servidor entrega todo como binario genérico, así que el tipo se decide aquí para mostrarlo. */
export const mimeFor = (name: string, kind: PreviewKind) => (kind === 'image' ? IMAGE[ext(name)] : kind === 'pdf' ? 'application/pdf' : 'text/plain')

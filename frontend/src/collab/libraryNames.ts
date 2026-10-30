/** «mi-excalidraw-sketch.excalidrawlib» → «Mi Excalidraw Sketch»: sin extensión ni guiones, con cada palabra en mayúscula inicial. */
export function prettyLibraryName(raw: string): string {
  const base = raw.replace(/\.(excalidrawlib|excalidraw|json)$/i, '').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!base) return 'Biblioteca'
  return base.split(' ').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ')
}

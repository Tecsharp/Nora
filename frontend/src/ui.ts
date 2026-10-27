import { useSyncExternalStore } from 'react'

/** Estado de interfaz compartido: mientras el explorador de archivos está abierto, el panel flotante de subidas se oculta. */
let filesOpen = false
const listeners = new Set<() => void>()

export function setFilesOpen(open: boolean) {
  if (filesOpen === open) return
  filesOpen = open
  listeners.forEach((l) => l())
}

export function useFilesOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => filesOpen,
  )
}

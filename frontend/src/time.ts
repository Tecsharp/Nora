export function remaining(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return 'Sin expiración'
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return 'Expirada'
  const mins = Math.floor(ms / 60_000)
  if (mins >= 60) return `Expira en ${Math.floor(mins / 60)} h ${mins % 60} min`
  if (mins >= 1) return `Expira en ${mins} min`
  return `Expira en ${Math.ceil(ms / 1000)} s`
}

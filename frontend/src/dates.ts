const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const d = (v: string | number | Date) => (v instanceof Date ? v : new Date(v))

/** 29/10/2026 */
export const fmtDate = (v: string | number | Date) => {
  const x = d(v)
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`
}

/** 29/10/2026 23:43 */
export const fmtDateTime = (v: string | number | Date) => {
  const x = d(v)
  return `${fmtDate(x)} ${pad(x.getHours())}:${pad(x.getMinutes())}`
}

/** 29 Oct 2026 (para «último acceso») */
export const fmtShortMonth = (v: string | number | Date) => {
  const x = d(v)
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`
}

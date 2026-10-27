export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'

/** Color estable por nombre, para distinguir a las personas de un vistazo. */
const tone = (name: string) => {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 5
}

export default function Avatar({ name, online }: { name: string; online?: boolean }) {
  return (
    <span className={`avatar c${tone(name)} ${online ? 'on' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

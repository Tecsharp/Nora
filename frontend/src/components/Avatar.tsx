import { useEffect, useState } from 'react'
import { getAccessToken } from '../api'

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'

/** Color estable por nombre, para distinguir a las personas de un vistazo. */
const tone = (name: string) => {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 5
}

// Las fotos se piden con el token (un <img> no puede llevar cabecera) y se guardan como blob por persona y versión.
const done = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

function load(userId: string, version: number): Promise<string | null> {
  const key = `${userId}:${version}`
  if (done.has(key)) return Promise.resolve(done.get(key)!)
  let p = pending.get(key)
  if (!p) {
    p = fetch(`/api/users/${userId}/avatar`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null)
      .then((u) => {
        done.set(key, u)
        pending.delete(key)
        return u
      })
    pending.set(key, p)
  }
  return p
}

/** Foto de la persona si la tiene (`userId` y `version` > 0); si no, sus iniciales. */
export default function Avatar({ name, online, userId, version, size }: { name: string; online?: boolean; userId?: string; version?: number; size?: number }) {
  const key = userId && version ? `${userId}:${version}` : ''
  const [url, setUrl] = useState<string | null>(key && done.has(key) ? done.get(key)! : null)
  useEffect(() => {
    if (!userId || !version) return setUrl(null)
    let alive = true
    void load(userId, version).then((u) => alive && setUrl(u))
    return () => { alive = false }
  }, [userId, version])
  return (
    <span className={`avatar c${tone(name)} ${online ? 'on' : ''} ${url ? 'photo' : ''}`} aria-hidden="true" style={size ? { width: size, height: size, fontSize: size * 0.36 } : undefined}>
      {url ? <img src={url} alt="" draggable={false} /> : initials(name)}
    </span>
  )
}

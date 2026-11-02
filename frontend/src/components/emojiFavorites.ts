import { useCallback, useRef, useState } from 'react'

interface Use { n: number; t: number }
const FAVS = 3 // huecos de «los que más usas», a la derecha de los de siempre
const read = (key: string): Record<string, Use> => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Use> } catch { return {} } }

/**
 * «Los que más usas» de una barra de reacciones (la de la llamada o la de los mensajes del chat), sin contar los de siempre.
 * Para que nada se mueva bajo el dedo mientras se manda una ráfaga de emojis, la lista se ordena una sola vez, al abrir la barra; mientras
 * está abierta, un emoji nuevo solo se agrega al final si queda hueco y nunca cambia el orden. Lo que se usa se recuerda en este navegador
 * (cada barra con su propia clave) y ordena la barra la próxima vez que se abra.
 */
export function useEmojiFavorites(key: string, defaults: string[]) {
  const counts = useRef<Record<string, Use>>(read(key))
  const rank = useCallback((use: Record<string, Use>) => Object.entries(use)
    .filter(([e, u]) => u.n > 0 && !defaults.includes(e))
    .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t)
    .slice(0, FAVS).map(([e]) => e), [defaults])
  const [fav, setFav] = useState<string[]>(() => rank(counts.current))
  const open = useCallback(() => { counts.current = read(key); setFav(rank(counts.current)) }, [key, rank])
  const used = useCallback((e: string) => {
    const u = counts.current[e] ?? { n: 0, t: 0 }
    counts.current = { ...counts.current, [e]: { n: u.n + 1, t: Date.now() } }
    try { localStorage.setItem(key, JSON.stringify(counts.current)) } catch { /* sin almacenamiento */ }
    if (!defaults.includes(e)) setFav((cur) => (cur.includes(e) || cur.length >= FAVS ? cur : [...cur, e]))
  }, [key, defaults])
  return { fav, open, used }
}

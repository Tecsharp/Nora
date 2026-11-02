import { useCallback, useRef, useState } from 'react'
import { REACTIONS } from './api'

/** Los de siempre: van a la izquierda de la barra de reacciones y no se mueven nunca. */
export const DEFAULT_REACTIONS = REACTIONS

const KEY = 'nora-call-emoji-use2'
const FAVS = 3 // huecos de «los que más usas», a la derecha de los de siempre
interface Use { n: number; t: number }
const read = (): Record<string, Use> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Use> } catch { return {} } }

/** Los emojis que no son de los de siempre, de más a menos usados (a igualdad, el más reciente). */
const rank = (use: Record<string, Use>) => Object.entries(use)
  .filter(([e, u]) => u.n > 0 && !DEFAULT_REACTIONS.includes(e))
  .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t)
  .slice(0, FAVS).map(([e]) => e)

/**
 * «Los que más usas» de la barra de reacciones. Para que nada se mueva bajo el dedo mientras se manda una ráfaga de emojis, la lista se
 * ordena una sola vez, al abrir la barra; mientras está abierta, un emoji nuevo solo se agrega al final si queda hueco y nunca cambia el orden.
 * Lo que se usa se recuerda en este navegador y ordena la barra la próxima vez que se abra.
 */
export function useEmojiFavorites() {
  const counts = useRef<Record<string, Use>>(read())
  const [fav, setFav] = useState<string[]>(() => rank(counts.current))
  const open = useCallback(() => { counts.current = read(); setFav(rank(counts.current)) }, [])
  const used = useCallback((e: string) => {
    const u = counts.current[e] ?? { n: 0, t: 0 }
    counts.current = { ...counts.current, [e]: { n: u.n + 1, t: Date.now() } }
    try { localStorage.setItem(KEY, JSON.stringify(counts.current)) } catch { /* sin almacenamiento */ }
    if (!DEFAULT_REACTIONS.includes(e)) setFav((cur) => (cur.includes(e) || cur.length >= FAVS ? cur : [...cur, e]))
  }, [])
  return { fav, open, used }
}

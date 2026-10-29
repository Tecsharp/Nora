import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useRealtime } from '../realtime'

export interface Item<T = Record<string, unknown>> {
  id: string
  tool: string
  authorId: string | null
  authorName: string
  data: T
  sort: number
  createdAt: string
  updatedAt: string
}

interface Options {
  /** Cuántos pide de golpe (el chat pide los últimos y pagina hacia atrás). */
  limit?: number
}

/**
 * Lista en vivo de una herramienta de la sala: carga al abrir, aplica lo que llega por el WebSocket (`item.changed`) y expone crear,
 * cambiar, borrar y las acciones sueltas (votar, reaccionar…). Los cambios propios se aplican al instante con la respuesta del servidor.
 */
export function useItems<T = Record<string, unknown>>(code: string, tool: string, opts: Options = {}) {
  const [items, setItems] = useState<Item<T>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const limit = opts.limit ?? 200
  const alive = useRef(true)
  const changes = useRef(0) // cambios aplicados mientras una carga estaba en vuelo: esa carga ya está vieja
  const base = `/rooms/${encodeURIComponent(code)}/items/${tool}`

  const order = useCallback((l: Item<T>[]) => (tool === 'chat'
    ? [...l].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [...l].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt))), [tool])

  const load = useCallback(async (attempt = 0): Promise<void> => {
    try {
      const seen = changes.current
      const l = await api<Item<T>[]>(`${base}?limit=${limit}`)
      if (!alive.current) return
      if (changes.current !== seen && attempt < 3) return load(attempt + 1) // llegó algo mientras tanto: se vuelve a pedir en vez de pisarlo
      setItems(order(l))
      setHasMore(tool === 'chat' && l.length >= limit)
      setError('')
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'No se pudo cargar')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [base, limit, order, tool])

  useEffect(() => {
    alive.current = true
    setLoading(true)
    void load()
    return () => { alive.current = false }
  }, [load])

  /** Mezcla un elemento: las votaciones anónimas llegan sin «mine» en las difusiones; se conserva el propio. */
  const put = useCallback((it: Item<T>) => setItems((l) => {
    changes.current++
    const i = l.findIndex((x) => x.id === it.id)
    if (i < 0) return order([...l, it])
    const prev = l[i]!
    if (prev.updatedAt > it.updatedAt) return l
    const next = [...l]
    const merged = { ...it, data: { ...it.data } } as Item<T>
    const mine = (prev.data as { mine?: unknown }).mine
    if (mine !== undefined && (merged.data as { mine?: unknown }).mine === undefined) (merged.data as { mine?: unknown }).mine = mine
    next[i] = merged
    return order(next)
  }), [order])

  useRealtime('item.changed', (e: { tool: string; op: string; item: Item<T> }) => {
    if (e.tool !== tool) return
    if (e.op === 'deleted') { changes.current++; setItems((l) => l.filter((x) => x.id !== e.item.id)) }
    else put(e.item)
  })
  useRealtime('reconnected', () => void load())

  const create = useCallback(async (data: Partial<T>, sort?: number) => {
    const it = await api<Item<T>>(base, 'POST', { data, sort })
    put(it)
    return it
  }, [base, put])
  const update = useCallback(async (id: string, data?: Partial<T>, sort?: number) => {
    const it = await api<Item<T>>(`${base}/${id}`, 'PATCH', { data, sort })
    put(it)
    return it
  }, [base, put])
  const remove = useCallback(async (id: string) => {
    await api(`${base}/${id}`, 'DELETE')
    changes.current++
    setItems((l) => l.filter((x) => x.id !== id))
  }, [base])
  const act = useCallback(async (id: string, action: string, body: Record<string, unknown> = {}) => {
    const it = await api<Item<T>>(`${base}/${id}/${action}`, 'POST', body)
    put(it)
    return it
  }, [base, put])

  /** Chat: trae los mensajes anteriores al más antiguo que ya se tiene. */
  const loadOlder = useCallback(async () => {
    const first = items[0]
    if (!first) return 0
    const older = await api<Item<T>[]>(`${base}?limit=${limit}&before=${encodeURIComponent(first.createdAt)}`)
    setItems((l) => order([...older.filter((o) => !l.some((x) => x.id === o.id)), ...l]))
    setHasMore(older.length >= limit)
    return older.length
  }, [base, items, limit, order])

  return { items, loading, error, hasMore, reload: load, create, update, remove, act, loadOlder, setItems }
}

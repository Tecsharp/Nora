import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtime } from '../realtime'
import { chatApi, type Message } from './chatApi'

const PAGE = 50

/**
 * Mensajes de una conversación en vivo. Trabaja con una ventana de la historia: normalmente los últimos mensajes (hasta el final), pero
 * también puede ser una ventana centrada en un mensaje antiguo (ir a un resultado de búsqueda o a una cita) sin cargar todo lo de en medio.
 * Se pagina hacia atrás (`older`) y hacia delante (`newer`); `latest` vuelve al final.
 * Lo que llega por el WebSocket mientras se carga se guarda y se aplica al terminar, y si la ventana no llega al final no se añade nada
 * nuevo (se dejaría un hueco): avisa con `atLatest = false`.
 */
export function useMessages(code: string, conv: string) {
  const [items, setItems] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false) // hay más antiguos
  const [hasNewer, setHasNewer] = useState(false) // la ventana no llega al final
  const alive = useRef(true)
  const loadingRef = useRef(true)
  const newerRef = useRef(false)
  const itemsRef = useRef<Message[]>([])
  itemsRef.current = items
  newerRef.current = hasNewer
  const buffer = useRef<{ type: 'upsert' | 'delete'; m: Message | string }[]>([])

  const upsert = useCallback((m: Message) => setItems((l) => {
    const i = l.findIndex((x) => x.id === m.id)
    if (i >= 0) { const n = [...l]; n[i] = m; return n }
    if (newerRef.current) return l // la ventana no llega al final: un mensaje nuevo dejaría un hueco
    return [...l, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }), [])
  const drop = useCallback((id: string) => setItems((l) => l.filter((x) => x.id !== id)), [])

  const load = useCallback(async () => {
    loadingRef.current = true
    buffer.current = []
    try {
      const l = await chatApi.messages(code, conv, undefined, PAGE)
      if (!alive.current) return
      newerRef.current = false
      setHasNewer(false)
      setItems(l) // se parte de los últimos: lo que hubiera de una ventana antigua ya no es contiguo
      setHasMore(l.length >= PAGE)
      setError('')
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'No se pudieron cargar los mensajes')
    } finally {
      if (alive.current) {
        loadingRef.current = false
        for (const b of buffer.current) b.type === 'upsert' ? upsert(b.m as Message) : drop(b.m as string)
        buffer.current = []
        setLoading(false)
      }
    }
  }, [code, conv, upsert, drop])

  useEffect(() => {
    alive.current = true
    setItems([])
    setHasNewer(false)
    setLoading(true)
    void load()
    return () => { alive.current = false }
  }, [load])

  useRealtime('reconnected', () => { if (!newerRef.current) void load() })
  const mine = (d: { room: string; conv: string }) => d.room === code && d.conv === conv
  useRealtime('chat.message', (d: { room: string; conv: string; message: Message }) => {
    if (!mine(d)) return
    if (loadingRef.current) buffer.current.push({ type: 'upsert', m: d.message })
    else upsert(d.message)
  })
  useRealtime('chat.message.updated', (d: { room: string; conv: string; message: Message }) => {
    if (!mine(d)) return
    if (loadingRef.current) buffer.current.push({ type: 'upsert', m: d.message })
    else upsert(d.message)
  })
  useRealtime('chat.message.deleted', (d: { room: string; conv: string; id: string }) => {
    if (!mine(d)) return
    if (loadingRef.current) buffer.current.push({ type: 'delete', m: d.id })
    else drop(d.id)
  })

  const older = useCallback(async () => {
    const first = itemsRef.current[0]
    if (!first) return
    const l = await chatApi.messages(code, conv, first.createdAt, PAGE)
    setItems((cur) => {
      const have = new Set(cur.map((m) => m.id))
      return [...l.filter((m) => !have.has(m.id)), ...cur]
    })
    setHasMore(l.length >= PAGE)
  }, [code, conv])

  const newer = useCallback(async () => {
    const last = itemsRef.current[itemsRef.current.length - 1]
    if (!last || !newerRef.current) return
    const l = await chatApi.after(code, conv, last.createdAt, PAGE)
    setItems((cur) => {
      const have = new Set(cur.map((m) => m.id))
      return [...cur, ...l.filter((m) => !have.has(m.id))]
    })
    if (l.length < PAGE) { newerRef.current = false; setHasNewer(false) }
  }, [code, conv])

  /** Deja el mensaje cargado en pantalla: si ya está no hace nada; si no, pide una ventana centrada en él (no todo lo anterior). */
  const jump = useCallback(async (id: string): Promise<boolean> => {
    if (itemsRef.current.some((m) => m.id === id)) return true
    try {
      const w = await chatApi.window(code, conv, id, PAGE)
      if (!alive.current) return false
      newerRef.current = w.hasNewer
      setHasNewer(w.hasNewer)
      setItems(w.items)
      setHasMore(w.hasOlder)
      return true
    } catch {
      return false // el mensaje ya no existe
    }
  }, [code, conv])

  /** Vuelve a los mensajes más recientes. */
  const latest = useCallback(async () => { setLoading(true); await load() }, [load])

  const send = useCallback(async (text: string, replyTo?: string) => {
    const m = await chatApi.send(code, conv, text, replyTo)
    if (newerRef.current) await latest() // se escribe desde una ventana antigua: se vuelve al final para ver lo enviado
    else upsert(m)
    return m
  }, [code, conv, upsert, latest])
  const edit = useCallback(async (id: string, text: string) => { upsert(await chatApi.edit(code, conv, id, text)) }, [code, conv, upsert])
  const remove = useCallback(async (id: string) => { await chatApi.remove(code, conv, id); drop(id) }, [code, conv, drop])
  const react = useCallback(async (id: string, emoji: string) => { upsert(await chatApi.react(code, conv, id, emoji)) }, [code, conv, upsert])

  return { items, loading, error, hasMore, hasNewer, older, newer, jump, latest, send, edit, remove, react }
}

export type MessagesStore = ReturnType<typeof useMessages>

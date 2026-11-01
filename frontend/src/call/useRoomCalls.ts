import { useCallback, useEffect, useState } from 'react'
import { useRealtime } from '../realtime'
import { callApi, type CallInfo } from './api'

/** Llamadas abiertas y recientes de una sala, al día con los avisos de «llamada iniciada/terminada». */
export function useRoomCalls(code: string) {
  const [data, setData] = useState<{ active: CallInfo[]; recent: CallInfo[]; max: number }>({ active: [], recent: [], max: 8 })
  const [loaded, setLoaded] = useState(false)
  const refresh = useCallback(() => callApi.list(code).then((d) => { setData(d); setLoaded(true) }).catch(() => {}), [code])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    // quién hay dentro no se anuncia por la sala: se consulta de vez en cuando mientras la pestaña está a la vista
    const t = setInterval(() => { if (!document.hidden) void refresh() }, 15000)
    return () => clearInterval(t)
  }, [refresh])
  useRealtime('call.started', () => void refresh())
  useRealtime('call.ended', () => void refresh())
  useRealtime('reconnected', () => void refresh())
  return { ...data, loaded, refresh }
}

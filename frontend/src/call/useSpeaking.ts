import { useEffect, useRef, useState } from 'react'

/**
 * Quién está hablando ahora: mide el volumen de cada flujo con un analizador de audio y devuelve los ids que superan el umbral.
 * `streams` asocia un id (la conexión de la persona o «me») con su flujo; un flujo sin pista de audio se ignora.
 */
export function useSpeaking(streams: Record<string, MediaStream | null>): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set())
  const ctxRef = useRef<AudioContext | null>(null)
  const nodes = useRef(new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Uint8Array }>())

  useEffect(() => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = (ctxRef.current ??= new AC())
    const map = nodes.current
    for (const [id, n] of [...map]) {
      if (streams[id] !== n.stream) { try { n.source.disconnect() } catch { /* ya desconectado */ } map.delete(id) }
    }
    for (const [id, stream] of Object.entries(streams)) {
      if (!stream || map.has(id) || !stream.getAudioTracks().length) continue
      try {
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        map.set(id, { stream, source, analyser, buf: new Uint8Array(analyser.fftSize) })
      } catch { /* flujo sin audio utilizable */ }
    }
  })

  useEffect(() => {
    const t = setInterval(() => {
      const on = new Set<string>()
      for (const [id, n] of nodes.current) {
        if (!n.stream.getAudioTracks().some((t) => t.enabled && t.readyState === 'live')) continue
        n.analyser.getByteTimeDomainData(n.buf)
        let sum = 0
        for (const v of n.buf) { const d = (v - 128) / 128; sum += d * d }
        if (Math.sqrt(sum / n.buf.length) > 0.035) on.add(id)
      }
      setSpeaking((prev) => (prev.size === on.size && [...on].every((x) => prev.has(x)) ? prev : on))
    }, 220)
    return () => clearInterval(t)
  }, [])

  useEffect(() => () => {
    for (const n of nodes.current.values()) { try { n.source.disconnect() } catch { /* nada */ } }
    nodes.current.clear()
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
  }, [])

  return speaking
}

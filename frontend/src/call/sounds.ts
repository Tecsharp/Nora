/** Sonidos suaves de la llamada, hechos con el navegador (sin archivos): alguien entra, alguien sale y alguien levanta la mano. */
let ctx: AudioContext | null = null

function tones(notes: { f: number; at: number; len: number; gain?: number; type?: OscillatorType }[]) {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    for (const n of notes) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = n.type ?? 'sine'
      o.frequency.setValueAtTime(n.f, t0 + n.at)
      const peak = n.gain ?? 0.12
      g.gain.setValueAtTime(0.0001, t0 + n.at)
      g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len)
      o.connect(g).connect(ctx.destination)
      o.start(t0 + n.at)
      o.stop(t0 + n.at + n.len + 0.05)
    }
  } catch { /* sin audio: no pasa nada */ }
}

export const callSounds = {
  /** Dos notas que suben. */
  join: () => tones([{ f: 523.25, at: 0, len: 0.16 }, { f: 783.99, at: 0.12, len: 0.24 }]),
  /** Dos notas que bajan. */
  leave: () => tones([{ f: 659.25, at: 0, len: 0.16 }, { f: 392, at: 0.12, len: 0.26 }]),
  /** Un «tin-tin» alegre. */
  hand: () => tones([{ f: 880, at: 0, len: 0.12, type: 'triangle', gain: 0.14 }, { f: 1174.66, at: 0.11, len: 0.2, type: 'triangle', gain: 0.14 }]),
}

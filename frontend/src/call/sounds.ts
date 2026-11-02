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
  /** Tú entras: un acorde que sube, claro y un poco más largo. */
  enter: () => tones([{ f: 523.25, at: 0, len: 0.2, gain: 0.14 }, { f: 659.25, at: 0.13, len: 0.2, gain: 0.14 }, { f: 1046.5, at: 0.26, len: 0.38, gain: 0.14 }]),
  /** Tú sales: lo mismo, pero bajando. */
  exit: () => tones([{ f: 880, at: 0, len: 0.2, gain: 0.14 }, { f: 659.25, at: 0.13, len: 0.2, gain: 0.14 }, { f: 440, at: 0.26, len: 0.4, gain: 0.14 }]),
  /** Alguien más entra: dos notas suaves que suben. */
  join: () => tones([{ f: 587.33, at: 0, len: 0.14, type: 'triangle', gain: 0.1 }, { f: 880, at: 0.11, len: 0.2, type: 'triangle', gain: 0.1 }]),
  /** Alguien más sale: dos notas suaves que bajan. */
  leave: () => tones([{ f: 740, at: 0, len: 0.14, type: 'triangle', gain: 0.1 }, { f: 494, at: 0.11, len: 0.22, type: 'triangle', gain: 0.1 }]),
  /** Levantar la mano: una campanita («ding-ding») con un brillo agudo, inconfundible entre los demás avisos. */
  hand: () => tones([
    { f: 1174.66, at: 0, len: 0.55, gain: 0.16 }, { f: 2349.32, at: 0, len: 0.35, gain: 0.05 },
    { f: 1567.98, at: 0.16, len: 0.75, gain: 0.16 }, { f: 3135.96, at: 0.16, len: 0.45, gain: 0.05 },
  ]),
}

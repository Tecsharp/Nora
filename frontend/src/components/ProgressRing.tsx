/** Anillo de progreso que rodea un icono. `percent` null = progreso desconocido (gira). */
export default function ProgressRing({ percent }: { percent: number | null }) {
  const r = 17
  const c = 2 * Math.PI * r
  return (
    <svg className={`ring ${percent === null ? 'spin' : ''}`} viewBox="0 0 40 40" aria-hidden="true">
      <circle className="track" cx="20" cy="20" r={r} />
      <circle className="val" cx="20" cy="20" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - (percent ?? 25) / 100)} />
    </svg>
  )
}

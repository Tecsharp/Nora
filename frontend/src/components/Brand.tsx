import { Layers } from 'lucide-react'

export default function Brand({ subtitle = 'Tu espacio. Tus reglas.', large }: { subtitle?: string; large?: boolean }) {
  return (
    <div className={`brand ${large ? 'lg' : ''}`}>
      <span className="brand-mark">
        <Layers size={large ? 34 : 26} />
      </span>
      <div>
        <h1>Nora</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

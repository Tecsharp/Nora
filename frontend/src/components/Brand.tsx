import { Layers } from 'lucide-react'

export default function Brand({ subtitle, large }: { subtitle?: string; large?: boolean }) {
  return (
    <div className={`brand ${large ? 'lg' : ''}`}>
      <span className="brand-mark">
        <Layers size={large ? 26 : 19} strokeWidth={2.2} />
      </span>
      <div>
        <h1>Nora</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  )
}

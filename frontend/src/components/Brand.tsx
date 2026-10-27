import { Layers } from 'lucide-react'

export default function Brand({ subtitle = 'Tu espacio. Tus reglas.' }: { subtitle?: string }) {
  return (
    <div className="brand">
      <Layers size={26} />
      <div>
        <h1>Nora</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

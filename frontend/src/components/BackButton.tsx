import { ArrowLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

/** Vuelve a la página de la que se venía (una sala, por ejemplo); si se entró directamente, al inicio. */
export default function BackButton({ fallbackLabel = 'Volver al inicio' }: { fallbackLabel?: string }) {
  const navigate = useNavigate()
  const { key } = useLocation()
  const hasHistory = key !== 'default'
  return (
    <button className="btn ghost sm" onClick={() => (hasHistory ? navigate(-1) : navigate('/'))}>
      <ArrowLeft size={15} /> {hasHistory ? 'Volver' : fallbackLabel}
    </button>
  )
}

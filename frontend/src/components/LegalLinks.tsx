import { Link } from 'react-router-dom'

export default function LegalLinks() {
  return (
    <nav aria-label="Información legal">
      <Link to="/terms">Términos de uso</Link>
      <Link to="/privacy">Privacidad</Link>
      <Link to="/data">Manejo de datos</Link>
    </nav>
  )
}

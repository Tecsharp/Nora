import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Brand from './Brand'

/** Barra superior a todo el ancho, con efecto cristal; el contenido se centra igual que la página. */
export default function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link to="/" className="plain" aria-label="Nora, inicio">
          <Brand />
        </Link>
        <nav>{children}</nav>
      </div>
    </header>
  )
}

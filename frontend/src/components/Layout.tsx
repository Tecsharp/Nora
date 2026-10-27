import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Shield } from 'lucide-react'
import { useAuth } from '../auth'
import { uploads } from '../uploadManager'
import Brand from './Brand'
import UploadDock from './UploadDock'

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const inRoom = useLocation().pathname.startsWith('/room/')
  return (
    <div className="shell">
      <header className="topbar">
        {/* En la sala la marca ya aparece dentro de la tarjeta */}
        {inRoom ? (
          <Link to="/" className="plain muted">← Mis salas</Link>
        ) : (
          <Link to="/" className="plain">
            <Brand />
          </Link>
        )}
        {user && (
          <nav>
            <span className="muted hide-sm">{user.displayName}</span>
            {user.role === 'ADMIN' && (
              <Link to="/admin" className="btn ghost">
                <Shield size={16} /> Admin
              </Link>
            )}
            <button
              className="btn ghost"
              onClick={async () => {
                await uploads.cancelAll() // sin sesión no se podrían terminar
                await logout()
                navigate('/login')
              }}
            >
              <LogOut size={16} /> Salir
            </button>
          </nav>
        )}
      </header>
      <main>
        <Outlet />
      </main>
      <UploadDock />
    </div>
  )
}

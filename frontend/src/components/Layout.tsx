import { Link, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, Shield } from 'lucide-react'
import { useAuth } from '../auth'
import { ThemeToggle } from '../theme'
import { uploads } from '../uploadManager'
import Avatar from './Avatar'
import TopBar from './TopBar'
import LegalLinks from './LegalLinks'
import UploadDock from './UploadDock'

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <>
      <TopBar>
        <ThemeToggle />
        {user && (
          <>
            <span className="row nowrap hide-sm" title={user.email} style={{ gap: 8, marginLeft: 6 }}>
              <Avatar name={user.displayName} />
              <span className="small">{user.displayName}</span>
            </span>
            {user.role === 'ADMIN' && (
              <Link to="/admin" className="btn ghost sm">
                <Shield size={15} /> <span className="hide-sm">Admin</span>
              </Link>
            )}
            <button
              className="btn ghost sm"
              aria-label="Cerrar sesión"
              onClick={async () => {
                await uploads.cancelAll() // sin sesión no se podrían terminar
                await logout()
                navigate('/login')
              }}
            >
              <LogOut size={15} /> <span className="hide-sm">Salir</span>
            </button>
          </>
        )}
      </TopBar>
      <div className="shell">
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>© {new Date().getFullYear()} Nora · Salas temporales de colaboración</span>
        <LegalLinks />
      </footer>
      <UploadDock />
      </div>
    </>
  )
}

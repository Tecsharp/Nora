import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Shield } from 'lucide-react'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import { useToast } from '../toast'
import { ThemeToggle } from '../theme'
import { uploads } from '../uploadManager'
import { NotificationBell } from '../notifications'
import Avatar from './Avatar'
import TopBar from './TopBar'
import LegalLinks from './LegalLinks'
import UploadDock from './UploadDock'

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const toast = useToast()
  useRealtime('join.requested', (d: { roomName: string; displayName: string }) => toast(`${d.displayName} quiere entrar a «${d.roomName}»`, 'info'))
  useRealtime('join.approved', (d: { code: string; roomName: string }) => {
    toast(`Te han aceptado en «${d.roomName}»`, 'success')
    navigate(`/room/${d.code}`)
  })
  useRealtime('join.denied', (d: { roomName: string }) => toast(`No te han aceptado en «${d.roomName}»`, 'warning'))
  return (
    <>
      <TopBar>
        <ThemeToggle />
        {user && (
          <>
            <NotificationBell />
            <Link to="/settings" className="btn ghost sm profile-link" title={`${user.email} · Ajustes de la cuenta`} aria-label="Ajustes de la cuenta">
              <Avatar name={user.displayName} userId={user.id} version={user.avatarVersion} size={26} />
              <span className="hide-sm">{user.displayName}</span>
            </Link>
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
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
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

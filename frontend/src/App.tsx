import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Admin from './pages/Admin'
import Home from './pages/Home'
import Legal from './pages/Legal'
import Login from './pages/Login'
import Register from './pages/Register'
import ResetPassword from './pages/ResetPassword'
import Settings from './pages/Settings'
import RoomPage from './pages/RoomPage'
import CallPage from './call/CallPage'

function Protected({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="center muted">Cargando…</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/terms" element={<Legal />} />
      <Route path="/privacy" element={<Legal />} />
      <Route path="/data" element={<Legal />} />
      <Route path="/call/:code" element={<Protected><CallPage /></Protected>} />
      <Route element={<Layout />}>
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="/room/:code/:tool?/:sub?" element={<Protected><RoomPage /></Protected>} />
        <Route path="/settings/:tab?" element={<Protected><Settings /></Protected>} />
        <Route path="/admin/:tab?" element={<Protected admin><Admin /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

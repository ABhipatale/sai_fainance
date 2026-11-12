import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import Layout from '@/components/Layout'
import { ListSkeleton } from '@/components/ui'

// every page is code-split so the first load stays small on mobile data
const Login = lazy(() => import('@/pages/Login'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Customers = lazy(() => import('@/pages/Customers'))
const CustomerForm = lazy(() => import('@/pages/CustomerForm'))
const CustomerProfile = lazy(() => import('@/pages/CustomerProfile'))
const NewKhata = lazy(() => import('@/pages/NewKhata'))
const LoanDetail = lazy(() => import('@/pages/LoanDetail'))
const Collection = lazy(() => import('@/pages/Collection'))
const Receipt = lazy(() => import('@/pages/Receipt'))
const Pending = lazy(() => import('@/pages/Pending'))
const Advance = lazy(() => import('@/pages/Advance'))
const Penalties = lazy(() => import('@/pages/Penalties'))
const Cash = lazy(() => import('@/pages/Cash'))
const CashDetail = lazy(() => import('@/pages/CashDetail'))
const Staff = lazy(() => import('@/pages/Staff'))
const Reports = lazy(() => import('@/pages/Reports'))
const SettingsPage = lazy(() => import('@/pages/Settings'))

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="p-6"><ListSkeleton rows={4} /></div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Frontend guard is only UX – the Laravel API enforces every permission again. */
function Perm({ p, children }: { p: string; children: ReactNode }) {
  const { can } = useAuth()
  return can(p) ? <>{children}</> : <Navigate to="/" replace />
}

function Home() {
  const { can } = useAuth()
  return can('dashboard.view') ? <Dashboard /> : <Navigate to="/collection" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-6"><ListSkeleton rows={4} /></div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<Home />} />
            <Route path="customers" element={<Perm p="customers.view"><Customers /></Perm>} />
            <Route path="customers/new" element={<Perm p="customers.create"><CustomerForm /></Perm>} />
            <Route path="customers/:id" element={<Perm p="customers.view"><CustomerProfile /></Perm>} />
            <Route path="customers/:id/edit" element={<Perm p="customers.update"><CustomerForm /></Perm>} />
            <Route path="khata/new" element={<Perm p="loans.create"><NewKhata /></Perm>} />
            <Route path="khata/:id" element={<Perm p="loans.view"><LoanDetail /></Perm>} />
            <Route path="collection" element={<Perm p="payments.collect"><Collection /></Perm>} />
            <Route path="receipt/:id" element={<Perm p="payments.view"><Receipt /></Perm>} />
            <Route path="pending" element={<Perm p="payments.view"><Pending /></Perm>} />
            <Route path="advance" element={<Perm p="payments.view"><Advance /></Perm>} />
            <Route path="penalties" element={<Perm p="penalties.view"><Penalties /></Perm>} />
            <Route path="cash" element={<Perm p="cash.view"><Cash /></Perm>} />
            <Route path="cash/:id" element={<Perm p="cash.view"><CashDetail /></Perm>} />
            <Route path="staff" element={<Perm p="recovery.view"><Staff /></Perm>} />
            <Route path="reports" element={<Perm p="reports.view"><Reports /></Perm>} />
            <Route path="reports/:key" element={<Perm p="reports.view"><Reports /></Perm>} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

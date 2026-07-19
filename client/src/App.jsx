import { useState, useEffect } from 'react'
import { useAuth } from './contexts/AuthContext'
import { api } from './lib/api'
import Login from './pages/Login'
import Sidebar from './components/Layout/Sidebar'
import Topbar from './components/Layout/Topbar'
import Dashboard from './components/Dashboard/Dashboard'
import PeopleModule from './components/People/PeopleModule'
import PayrollModule from './components/Payroll/PayrollModule'
import MeetingsModule from './components/Meetings/MeetingsModule'
import ProcurementModule from './components/Procurement/ProcurementModule'
import UsersModule from './components/Users/UsersModule'
import ComingSoon from './components/ComingSoon'

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  people: 'HR & People',
  payroll: 'Payroll',
  meetings: 'Meetings',
  procurement: 'Procurement',
  users: 'Users',
  hs: 'Health & Safety',
  operations: 'Operations',
  training: 'Training',
  plant: 'Plant & Equipment',
}

export default function App() {
  const { user, loading } = useAuth()
  const [dept, setDept] = useState('dashboard')
  const [saveState, setSaveState] = useState('')
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!user) return
    api.getInvoices()
      .then(invs => setPendingCount(invs.filter(i => i.status === 'pending').length))
      .catch(() => setPendingCount(0))
  }, [user, dept])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.6)', background: '#161616' }}>
        Loading...
      </div>
    )
  }

  if (!user) return <Login />

  function onSaveStateChange(state) {
    setSaveState(state)
    if (state === 'saved') setTimeout(() => setSaveState(''), 2000)
  }

  return (
    <div className="app">
      <Sidebar active={dept} onSelect={setDept} />
      <main className="main">
        <div className="bg-fill" />
        <div className="bg-logo" />
        <Topbar
          title={VIEW_TITLES[dept] || dept}
          saveState={saveState}
          pendingCount={pendingCount}
          onAlert={() => setDept('payroll')}
        />
        <div className="content">
          <div className="content-inner">
            {dept === 'dashboard' && <Dashboard onNavigate={setDept} />}
            {dept === 'people' && <PeopleModule onSaveStateChange={onSaveStateChange} />}
            {dept === 'payroll' && <PayrollModule onSaveStateChange={onSaveStateChange} />}
            {dept === 'meetings' && <MeetingsModule />}
            {dept === 'procurement' && <ProcurementModule />}
            {dept === 'users' && user?.role === 'super_admin' && <UsersModule />}
            {!['dashboard', 'people', 'payroll', 'meetings', 'procurement', 'users'].includes(dept) && <ComingSoon dept={dept} />}
          </div>
        </div>
      </main>
    </div>
  )
}

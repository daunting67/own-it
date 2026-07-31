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
import ProjectManagementModule from './components/ProjectManagement/ProjectManagementModule'
import CostControlModule from './components/CostControl/CostControlModule'
import HealthSafetyModule from './components/HealthSafety/HealthSafetyModule'
import PlantModule from './components/Plant/PlantModule'
import OperationsModule from './components/Operations/OperationsModule'
import TrainingModule from './components/Training/TrainingModule'
import UsersModule from './components/Users/UsersModule'
import ComingSoon from './components/ComingSoon'

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  people: 'HR & People',
  payroll: 'Payroll',
  meetings: 'Meetings',
  projects: 'Project Management',
  cost: 'Cost Control',
  users: 'Users',
  hs: 'Health & Safety',
  operations: 'Operations',
  training: 'Training',
  plant: 'Plant & Equipment',
}

// Views that show two tables side by side and need more than the standard
// reading width — at 1020px the Plant day panels clipped their last two
// columns (Service due at / Hrs to service) behind a hidden scrollbar.
const WIDE_VIEWS = new Set(['plant'])
// Views whose tables need every pixel of the window, not a reading column.
const FULL_VIEWS = new Set(['plant'])

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
          <div className={`content-inner${WIDE_VIEWS.has(dept) ? ' content-inner-wide' : ''}${FULL_VIEWS.has(dept) ? ' content-inner-full' : ''}`}>
            {(() => {
              const can = (d) => user?.admin || (user?.departments || []).includes(d)
              if (dept === 'dashboard') return <Dashboard onNavigate={setDept} />
              if (dept === 'people') return can('people') ? <PeopleModule onSaveStateChange={onSaveStateChange} /> : <ComingSoon dept={dept} />
              if (dept === 'payroll') return can('payroll') ? <PayrollModule onSaveStateChange={onSaveStateChange} /> : <ComingSoon dept={dept} />
              if (dept === 'meetings') return can('meetings') ? <MeetingsModule /> : <ComingSoon dept={dept} />
              if (dept === 'projects') return can('projects') ? <ProjectManagementModule /> : <ComingSoon dept={dept} />
              if (dept === 'cost') return can('cost') ? <CostControlModule /> : <ComingSoon dept={dept} />
              if (dept === 'hs') return can('hs') ? <HealthSafetyModule /> : <ComingSoon dept={dept} />
              if (dept === 'training') return can('training') ? <TrainingModule /> : <ComingSoon dept={dept} />
              if (dept === 'plant') return can('plant') ? <PlantModule /> : <ComingSoon dept={dept} />
              if (dept === 'operations') return can('operations') ? <OperationsModule /> : <ComingSoon dept={dept} />
              if (dept === 'users') return user?.admin ? <UsersModule /> : <ComingSoon dept={dept} />
              return <ComingSoon dept={dept} />
            })()}
          </div>
        </div>
      </main>
    </div>
  )
}

import { useState } from 'react'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Header from './components/Layout/Header'
import NavBar from './components/Layout/NavBar'
import PeopleModule from './components/People/PeopleModule'
import PayrollModule from './components/Payroll/PayrollModule'
import ProcessesModule from './components/Processes/ProcessesModule'
import ProcurementModule from './components/Procurement/ProcurementModule'
import UsersModule from './components/Users/UsersModule'
import ComingSoon from './components/ComingSoon'

export default function App() {
  const { user, loading } = useAuth()
  const [dept, setDept] = useState('people')
  const [saveState, setSaveState] = useState('')

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
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
    <>
      <Header saveState={saveState} />
      <NavBar active={dept} onSelect={setDept} />
      <main>
        {dept === 'people' && <PeopleModule onSaveStateChange={onSaveStateChange} />}
        {dept === 'payroll' && <PayrollModule onSaveStateChange={onSaveStateChange} />}
        {dept === 'processes' && <ProcessesModule />}
        {dept === 'procurement' && <ProcurementModule />}
        {dept === 'users' && user?.role === 'super_admin' && <UsersModule />}
        {!['people', 'payroll', 'processes', 'procurement', 'users'].includes(dept) && <ComingSoon dept={dept} />}
      </main>
    </>
  )
}

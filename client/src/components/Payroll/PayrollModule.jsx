import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import SupplierManager from './SupplierManager'
import UpcomingLeave from './UpcomingLeave'

export default function PayrollModule({ onSaveStateChange }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('suppliers')

  useEffect(() => {
    api.getSuppliers()
      .then(setSuppliers)
      .finally(() => setLoading(false))
  }, [])

  async function addSupplier(data) {
    onSaveStateChange('saving')
    const s = await api.createSupplier(data)
    setSuppliers(prev => [...prev, s])
    onSaveStateChange('saved')
  }

  async function updateSupplier(id, data) {
    onSaveStateChange('saving')
    const s = await api.updateSupplier(id, data)
    setSuppliers(prev => prev.map(x => x.id === id ? s : x))
    onSaveStateChange('saved')
  }

  async function deleteSupplier(id) {
    onSaveStateChange('saving')
    await api.deleteSupplier(id)
    setSuppliers(prev => prev.filter(s => s.id !== id))
    onSaveStateChange('saved')
  }


  if (loading) return <div className="page" style={{ color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Payroll</div>
          <div className="page-subtitle">Labour hire rate cards and upcoming leave</div>
        </div>
      </div>

      <div className="tabs">
        {[['suppliers', 'Suppliers & rate cards'], ['leave', 'Upcoming leave']].map(([id, label]) => (
          <button key={id} className={`tab-btn${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'suppliers' && (
        <SupplierManager
          suppliers={suppliers}
          onAdd={addSupplier}
          onUpdate={updateSupplier}
          onDelete={deleteSupplier}
        />
      )}
      {tab === 'leave' && <UpcomingLeave />}
    </div>
  )
}

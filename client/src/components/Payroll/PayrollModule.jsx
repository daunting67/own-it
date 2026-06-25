import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import SupplierManager from './SupplierManager'
import InvoiceList from './InvoiceList'

export default function PayrollModule({ onSaveStateChange }) {
  const [suppliers, setSuppliers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('invoices')

  useEffect(() => {
    Promise.all([api.getSuppliers(), api.getInvoices()])
      .then(([su, inv]) => { setSuppliers(su); setInvoices(inv) })
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

  async function addInvoice(data) {
    onSaveStateChange('saving')
    const inv = await api.createInvoice(data)
    setInvoices(prev => [inv, ...prev])
    onSaveStateChange('saved')
  }

  async function updateInvoice(id, data) {
    onSaveStateChange('saving')
    const inv = await api.updateInvoice(id, data)
    setInvoices(prev => prev.map(x => x.id === id ? inv : x))
    onSaveStateChange('saved')
  }

  async function deleteInvoice(id) {
    onSaveStateChange('saving')
    await api.deleteInvoice(id)
    setInvoices(prev => prev.filter(i => i.id !== id))
    onSaveStateChange('saved')
  }

  const totals = {
    pending: invoices.filter(i => i.status === 'pending').length,
    approved: invoices.filter(i => i.status === 'approved').length,
    disputed: invoices.filter(i => i.status === 'disputed').length,
  }

  if (loading) return <div className="page" style={{ color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Payroll</div>
          <div className="page-subtitle">Labour hire rate cards, invoice register, and reconciliation</div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Pending invoices</div>
          <div className="metric-value" style={{ color: 'var(--warning)' }}>{totals.pending}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Approved</div>
          <div className="metric-value" style={{ color: 'var(--success)' }}>{totals.approved}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Disputed</div>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{totals.disputed}</div>
        </div>
      </div>

      <div className="tabs">
        {[['invoices', 'Invoice register'], ['suppliers', 'Suppliers & rate cards']].map(([id, label]) => (
          <button key={id} className={`tab-btn${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <InvoiceList
          invoices={invoices}
          suppliers={suppliers}
          onAdd={addInvoice}
          onUpdate={updateInvoice}
          onDelete={deleteInvoice}
        />
      )}
      {tab === 'suppliers' && (
        <SupplierManager
          suppliers={suppliers}
          onAdd={addSupplier}
          onUpdate={updateSupplier}
          onDelete={deleteSupplier}
        />
      )}
    </div>
  )
}

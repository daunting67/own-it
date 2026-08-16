import { useState } from 'react'
import { api } from '../../lib/api'
import ReconciliationCard from './ReconciliationCard'

const TABS = [
  {
    key: 'fuel',
    label: '⛽ Fuel Receipt Reconciliation',
    props: {
      icon: '⛽',
      title: 'Cost Control — Fuel Receipt Reconciliation',
      description: 'Upload the supplier invoice and driver receipts (or bowser photos where a receipt wasn\'t kept) — '
        + 'get a branded reconciliation workbook showing what\'s matched, missing, or needs a decision',
      sourceLabel: 'Supplier invoice (PDF) — one file, e.g. the Z Energy tax invoice',
      receiptsLabel: 'Receipts & bowser photos — driver "Fuel Card Receipts" PDFs, batch scans, or photos of the pump display',
      api: {
        getRuns: api.getCostControlRuns,
        getRunDocument: api.getCostControlRunDocument,
        getUploadUrl: api.getCostControlUploadUrl,
        run: api.runCostControl,
      },
    },
  },
  {
    key: 'debit',
    label: '💳 Debit Card Receipts',
    props: {
      icon: '💳',
      title: 'Cost Control — Debit Card Receipt Reconciliation',
      description: 'Upload the debit card statement and driver receipts — get a branded reconciliation workbook '
        + 'showing what\'s matched, missing, or needs a decision',
      sourceLabel: 'Debit card statement (PDF) — one file, from the bank or card provider',
      receiptsLabel: 'Receipts — driver "Debit Card Receipts" PDFs or batch scans',
      api: {
        getRuns: api.getDebitCardRuns,
        getRunDocument: api.getDebitCardRunDocument,
        getUploadUrl: api.getDebitCardUploadUrl,
        run: api.runDebitCardRecon,
      },
    },
  },
]

export default function CostControlModule() {
  const [tab, setTab] = useState(TABS[0].key)
  const active = TABS.find(t => t.key === tab)

  return (
    <div style={{ maxWidth: 800, margin: '32px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={t.key === tab ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ReconciliationCard key={active.key} {...active.props} />
    </div>
  )
}

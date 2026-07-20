import { useState } from 'react'

const PO_TOOL_URL = 'http://5.78.210.250'

export default function ProjectManagementModule() {
  const [activeTab, setActiveTab] = useState('po')

  return (
    <div style={{ maxWidth: 800, margin: '32px auto', padding: '0 16px' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: 28 }}>
        <button
          onClick={() => setActiveTab('po')}
          style={{
            padding: '12px 20px',
            background: activeTab === 'po' ? 'var(--bg-secondary)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'po' ? '2px solid var(--accent-color)' : 'none',
            color: activeTab === 'po' ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: activeTab === 'po' ? 600 : 400,
          }}
        >
          Purchase Orders
        </button>
        <button
          onClick={() => setActiveTab('soq')}
          style={{
            padding: '12px 20px',
            background: activeTab === 'soq' ? 'var(--bg-secondary)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'soq' ? '2px solid var(--accent-color)' : 'none',
            color: activeTab === 'soq' ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: activeTab === 'soq' ? 600 : 400,
          }}
        >
          Schedule of Quantities
        </button>
      </div>

      {/* PO Tab */}
      {activeTab === 'po' && (
        <div className="card" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span style={{ fontSize: 34 }}>🛒</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Purchase Order Tool</h2>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Upload a vendor quote PDF — the PO form is auto-filled and sent to FastField
              </div>
            </div>
          </div>

          <ol style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.9, margin: '14px 0 20px', paddingLeft: 20 }}>
            <li>Open the tool and sign in with the team password</li>
            <li>Upload or drag in the vendor quote PDF</li>
            <li>Check the extracted details and line items</li>
            <li>Enter <strong>your own email</strong> in "Assign To", then send</li>
            <li>Open the FastField app to complete and sign the PO</li>
          </ol>

          <a
            href={PO_TOOL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Open PO Tool →
          </a>
        </div>
      )}

      {/* SOQ Tab */}
      {activeTab === 'soq' && (
        <div className="card" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span style={{ fontSize: 34 }}>📊</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Schedule of Quantities</h2>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Upload civil/resource consent plans — get an AI-generated materials and quantities schedule
              </div>
            </div>
          </div>

          <ol style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.9, margin: '14px 0 20px', paddingLeft: 20 }}>
            <li>Upload or drag in civil and resource consent plans (PDFs)</li>
            <li>AI reads the plans and extracts quantities</li>
            <li>Download the branded Materials & Quantities Schedule (Excel)</li>
            <li>Use for estimation, budgeting, or resource planning</li>
          </ol>

          <div style={{
            padding: 16,
            background: 'var(--bg-secondary)',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 13,
            color: 'var(--text-muted)'
          }}>
            ℹ️ Coming soon — Schedule of Quantities processing is being configured
          </div>

          <button
            disabled
            className="btn btn-primary"
            style={{ display: 'inline-block', opacity: 0.5, cursor: 'not-allowed' }}
          >
            Upload Plans →
          </button>
        </div>
      )}
    </div>
  )
}

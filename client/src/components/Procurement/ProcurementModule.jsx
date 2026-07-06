const PO_TOOL_URL = 'http://5.78.210.250'

export default function ProcurementModule() {
  return (
    <div style={{ maxWidth: 640, margin: '32px auto', padding: '0 16px' }}>
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
    </div>
  )
}

export default function Topbar({ title, saveState, pendingCount, onAlert }) {
  const dateLine = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">{title}</div>
        <div className="topbar-date">{dateLine}</div>
      </div>
      <span className="save-indicator">
        {saveState === 'saving' && 'Saving…'}
        {saveState === 'saved' && 'Saved'}
      </span>
      {pendingCount > 0 && (
        <button className="btn-orange" onClick={onAlert}>
          ⚠ {pendingCount} pending invoice{pendingCount !== 1 ? 's' : ''}
        </button>
      )}
    </header>
  )
}

import { useState, useEffect } from 'react'

function elapsedLabel(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

// Shown while a Cost Control process runs. These take minutes, and a single step can be
// silent for a long stretch — reading a dense page, thinking about a clause — so a static
// "Working…" is indistinguishable from a hung page, and people reload, which loses the run.
// Three things here are always true: the dot is moving, the clock is counting, and the bar
// either fills or sweeps. Any one of them tells you it has not died.
export default function WorkingIndicator({ label, note, done, total, startedAt }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const seconds = Math.max(0, Math.floor((now - (startedAt || now)) / 1000))
  const determinate = Number.isFinite(total) && total > 0
  const pct = determinate ? Math.min(100, Math.round((done / total) * 100)) : null

  return (
    <div className="pi-working" role="status" aria-live="polite">
      <span className="pi-working-dot" />
      <div className="pi-working-text">
        <div>{label || 'Working…'}</div>
        {note && <div className="pi-working-sub">{note}</div>}
        <div className="pi-working-bar">
          {determinate
            ? <div className="pi-working-fill" style={{ width: `${pct}%` }} />
            : <div className="pi-working-fill-indeterminate" />}
        </div>
      </div>
      <span className="pi-working-elapsed">{elapsedLabel(seconds)}</span>
    </div>
  )
}

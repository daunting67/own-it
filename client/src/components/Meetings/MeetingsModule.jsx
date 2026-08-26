import { useState } from 'react'
import ProcessesModule from '../Processes/ProcessesModule'

const MEETING_PROCESSES = [
  { id: 'office-minutes', label: 'Office Minutes' },
  { id: 'debrief', label: 'Debrief' },
  { id: 'meeting-notes', label: 'Meeting Notes' },
]

export default function MeetingsModule() {
  const [tab, setTab] = useState('office-minutes')

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Meetings</div>
          <div className="page-subtitle">Office minutes, job debriefs, and personal meeting notes — run from a transcript</div>
        </div>
      </div>

      <div className="tabs">
        {MEETING_PROCESSES.map(p => (
          <button
            key={p.id}
            className={`tab-btn${tab === p.id ? ' active' : ''}`}
            onClick={() => setTab(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ProcessesModule key={tab} only={tab} />
    </div>
  )
}

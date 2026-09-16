import { useState, useRef } from 'react'

// Drag-and-drop file picker used by every Cost Control process. A dropped folder or a
// dragged selection from Finder/Outlook is the way these files actually arrive — the
// plain <input type="file"> it replaces made people click through a file dialog for a
// month's receipts. Clicking the zone still opens that dialog, so nothing is lost for
// anyone who prefers it (or is on a touch device, where there is no drag).
export default function FileDropZone({
  label, hint, accept, multiple = false, disabled = false,
  files = [], onFiles, onRemove,
}) {
  const [over, setOver] = useState(false)
  const [duplicateNote, setDuplicateNote] = useState('')
  const inputRef = useRef(null)

  function take(list) {
    const picked = Array.from(list || [])
    if (!picked.length) return
    // Drop the same file twice and it used to be READ twice — on the first real credit
    // application review (Franklin Smith, 16 Sep 2026) that meant the terms of business
    // was analysed end to end twice over, producing 55 clauses where there were 28, a
    // table full of near-duplicate rows, and double the time and cost. Nothing downstream
    // can tell an intentional duplicate from a slip, so it is caught here.
    const seen = new Set(files.map(f => `${f.name}:${f.size}`))
    const fresh = picked.filter(f => {
      const key = `${f.name}:${f.size}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const skipped = picked.length - fresh.length
    setDuplicateNote(skipped
      ? `${skipped === 1 ? 'That file is' : `${skipped} of those files are`} already in the list — added once, not twice.`
      : '')
    if (!fresh.length) return
    onFiles(multiple ? fresh : fresh.slice(0, 1))
  }

  function onDrop(e) {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    take(e.dataTransfer?.files)
  }

  // dragover must be cancelled on every event or the browser reverts to its default
  // behaviour — which is to navigate the tab to the dropped file and lose the page.
  function onDragOver(e) {
    e.preventDefault()
    if (!disabled) setOver(true)
  }

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={e => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() }
        }}
        style={{
          // --pi-orange / --pi-blue-tint are the house accent and tint (index.css); the
          // theme has no --bg-secondary, so a tint named there would render as nothing.
          border: `2px dashed ${over ? 'var(--pi-orange)' : 'var(--border)'}`,
          background: over ? 'var(--pi-blue-tint)' : 'transparent',
          borderRadius: 8,
          padding: '22px 16px',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'border-color .12s, background .12s',
        }}
      >
        <div style={{ fontSize: 22, marginBottom: 4 }}>{over ? '📥' : '⬆️'}</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {over ? 'Drop to add' : `Drag ${multiple ? 'files' : 'the file'} here`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>or click to browse</div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={e => { take(e.target.files); e.target.value = '' }}
          style={{ display: 'none' }}
        />
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
      {duplicateNote && (
        <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4, fontWeight: 600 }}>{duplicateNote}</div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              {!disabled && onRemove && (
                <button
                  onClick={e => { e.stopPropagation(); onRemove(i) }}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                >
                  ✕ remove
                </button>
              )}
            </div>
          ))}
          {multiple && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {files.length} file{files.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

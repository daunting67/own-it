import { useRef, useState, useEffect, useCallback } from 'react'

// One crew member signing on, on the iPad, with a finger.
//
// Pointer events (not touch events) so a finger, an Apple Pencil and a mouse
// all draw the same way. The canvas is backed at device resolution so the
// signature isn't a blurry mess on a Retina screen, and touch-action:none stops
// iPadOS scrolling the page while someone is signing.
export default function SignOnPad({ open, declaration, staffNames = [], initial = null, onSave, onClose }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)
  const [name, setName] = useState('')
  const [employer, setEmployer] = useState('P&I (North) Ltd')
  const [visitor, setVisitor] = useState(false)
  const [hazardId, setHazardId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name || '')
    setEmployer(initial?.employer || 'P&I (North) Ltd')
    setVisitor(!!initial?.visitor)
    setHazardId(initial?.hazardId || '')
    setError('')
    hasInk.current = false
  }, [open, initial])

  // Size the backing store the moment the canvas mounts (a callback ref, not an
  // effect — setting canvas.width CLEARS it, and doing that a frame later could
  // wipe the first stroke of a fast signer). Coordinates are converted from CSS
  // pixels to backing-store pixels on every event instead of scaling the
  // context once, so rotating the iPad mid-sheet can't skew the next stroke.
  const attachCanvas = useCallback(node => {
    canvasRef.current = node
    if (!node) return
    const rect = node.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    node.width = Math.round(rect.width * ratio)
    node.height = Math.round(rect.height * ratio)
    const ctx = node.getContext('2d')
    ctx.lineWidth = 2.5 * ratio
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1B1B1B'
  }, [])

  function pointFrom(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function start(e) {
    e.preventDefault()
    drawing.current = true
    canvasRef.current.setPointerCapture(e.pointerId)
    const { x, y } = pointFrom(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(x, y)
    // A dot, so a signature made of taps (a full stop, a dotted i) still marks
    // the canvas as signed even if the finger never moves.
    ctx.lineTo(x + 0.01, y)
    ctx.stroke()
    hasInk.current = true
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const { x, y } = pointFrom(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineTo(x, y)
    ctx.stroke()
    hasInk.current = true
  }

  function end() {
    drawing.current = false
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasInk.current = false
  }

  function save() {
    if (!name.trim()) return setError('Enter your name')
    if (!hasInk.current) return setError('Please sign in the box')
    onSave({
      name: name.trim(),
      employer: employer.trim(),
      visitor,
      hazardId: hazardId.trim(),
      signature: canvasRef.current.toDataURL('image/png'),
      timeIn: new Date().toISOString(),
    })
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg ps-signon-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Crew sign-on</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="ps-declaration">{declaration}</div>

          <div className="ps-signon-fields">
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input
                className="form-input ps-input"
                value={name}
                onChange={e => setName(e.target.value)}
                list="ps-staff-names"
                placeholder="Your full name"
                autoComplete="off"
              />
              <datalist id="ps-staff-names">
                {staffNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">Employer / company</label>
              <input className="form-input ps-input" value={employer} onChange={e => setEmployer(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Hazard ID</label>
              <input
                className="form-input ps-input"
                value={hazardId}
                onChange={e => setHazardId(e.target.value)}
                placeholder="Hazard raised, if any"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Visitor</label>
              <button
                type="button"
                className={`ps-toggle${visitor ? ' on' : ''}`}
                onClick={() => setVisitor(v => !v)}
              >
                {visitor ? 'Yes — visitor' : 'No — crew'}
              </button>
            </div>
          </div>

          <div className="ps-sig-head">
            <span className="form-label">Signature</span>
            <button className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
          </div>
          <canvas
            ref={attachCanvas}
            className="ps-sig-canvas"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            onPointerCancel={end}
          />
          {error && <div className="ps-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary ps-btn-lg" onClick={save}>Sign on</button>
        </div>
      </div>
    </div>
  )
}

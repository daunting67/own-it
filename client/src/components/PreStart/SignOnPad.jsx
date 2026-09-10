import { useState, useEffect } from 'react'

// A downscaled thumbnail, not the raw camera photo — a full-res iPad photo is
// several MB, which is both slow to store for every sign-on and unnecessary
// for what this is actually for (proof of who was on site, not a portrait).
// Capped small enough that ~20 sign-ons in one briefing stay well inside
// localStorage's ~5MB budget and Supabase Storage's per-file cost.
const THUMB_MAX_DIMENSION = 320
const THUMB_QUALITY = 0.7

function fileToThumbnail(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the photo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not read the photo'))
      img.onload = () => {
        const scale = Math.min(1, THUMB_MAX_DIMENSION / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// One crew member signing on, on the iPad. A front-camera thumbnail replaces
// what used to be a finger-drawn signature — a photo is a better answer to
// "who actually signed for this" than a scribble anyone could draw for anyone
// else, and it's what ends up on the permanent Teammate record.
export default function SignOnPad({ open, declaration, staffNames = [], initial = null, onSave, onClose }) {
  const [name, setName] = useState('')
  const [employer, setEmployer] = useState('P&I (North) Ltd')
  const [visitor, setVisitor] = useState(false)
  const [hazardId, setHazardId] = useState('')
  const [photo, setPhoto] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Reset every time the pad opens, same as before — whether it's opening for
  // a different person, or reopening for the same "someone not on the list"
  // (initial === null) after a previous entry left fields populated.
  useEffect(() => {
    if (!open) return
    setName(initial?.name || '')
    setEmployer(initial?.employer || 'P&I (North) Ltd')
    setVisitor(!!initial?.visitor)
    setHazardId(initial?.hazardId || '')
    setPhoto(null)
    setError('')
  }, [open, initial])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setPhoto(await fileToThumbnail(file))
    } catch (err) {
      setError(err.message || 'Could not read the photo')
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!name.trim()) return setError('Enter your name')
    if (!photo) return setError('Take a photo to sign on')
    onSave({
      name: name.trim(),
      employer: employer.trim(),
      visitor,
      hazardId: hazardId.trim(),
      photo,
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
            <span className="form-label">Photo</span>
          </div>
          <div className="ps-photo">
            {photo && <img className="ps-photo-preview ps-signon-photo-preview" src={photo} alt="" />}
            <div className="ps-photo-actions">
              <label className="btn btn-secondary ps-btn-lg">
                {busy ? 'Reading photo…' : photo ? 'Retake photo' : 'Take photo'}
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  style={{ display: 'none' }}
                  disabled={busy}
                  onChange={handleFile}
                />
              </label>
            </div>
          </div>
          {error && <div className="ps-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary ps-btn-lg" onClick={save} disabled={busy}>Sign on</button>
        </div>
      </div>
    </div>
  )
}

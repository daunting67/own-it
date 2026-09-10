import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, LINZ_IS_DEMO_KEY,
  currentPosition, lonLatToWorld, worldToLonLat, renderAerial,
} from './tmpGeo'
import { SYMBOLS, SYMBOL_GROUPS, drawPreview } from './tmpSymbols'
import { drawPlan, PLAN_HEIGHT, PLAN_WIDTH, TITLE_HEIGHT } from './tmpRender'

// Full-screen traffic management plan builder for the Pre-Start Vehicle
// Movement Plan. Drops a pin on the foreman's GPS position, pulls the LINZ
// aerial for that spot, and lets him lay out the site over it with the usual
// TTM kit. Saves a flat PNG into vmpDiagram (so the briefing view, the record
// and any export keep working unchanged) plus the structured plan in vmpPlan so
// it can be reopened and edited rather than redrawn from scratch.

const nextId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export default function TmpBuilder({ value, meta = {}, onSave, onClose }) {
  const [step, setStep] = useState(value?.centre ? 'edit' : 'locate')
  const [centre, setCentre] = useState(value?.centre || null)
  const [zoom, setZoom] = useState(value?.zoom || DEFAULT_ZOOM)
  const [accuracy, setAccuracy] = useState(value?.accuracy ?? null)
  const [items, setItems] = useState(value?.items || [])
  const [selectedId, setSelectedId] = useState(null)
  const [tool, setTool] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const canvasRef = useRef(null)
  const baseRef = useRef(null)
  const dragRef = useRef(null)
  const panRef = useRef(null)

  const selected = items.find(i => i.id === selectedId) || null

  /* ------------------------------------------------------------- the base */

  const loadAerial = useCallback(async (nextCentre, nextZoom) => {
    setBusy('Loading the aerial photo…')
    setError('')
    try {
      baseRef.current = await renderAerial({
        lon: nextCentre.lon,
        lat: nextCentre.lat,
        zoom: nextZoom,
        width: PLAN_WIDTH,
        height: PLAN_HEIGHT,
      })
    } catch (err) {
      setError(err.message || 'Could not load the aerial photo.')
    } finally {
      setBusy('')
      redraw()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (centre) loadAerial(centre, zoom)
  }, [centre, zoom, loadAerial])

  const locate = useCallback(async () => {
    setBusy('Finding your position…')
    setError('')
    try {
      const pos = await currentPosition()
      setAccuracy(pos.accuracy)
      setCentre({ lon: pos.lon, lat: pos.lat })
      // The pin goes in the middle, because that is where the fix put us.
      setItems(current =>
        current.some(i => i.type === 'pin')
          ? current
          : [...current, { id: nextId(), type: 'pin', x: PLAN_WIDTH / 2, y: (PLAN_HEIGHT - TITLE_HEIGHT) / 2, rotation: 0, scale: 1, text: 'YOU ARE HERE' }]
      )
      setStep('edit')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }, [])

  /* ---------------------------------------------------------------- paint */

  const planMeta = useMemo(() => ({
    ...meta,
    lat: centre?.lat,
    lon: centre?.lon,
    zoom,
  }), [meta, centre, zoom])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pan = panRef.current
    ctx.save()
    if (pan) {
      ctx.clearRect(0, 0, PLAN_WIDTH, PLAN_HEIGHT)
      ctx.translate(pan.dx, pan.dy)
    }
    drawPlan(ctx, {
      base: baseRef.current,
      items,
      draft,
      meta: planMeta,
      selectedId,
      chrome: !pan, // while panning the title block would slide off with it
    })
    ctx.restore()
  }, [items, draft, planMeta, selectedId])

  useEffect(() => { redraw() }, [redraw])

  /* ------------------------------------------------------------ hit tests */

  // Canvas is drawn at plan resolution and scaled by CSS, so pointer positions
  // have to come back through that scale before they mean anything.
  function toPlan(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * PLAN_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * PLAN_HEIGHT,
    }
  }

  function hitTest({ x, y }) {
    // Topmost first: the thing drawn last is the thing under your finger.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      const def = SYMBOLS[item.type]
      if (!def) continue
      if (def.kind === 'run') {
        const pts = item.points || []
        for (let p = 0; p < pts.length - 1; p++) {
          if (distanceToSegment(x, y, pts[p], pts[p + 1]) < 16) return item
        }
      } else if (Math.hypot(x - item.x, y - item.y) < 26 * (item.scale || 1)) {
        return item
      }
    }
    return null
  }

  /* ------------------------------------------------------------- pointers */

  function onPointerDown(e) {
    if (busy || !centre) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = toPlan(e)

    if (tool === 'pan') {
      panRef.current = { dx: 0, dy: 0, fromX: e.clientX, fromY: e.clientY }
      return
    }

    if (tool && SYMBOLS[tool]?.kind === 'run') {
      setDraft(d => ({
        id: d?.id || nextId(),
        type: tool,
        scale: 1,
        text: SYMBOLS[tool].defaultText || '',
        points: [...(d?.points || []), [p.x, p.y]],
      }))
      return
    }

    if (tool && SYMBOLS[tool]) {
      const item = {
        id: nextId(), type: tool, x: p.x, y: p.y, rotation: 0, scale: 1,
        text: SYMBOLS[tool].defaultText || '',
      }
      setItems(cur => [...cur, item])
      setSelectedId(item.id)
      // Cones and barriers come in numbers, so the tool stays armed; one-offs
      // like the entry gate drop out of tool mode so he can adjust it.
      if (!['cone', 'sign', 'speed', 'note'].includes(tool)) setTool(null)
      return
    }

    const hit = hitTest(p)
    setSelectedId(hit?.id || null)
    if (hit) dragRef.current = { id: hit.id, from: p, item: hit }
  }

  function onPointerMove(e) {
    if (panRef.current) {
      panRef.current.dx = e.clientX - panRef.current.fromX
      panRef.current.dy = e.clientY - panRef.current.fromY
      redraw()
      return
    }
    const drag = dragRef.current
    if (!drag) return
    const p = toPlan(e)
    const dx = p.x - drag.from.x
    const dy = p.y - drag.from.y
    setItems(cur => cur.map(item => {
      if (item.id !== drag.id) return item
      if (SYMBOLS[item.type]?.kind === 'run') {
        return { ...item, points: (drag.item.points || []).map(([x, y]) => [x + dx, y + dy]) }
      }
      return { ...item, x: drag.item.x + dx, y: drag.item.y + dy }
    }))
  }

  function onPointerUp() {
    const pan = panRef.current
    if (pan) {
      panRef.current = null
      const { dx, dy } = pan
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        // Dragging the picture right means the centre moves left. The symbols
        // are pinned to the ground, so they travel with the imagery.
        const scale = PLAN_WIDTH / canvasRef.current.getBoundingClientRect().width
        const px = dx * scale
        const py = dy * scale
        const world = lonLatToWorld(centre.lon, centre.lat, zoom)
        const moved = worldToLonLat(world.x - px, world.y - py, zoom)
        setItems(cur => cur.map(item =>
          SYMBOLS[item.type]?.kind === 'run'
            ? { ...item, points: (item.points || []).map(([x, y]) => [x + px, y + py]) }
            : { ...item, x: item.x + px, y: item.y + py }
        ))
        setCentre({ lon: moved.lon, lat: moved.lat })
      } else {
        redraw()
      }
      return
    }
    dragRef.current = null
  }

  /* ---------------------------------------------------------------- tools */

  function finishRun() {
    if (draft && (draft.points || []).length >= 2) setItems(cur => [...cur, draft])
    setDraft(null)
    setTool(null)
  }

  function changeZoom(next) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    if (clamped === zoom) return
    // Everything already placed keeps its position on the ground: scale the
    // plan coordinates about the centre by the zoom ratio.
    const k = 2 ** (clamped - zoom)
    const cx = PLAN_WIDTH / 2
    const cy = PLAN_HEIGHT / 2
    const move = (x, y) => [cx + (x - cx) * k, cy + (y - cy) * k]
    setItems(cur => cur.map(item =>
      SYMBOLS[item.type]?.kind === 'run'
        ? { ...item, points: (item.points || []).map(([x, y]) => move(x, y)) }
        : { ...item, ...(([nx, ny]) => ({ x: nx, y: ny }))(move(item.x, item.y)) }
    ))
    setZoom(clamped)
  }

  function updateSelected(patch) {
    setItems(cur => cur.map(i => (i.id === selectedId ? { ...i, ...patch } : i)))
  }

  function deleteSelected() {
    setItems(cur => cur.filter(i => i.id !== selectedId))
    setSelectedId(null)
  }

  /* ----------------------------------------------------------------- save */

  async function save() {
    setSaving(true)
    setError('')
    try {
      const out = document.createElement('canvas')
      out.width = PLAN_WIDTH
      out.height = PLAN_HEIGHT
      // The export never shows the selection ring or a half-finished run.
      drawPlan(out.getContext('2d'), {
        base: baseRef.current,
        items,
        meta: planMeta,
        selectedId: null,
        chrome: true,
      })
      // JPEG at 0.82 keeps a full aerial plan around 250–400 KB, comfortably
      // under the 3 MB the briefing endpoint accepts for this field.
      const dataUrl = out.toDataURL('image/jpeg', 0.82)
      await onSave(dataUrl, { centre, zoom, accuracy, items, savedAt: new Date().toISOString() })
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save the plan.')
      setSaving(false)
    }
  }

  /* ------------------------------------------------------------------ UI  */

  if (step === 'locate') {
    return (
      <div className="tmp-overlay">
        <div className="tmp-locate">
          <h2>Build the traffic management plan</h2>
          <p>
            Stand where you want the plan centred — usually the site entry — and tap below.
            We drop a pin on your position and pull the aerial photo of that spot, then you
            lay out the cones, barriers and routes on top.
          </p>
          {error && <div className="tmp-error">{error}</div>}
          <div className="tmp-locate-actions">
            <button className="btn btn-primary ps-btn-lg" onClick={locate} disabled={!!busy}>
              {busy || 'Drop a pin where I am standing'}
            </button>
            <button className="btn btn-secondary ps-btn-lg" onClick={onClose} disabled={!!busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  const activeDef = tool ? SYMBOLS[tool] : null

  return (
    <div className="tmp-overlay">
      <div className="tmp-shell">
        <header className="tmp-bar">
          <div className="tmp-bar-title">
            Traffic management plan
            {accuracy != null && <span className="tmp-accuracy">GPS ±{Math.round(accuracy)} m</span>}
          </div>
          <div className="tmp-bar-actions">
            <button className="btn btn-secondary ps-btn-lg" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary ps-btn-lg" onClick={save} disabled={saving || !!busy}>
              {saving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </header>

        <div className="tmp-body">
          <aside className="tmp-palette">
            <button
              className={`tmp-tool tmp-tool-wide${tool === 'pan' ? ' on' : ''}`}
              onClick={() => { setTool(tool === 'pan' ? null : 'pan'); setDraft(null) }}
            >
              {tool === 'pan' ? 'Done moving' : 'Move the map'}
            </button>
            {SYMBOL_GROUPS.map(group => (
              <div key={group} className="tmp-group">
                <div className="tmp-group-label">{group}</div>
                <div className="tmp-group-tools">
                  {Object.entries(SYMBOLS)
                    .filter(([, def]) => def.group === group)
                    .map(([id, def]) => (
                      <button
                        key={id}
                        className={`tmp-tool${tool === id ? ' on' : ''}`}
                        onClick={() => {
                          if (draft) finishRun()
                          setTool(tool === id ? null : id)
                          setSelectedId(null)
                        }}
                      >
                        <SymbolIcon type={id} />
                        <span>{def.label}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </aside>

          <div className="tmp-stage">
            <div className="tmp-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="tmp-canvas"
              width={PLAN_WIDTH}
              height={PLAN_HEIGHT}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {busy && <div className="tmp-busy">{busy}</div>}
            {error && <div className="tmp-error tmp-error-float">{error}</div>}

            <div className="tmp-hint">
              {draft
                ? `${activeDef?.label}: tap each corner, then Finish.`
                : activeDef
                  ? activeDef.hint || `Tap the plan to place a ${activeDef.label.toLowerCase()}.`
                  : tool === 'pan'
                    ? 'Drag the plan to move the map.'
                    : 'Tap a symbol, then tap the plan. Tap anything already placed to move it.'}
            </div>

            <div className="tmp-zoom">
              <button className="tmp-zoom-btn" onClick={() => changeZoom(zoom - 1)} disabled={zoom <= MIN_ZOOM}>−</button>
              <span>Zoom {zoom}</span>
              <button className="tmp-zoom-btn" onClick={() => changeZoom(zoom + 1)} disabled={zoom >= MAX_ZOOM}>+</button>
            </div>
            </div>
          </div>
        </div>

        <footer className="tmp-foot">
          {draft ? (
            <>
              <span className="tmp-foot-label">{activeDef?.label} · {(draft.points || []).length} point(s)</span>
              <button className="btn btn-secondary ps-btn-lg" onClick={() => setDraft(d => ({ ...d, points: (d.points || []).slice(0, -1) }))} disabled={!(draft.points || []).length}>Undo point</button>
              <button className="btn btn-primary ps-btn-lg" onClick={finishRun} disabled={(draft.points || []).length < 2}>Finish</button>
              <button className="btn btn-secondary ps-btn-lg" onClick={() => { setDraft(null); setTool(null) }}>Discard</button>
            </>
          ) : selected ? (
            <>
              <span className="tmp-foot-label">{SYMBOLS[selected.type]?.label}</span>
              {SYMBOLS[selected.type]?.editable && (
                <input
                  className="tmp-foot-input"
                  value={selected.text || ''}
                  placeholder="Label"
                  onChange={e => updateSelected({ text: e.target.value })}
                />
              )}
              {SYMBOLS[selected.type]?.rotatable && (
                <label className="tmp-foot-slider">
                  Rotate
                  <input
                    type="range" min="0" max="359" value={selected.rotation || 0}
                    onChange={e => updateSelected({ rotation: Number(e.target.value) })}
                  />
                </label>
              )}
              <label className="tmp-foot-slider">
                Size
                <input
                  type="range" min="0.6" max="2.4" step="0.1" value={selected.scale || 1}
                  onChange={e => updateSelected({ scale: Number(e.target.value) })}
                />
              </label>
              <button className="btn btn-secondary ps-btn-lg" onClick={deleteSelected}>Remove</button>
            </>
          ) : (
            <span className="tmp-foot-label tmp-foot-empty">
              {items.length} item{items.length === 1 ? '' : 's'} on the plan
            </span>
          )}
          {LINZ_IS_DEMO_KEY && (
            <span className="tmp-foot-note">Using the shared LINZ demo imagery key</span>
          )}
        </footer>
      </div>
    </div>
  )
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// The palette icons are drawn by the same symbol code as the plan, so a cone in
// the list is unmistakably the cone you get.
function SymbolIcon({ type }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, 40, 40)
    drawPreview(ctx, type, 40)
  }, [type])
  return <canvas ref={ref} width="40" height="40" className="tmp-tool-icon" />
}

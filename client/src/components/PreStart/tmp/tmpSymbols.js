// The traffic-management symbol set, drawn with plain canvas 2D primitives.
//
// Everything the foreman places is drawn by exactly one function per symbol,
// used for BOTH the on-screen editor and the exported image. There is no second
// SVG rendering path to keep in sync — what he sees while placing cones is,
// pixel for pixel, what lands in the briefing record.
//
// Point symbols draw around the origin: the caller has already translated to
// the item's position, rotated by its heading and scaled by its size. Run
// symbols are handed the full list of points in plan coordinates and draw
// themselves along it.

const ORANGE = '#f26522'
const YELLOW = '#f5c518'
const WHITE = '#ffffff'
const BLACK = '#14181d'
const RED = '#d0021b'
const GREEN = '#2e9b4f'
const STEEL = '#9aa4ad'

function shadow(ctx, on) {
  // A soft drop shadow is the only thing that keeps a white cone band or a
  // yellow sign legible over pale concrete or a sunlit road surface.
  if (on) {
    ctx.shadowColor = 'rgba(0,0,0,.55)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 1
  } else {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }
}

function outlined(ctx, path, fill, stroke = BLACK, lineWidth = 1.6) {
  ctx.beginPath()
  path()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = stroke
  ctx.stroke()
}

function label(ctx, text, y, size = 9) {
  if (!text) return
  ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0,0,0,.75)'
  ctx.strokeText(text, 0, y)
  ctx.fillStyle = WHITE
  ctx.fillText(text, 0, y)
}

/* ------------------------------------------------------------------ points */

function drawCone(ctx) {
  shadow(ctx, true)
  outlined(ctx, () => {
    ctx.moveTo(0, -11)
    ctx.lineTo(7.5, 8)
    ctx.lineTo(-7.5, 8)
    ctx.closePath()
  }, ORANGE)
  shadow(ctx, false)
  // Reflective band.
  outlined(ctx, () => { ctx.rect(-4.4, -3.5, 8.8, 3.6) }, WHITE, BLACK, 0.9)
  outlined(ctx, () => { ctx.rect(-9.5, 8, 19, 3.4) }, ORANGE, BLACK, 1.2)
}

function drawSpeed(ctx, item) {
  shadow(ctx, true)
  outlined(ctx, () => { ctx.arc(0, 0, 12, 0, Math.PI * 2) }, WHITE, BLACK, 1.2)
  shadow(ctx, false)
  ctx.beginPath()
  ctx.arc(0, 0, 10, 0, Math.PI * 2)
  ctx.lineWidth = 3.4
  ctx.strokeStyle = RED
  ctx.stroke()
  ctx.font = '700 11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = BLACK
  ctx.fillText(String(item.text || '30'), 0, 0.5)
}

function drawArrow(ctx) {
  // Direction of travel. Rotation is the whole point of this one, so it is
  // drawn pointing "up" and the caller's rotation does the work.
  shadow(ctx, true)
  outlined(ctx, () => {
    ctx.moveTo(0, -14)
    ctx.lineTo(9, -2)
    ctx.lineTo(3.6, -2)
    ctx.lineTo(3.6, 13)
    ctx.lineTo(-3.6, 13)
    ctx.lineTo(-3.6, -2)
    ctx.lineTo(-9, -2)
    ctx.closePath()
  }, YELLOW, BLACK, 1.4)
  shadow(ctx, false)
}

function drawSign(ctx, item) {
  // NZ temporary warning signage is a yellow diamond with black legend.
  shadow(ctx, true)
  outlined(ctx, () => {
    ctx.moveTo(0, -13); ctx.lineTo(13, 0); ctx.lineTo(0, 13); ctx.lineTo(-13, 0); ctx.closePath()
  }, YELLOW, BLACK, 1.5)
  shadow(ctx, false)
  const text = String(item.text || 'ROAD WORKS').toUpperCase()
  const words = text.split(' ')
  ctx.font = '700 5.2px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = BLACK
  const startY = -((words.length - 1) * 6) / 2
  words.forEach((w, i) => ctx.fillText(w, 0, startY + i * 6))
}

function drawSpotter(ctx, item) {
  shadow(ctx, true)
  outlined(ctx, () => { ctx.arc(0, -8, 4.2, 0, Math.PI * 2) }, '#f6d6a8', BLACK, 1.2)
  outlined(ctx, () => {
    ctx.moveTo(-6, -3.5); ctx.lineTo(6, -3.5); ctx.lineTo(7.5, 10); ctx.lineTo(-7.5, 10); ctx.closePath()
  }, '#c8f000', BLACK, 1.3)
  shadow(ctx, false)
  ctx.beginPath()
  ctx.moveTo(-5.4, 3); ctx.lineTo(5.4, 3)
  ctx.lineWidth = 1.8
  ctx.strokeStyle = STEEL
  ctx.stroke()
  label(ctx, item.text || 'TC', 17)
}

function drawGate(ctx, item, colour, fallback) {
  shadow(ctx, true)
  outlined(ctx, () => {
    ctx.moveTo(0, -13); ctx.lineTo(11, 2); ctx.lineTo(4, 2); ctx.lineTo(4, 12)
    ctx.lineTo(-4, 12); ctx.lineTo(-4, 2); ctx.lineTo(-11, 2); ctx.closePath()
  }, colour, BLACK, 1.4)
  shadow(ctx, false)
  label(ctx, item.text || fallback, 22)
}

function drawPlant(ctx, item) {
  shadow(ctx, true)
  outlined(ctx, () => { ctx.rect(-13, -6, 26, 12) }, '#f0b429', BLACK, 1.4)
  shadow(ctx, false)
  outlined(ctx, () => { ctx.rect(-11, -4.4, 7, 4) }, '#2b3138', BLACK, 0.8)
  outlined(ctx, () => { ctx.arc(-7, 7, 3, 0, Math.PI * 2) }, BLACK, BLACK, 0.8)
  outlined(ctx, () => { ctx.arc(7, 7, 3, 0, Math.PI * 2) }, BLACK, BLACK, 0.8)
  label(ctx, item.text || '', 20)
}

function drawNote(ctx, item) {
  const text = item.text || 'Note'
  ctx.font = '700 11px system-ui, -apple-system, sans-serif'
  const w = ctx.measureText(text).width + 14
  shadow(ctx, true)
  outlined(ctx, () => { ctx.rect(-w / 2, -10, w, 20) }, 'rgba(20,24,29,.86)', WHITE, 1.2)
  shadow(ctx, false)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = WHITE
  ctx.fillText(text, 0, 0.5)
}


function drawPin(ctx, item) {
  // Where the foreman was standing when the plan was started. Placed
  // automatically from the GPS fix, but movable and deletable like anything
  // else — the fix is often a few metres out and he can see where he really is.
  shadow(ctx, true)
  outlined(ctx, () => {
    ctx.moveTo(0, 14)
    ctx.quadraticCurveTo(-11, -1, -11, -7)
    ctx.arc(0, -7, 11, Math.PI, 0)
    ctx.quadraticCurveTo(11, -1, 0, 14)
    ctx.closePath()
  }, '#3d8bff', WHITE, 2)
  shadow(ctx, false)
  outlined(ctx, () => { ctx.arc(0, -7, 4.2, 0, Math.PI * 2) }, WHITE, WHITE, 0)
  label(ctx, item.text || 'YOU ARE HERE', 25)
}

/* -------------------------------------------------------------------- runs */

// Walk a polyline at a fixed spacing, handing back each point and the heading
// there. Every repeating run symbol (cones, barrier blocks, fence posts) is
// built on this, so they all space themselves consistently around corners.
function walk(points, spacing, fn) {
  let carry = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 0.001) continue
    const angle = Math.atan2(dy, dx)
    for (let d = carry; d < len; d += spacing) {
      fn(ax + (dx * d) / len, ay + (dy * d) / len, angle)
      carry = d + spacing - len
    }
    if (len < spacing) carry -= len
  }
  const [lx, ly] = points[points.length - 1]
  const [px, py] = points[points.length - 2] || [lx - 1, ly]
  fn(lx, ly, Math.atan2(ly - py, lx - px))
}

function strokePath(ctx, points, colour, width, dash) {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.setLineDash(dash || [])
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = colour
  ctx.stroke()
  ctx.setLineDash([])
}

function drawConeRun(ctx, points, item) {
  const spacing = 26 * (item.scale || 1)
  walk(points, spacing, (x, y) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(item.scale || 1, item.scale || 1)
    drawCone(ctx)
    ctx.restore()
  })
}

function drawWaterBarrier(ctx, points, item) {
  const s = item.scale || 1
  const block = 22 * s
  let flip = false
  walk(points, block, (x, y, angle) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    shadow(ctx, true)
    outlined(ctx, () => { ctx.rect(-block / 2, -7 * s, block, 14 * s) }, flip ? WHITE : ORANGE, BLACK, 1.3)
    shadow(ctx, false)
    ctx.restore()
    flip = !flip
  })
}

function drawRigidBarrier(ctx, points, item) {
  const s = item.scale || 1
  strokePath(ctx, points, BLACK, 12 * s)
  strokePath(ctx, points, STEEL, 8 * s)
  strokePath(ctx, points, '#e4e9ee', 2.4 * s)
}

function drawTempFence(ctx, points, item) {
  const s = item.scale || 1
  strokePath(ctx, points, 'rgba(20,24,29,.85)', 11 * s)
  strokePath(ctx, points, '#e8edf2', 5.5 * s)
  // Panel feet, so it reads as temporary fencing rather than a solid wall.
  walk(points, 22 * s, (x, y, angle) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    outlined(ctx, () => { ctx.rect(-2.2 * s, -8 * s, 4.4 * s, 16 * s) }, '#7d878f', BLACK, 1.1)
    ctx.restore()
  })
}

function drawTigerTail(ctx, points, item) {
  // A tiger tail is insulation slipped over a live conductor — drawn as the
  // yellow/black striped sleeve everyone recognises, following the span.
  const s = item.scale || 1
  strokePath(ctx, points, BLACK, 11 * s)
  ctx.save()
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.lineWidth = 8 * s
  ctx.lineCap = 'butt'
  ctx.strokeStyle = YELLOW
  ctx.stroke()
  ctx.restore()
  walk(points, 11 * s, (x, y, angle) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillStyle = BLACK
    ctx.fillRect(-2.6 * s, -4 * s, 5.2 * s, 8 * s)
    ctx.restore()
  })
}

function drawExclusion(ctx, points, item) {
  if (points.length < 3) {
    strokePath(ctx, points, RED, 3, [10, 7])
    return
  }
  ctx.save()
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = 'rgba(208,2,27,.18)'
  ctx.fill()
  ctx.clip()
  // Diagonal hatch across the clipped area — the standard "keep out" fill.
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const min = Math.min(...xs, ...ys) - 10
  const max = Math.max(...xs, ...ys) + 10
  ctx.strokeStyle = 'rgba(208,2,27,.55)'
  ctx.lineWidth = 2
  for (let d = min - (max - min); d < max; d += 12) {
    ctx.beginPath()
    ctx.moveTo(d, min)
    ctx.lineTo(d + (max - min), max)
    ctx.stroke()
  }
  ctx.restore()
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.lineWidth = 3
  ctx.strokeStyle = RED
  ctx.stroke()
  if (item.text) {
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length
    ctx.save()
    ctx.translate(cx, cy)
    label(ctx, item.text, 0, 12)
    ctx.restore()
  }
}

function drawRoute(ctx, points, item) {
  // The vehicle route itself: a fat translucent ribbon with arrowheads, so the
  // direction of travel is obvious at a glance.
  const s = item.scale || 1
  strokePath(ctx, points, 'rgba(20,24,29,.5)', 16 * s)
  strokePath(ctx, points, 'rgba(60,160,255,.75)', 12 * s)
  walk(points, 46 * s, (x, y, angle) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    outlined(ctx, () => {
      ctx.moveTo(7 * s, 0); ctx.lineTo(-4 * s, 5 * s); ctx.lineTo(-4 * s, -5 * s); ctx.closePath()
    }, WHITE, BLACK, 0.9)
    ctx.restore()
  })
}

/* ---------------------------------------------------------------- registry */

export const SYMBOLS = {
  cone:        { kind: 'point', label: 'Cone', group: 'Delineation', draw: drawCone },
  coneRun:     { kind: 'run',   label: 'Cone taper / run', group: 'Delineation', draw: drawConeRun, hint: 'Tap along the line of cones' },
  waterBarrier:{ kind: 'run',   label: 'Water-filled barrier', group: 'Barriers', draw: drawWaterBarrier, hint: 'Tap along the run of barriers' },
  barrier:     { kind: 'run',   label: 'Barrier (rigid)', group: 'Barriers', draw: drawRigidBarrier, hint: 'Tap along the barrier line' },
  tempFence:   { kind: 'run',   label: 'Temporary fencing', group: 'Barriers', draw: drawTempFence, hint: 'Tap along the fence line' },
  tigerTail:   { kind: 'run',   label: 'Tiger tail', group: 'Barriers', draw: drawTigerTail, hint: 'Tap along the span that is covered' },
  route:       { kind: 'run',   label: 'Vehicle route', group: 'Movement', draw: drawRoute, hint: 'Tap the route in the direction of travel' },
  arrow:       { kind: 'point', label: 'Direction arrow', group: 'Movement', draw: drawArrow, rotatable: true },
  entry:       { kind: 'point', label: 'Site entry', group: 'Movement', draw: (c, i) => drawGate(c, i, GREEN, 'ENTRY'), rotatable: true, editable: true },
  exit:        { kind: 'point', label: 'Site exit', group: 'Movement', draw: (c, i) => drawGate(c, i, RED, 'EXIT'), rotatable: true, editable: true },
  plant:       { kind: 'point', label: 'Plant / vehicle', group: 'Movement', draw: drawPlant, rotatable: true, editable: true },
  speed:       { kind: 'point', label: 'Speed limit', group: 'Signage', draw: drawSpeed, editable: true, defaultText: '30' },
  sign:        { kind: 'point', label: 'Warning sign', group: 'Signage', draw: drawSign, editable: true, defaultText: 'ROAD WORKS' },
  spotter:     { kind: 'point', label: 'Spotter / TC', group: 'Signage', draw: drawSpotter, editable: true, defaultText: 'TC' },
  exclusion:   { kind: 'run',   label: 'Exclusion zone', group: 'Zones', draw: drawExclusion, editable: true, hint: 'Tap around the edge of the zone' },
  pin:         { kind: 'point', label: 'Your position', group: 'Zones', draw: drawPin, editable: true, defaultText: 'YOU ARE HERE' },
  note:        { kind: 'point', label: 'Text label', group: 'Zones', draw: drawNote, editable: true, defaultText: 'Note' },
}

export const SYMBOL_GROUPS = ['Delineation', 'Barriers', 'Movement', 'Signage', 'Zones']

// Draw one placed item. Shared by the editor and the export.
export function drawItem(ctx, item) {
  const def = SYMBOLS[item.type]
  if (!def) return
  ctx.save()
  if (def.kind === 'run') {
    if ((item.points || []).length < 2) {
      ctx.restore()
      return
    }
    def.draw(ctx, item.points, item)
  } else {
    ctx.translate(item.x, item.y)
    ctx.rotate(((item.rotation || 0) * Math.PI) / 180)
    const s = item.scale || 1
    ctx.scale(s, s)
    def.draw(ctx, item)
  }
  ctx.restore()
}

// A small preview of a symbol, for the palette buttons.
export function drawPreview(ctx, type, size) {
  const def = SYMBOLS[type]
  if (!def) return
  ctx.save()
  ctx.translate(size / 2, size / 2)
  if (def.kind === 'run') {
    const half = size / 2 - 5
    def.draw(ctx, [[-half, 4], [half, -4]], { scale: 0.62, text: '' })
  } else {
    ctx.scale(size / 42, size / 42)
    def.draw(ctx, { text: def.defaultText, scale: 1 })
  }
  ctx.restore()
}

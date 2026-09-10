// Composes the finished plan: aerial base plate, placed symbols, then the
// furniture that makes it read as a traffic management plan rather than a
// screenshot with clip art on it — title block, legend, north arrow, scale bar.

import { drawItem, SYMBOLS } from './tmpSymbols'
import { metresPerPixel } from './tmpGeo'

export const PLAN_WIDTH = 1240
export const PLAN_HEIGHT = 940
export const TITLE_HEIGHT = 118 // reserved strip along the bottom

const INK = '#14181d'
const PAPER = '#ffffff'
const MUTED = '#5d6874'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawNorthArrow(ctx, x, y) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(255,255,255,.9)'
  ctx.strokeStyle = 'rgba(20,24,29,.35)'
  ctx.lineWidth = 1
  roundRect(ctx, -22, -26, 44, 58, 6)
  ctx.fill()
  ctx.stroke()
  // The aerial is always north-up: we never rotate the base plate, so a fixed
  // north arrow is honest.
  ctx.beginPath()
  ctx.moveTo(0, -19); ctx.lineTo(9, 8); ctx.lineTo(0, 2); ctx.closePath()
  ctx.fillStyle = INK
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, -19); ctx.lineTo(-9, 8); ctx.lineTo(0, 2); ctx.closePath()
  ctx.fillStyle = '#c2cad2'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '700 13px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', 0, 21)
  ctx.restore()
}

function drawScaleBar(ctx, x, y, lat, zoom) {
  const mpp = metresPerPixel(lat, zoom)
  // Pick a round number of metres that lands near 150px, so the bar is always
  // a sane figure like 10 m or 25 m rather than "37 m".
  const steps = [5, 10, 20, 25, 50, 100, 200]
  const metres = steps.reduce((best, m) =>
    Math.abs(m / mpp - 150) < Math.abs(best / mpp - 150) ? m : best, steps[0])
  const px = metres / mpp

  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(255,255,255,.9)'
  ctx.strokeStyle = 'rgba(20,24,29,.35)'
  ctx.lineWidth = 1
  roundRect(ctx, -8, -26, px + 16, 40, 6)
  ctx.fill()
  ctx.stroke()

  const half = px / 2
  ctx.fillStyle = INK
  ctx.fillRect(0, -6, half, 7)
  ctx.fillStyle = PAPER
  ctx.fillRect(half, -6, half, 7)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(0, -6, px, 7)

  ctx.font = '600 11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('0', 0, -14)
  ctx.textAlign = 'right'
  ctx.fillText(`${metres} m`, px, -14)
  ctx.restore()
}

function drawLegend(ctx, items, x, y) {
  // Only the symbols actually used — a legend listing sixteen symbols when the
  // plan has three on it is noise.
  const used = [...new Set(items.map(i => i.type))].filter(t => SYMBOLS[t] && t !== 'note')
  if (!used.length) return
  const rowH = 26
  const w = 190
  const h = 30 + used.length * rowH

  ctx.save()
  ctx.translate(x, y - h)
  ctx.fillStyle = 'rgba(255,255,255,.93)'
  ctx.strokeStyle = 'rgba(20,24,29,.35)'
  ctx.lineWidth = 1
  roundRect(ctx, 0, 0, w, h, 6)
  ctx.fill()
  ctx.stroke()

  ctx.font = '700 11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = MUTED
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('LEGEND', 12, 16)

  used.forEach((type, i) => {
    const def = SYMBOLS[type]
    const cy = 34 + i * rowH + 8
    ctx.save()
    ctx.translate(28, cy)
    if (def.kind === 'run') {
      def.draw(ctx, [[-14, 3], [14, -3]], { scale: 0.5, text: '' })
    } else {
      ctx.scale(0.56, 0.56)
      def.draw(ctx, { text: def.defaultText, scale: 1 })
    }
    ctx.restore()
    ctx.font = '600 11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.fillText(def.label, 50, cy)
  })
  ctx.restore()
}

function drawTitleBlock(ctx, meta, width, height) {
  const top = height - TITLE_HEIGHT
  ctx.save()
  ctx.fillStyle = '#f4f6f8'
  ctx.fillRect(0, top, width, TITLE_HEIGHT)
  ctx.strokeStyle = 'rgba(20,24,29,.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, top + 0.5)
  ctx.lineTo(width, top + 0.5)
  ctx.stroke()

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = '800 20px system-ui, -apple-system, sans-serif'
  ctx.fillText('TEMPORARY TRAFFIC MANAGEMENT PLAN', 20, top + 16)
  ctx.font = '600 12px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = MUTED
  ctx.fillText('Site vehicle movement plan · prepared at the pre-start briefing', 20, top + 43)

  const fields = [
    ['SITE', meta.jobSite || '—'],
    ['DATE', meta.date || '—'],
    ['PREPARED BY', meta.foreman || '—'],
    ['GRID REF', meta.lat != null ? `${meta.lat.toFixed(5)}, ${meta.lon.toFixed(5)}` : '—'],
  ]
  fields.forEach(([k, v], i) => {
    const x = 20 + i * 300
    ctx.font = '700 9.5px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = MUTED
    ctx.fillText(k, x, top + 70)
    ctx.font = '600 13px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = INK
    // Long site names must not run into the next column.
    let text = String(v)
    while (text.length > 3 && ctx.measureText(text).width > 280) text = text.slice(0, -1)
    if (text !== String(v)) text = text.slice(0, -1) + '…'
    ctx.fillText(text, x, top + 84)
  })

  ctx.font = '600 10px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = MUTED
  ctx.textAlign = 'right'
  ctx.fillText('Aerial imagery © LINZ · CC BY 4.0', width - 20, top + 22)
  ctx.restore()
}

// The one composite used by both the live editor and the export. `draft` is the
// run currently being tapped out, drawn so the foreman can see it forming.
export function drawPlan(ctx, { base, items = [], draft, meta = {}, selectedId, width = PLAN_WIDTH, height = PLAN_HEIGHT, chrome = true }) {
  ctx.clearRect(0, 0, width, height)
  if (base) ctx.drawImage(base, 0, 0)
  else {
    ctx.fillStyle = '#20242a'
    ctx.fillRect(0, 0, width, height)
  }

  // Symbols are clipped to the map area so nothing bleeds into the title block.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height - (chrome ? TITLE_HEIGHT : 0))
  ctx.clip()
  items.forEach(item => {
    drawItem(ctx, item)
    if (item.id === selectedId) drawSelection(ctx, item)
  })
  if (draft) drawDraft(ctx, draft)
  ctx.restore()

  if (!chrome) return
  drawLegend(ctx, items, 18, height - TITLE_HEIGHT - 18)
  drawNorthArrow(ctx, width - 44, 44)
  if (meta.lat != null) drawScaleBar(ctx, width - 210, height - TITLE_HEIGHT - 24, meta.lat, meta.zoom)
  drawTitleBlock(ctx, meta, width, height)
}

function drawSelection(ctx, item) {
  ctx.save()
  ctx.setLineDash([6, 5])
  ctx.lineWidth = 2
  ctx.strokeStyle = '#4da3ff'
  if (SYMBOLS[item.type]?.kind === 'run') {
    ctx.beginPath()
    ;(item.points || []).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()
    ;(item.points || []).forEach(([x, y]) => {
      ctx.beginPath()
      ctx.setLineDash([])
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#4da3ff'
      ctx.fill()
    })
  } else {
    const r = 26 * (item.scale || 1)
    ctx.beginPath()
    ctx.arc(item.x, item.y, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawDraft(ctx, draft) {
  const pts = draft.points || []
  if (!pts.length) return
  if (pts.length > 1) drawItem(ctx, draft)
  ctx.save()
  ctx.setLineDash([5, 5])
  ctx.strokeStyle = 'rgba(255,255,255,.85)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.stroke()
  ctx.setLineDash([])
  pts.forEach(([x, y]) => {
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#14181d'
    ctx.stroke()
  })
  ctx.restore()
}

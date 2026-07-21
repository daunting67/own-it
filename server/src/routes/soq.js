const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const { buildScheduleXlsx } = require('../lib/buildScheduleXlsx')
const { saveSoqDoc, getSoqDoc } = require('../lib/soqDocs')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/soqUploads')

const PROCESS_ID = 'schedule-of-quantities'
const PROCESS_NAME = 'Schedule of Quantities'

const SYSTEM_PROMPT = `You are a Quantity Surveyor for P&I (North) Ltd (Pipeline & Infrastructure), reading
a set of civil / resource-consent plans (attached as PDFs) to produce a Materials & Quantities
take-off. The plans are graphical consent drawings — the numbers live in the drawing annotations,
legends, cut/fill boxes, long-sections and planting schedules, not in a text layer.

DEFAULT SCOPE: measure everything EXCEPT the buildings / vertical construction — preliminaries,
demolition & site clearance, erosion & sediment control, earthworks, stormwater, wastewater, water
supply, accessway/paving/kerbs & crossings, retaining walls, fencing, landscaping & planting, and
shared-trench services (power/telecom/gas) — unless the user's notes say otherwise.

METHOD:
- FIRM quantities: read straight off drawing annotations (earthworks cut/fill volumes, pipe
  diameters/lengths/grades from long-sections, pit/manhole/soakpit counts, planting-schedule
  counts). Note the source drawing number in the item's "note" field, e.g. "Dwg 210 — firm".
- SCALED quantities: when a length or area isn't annotated (paving, retaining/fence lengths,
  silt-fence, landscape areas), calibrate against a known figure on the same sheet (surveyed net
  site area, or a stated accessway/road length), then estimate. Flag clearly: note ends with
  "(approx)". Expect +/-10-15% and say so in Basis & Assumptions.
- PROVISIONAL items: implied but not dimensioned (e.g. a pool fence noted on an elevation with no
  pool shown). Include but flag clearly as "PROVISIONAL" in the note.
- Consent civil sheets are usually stamped "FOR INFORMATION PURPOSES ONLY" / "indicative only" —
  say so in Basis & Assumptions and note quantities must be confirmed at detailed design / building
  consent and by site measurement.

UNITS: m3 bulk earthworks/volumes, m2 areas, m linear (pipe/kerb/fence/wall), No. counts, Item lump
sums.

Group items into lettered sections (A, B, C, ...) in this order where relevant: Preliminaries &
General; Demolition & Site Clearance; Erosion & Sediment Control; Earthworks; Stormwater Drainage;
Wastewater Drainage; Water Supply; Accessway/Paving/Kerbs; Retaining Walls; Fencing; Landscaping &
Planting; Services — Shared Trench. Omit sections with nothing to measure. Each item needs: ref
(e.g. "A1"), desc, unit, qty (a plain number), note.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "project": {
    "title": "MATERIALS & QUANTITIES SCHEDULE — CIVIL & EXTERNAL WORKS",
    "subtitle": "<project address/description>  ·  excludes the buildings / vertical construction",
    "summary_title": "MATERIALS & QUANTITIES SUMMARY — <PROJECT NAME>",
    "summary_subtitle": "Civil & external works (excludes the buildings)  ·  P&I (North) Ltd",
    "meta": [
      ["Prepared by:", "P&I (North) Ltd — Pipeline & Infrastructure  ·  tony@pipelines.nz"],
      ["Consent refs:", "<consent reference numbers found on the plans, or omit this row>"],
      ["Drawings:", "<drawing set names/numbers used>"],
      ["Status / basis:", "Consent-level ('for information only / indicative'). Firm quantities from drawing annotations; others scaled - see Basis & Assumptions. Rates EXCLUDE GST."]
    ],
    "contingency_pct": 0.10,
    "gst_pct": 0.15
  },
  "sections": [
    { "letter": "A", "title": "PRELIMINARIES & GENERAL", "items": [
      { "ref": "A1", "desc": "...", "unit": "Item", "qty": 1, "note": "..." }
    ] }
  ],
  "basis": [
    ["h", "Scope"],
    ["", "line of body text"],
    ["h", "Status of the drawings"],
    ["", "line of body text"],
    ["h", "Firm quantities (from drawing annotations)"],
    ["", "line of body text"],
    ["h", "Scaled quantities (approximate, +/- 10-15%)"],
    ["", "line of body text"],
    ["h", "Provisional items"],
    ["", "line of body text — or 'None.' if there are none"],
    ["h", "Exclusions"],
    ["", "Building superstructure, foundations, slabs, roofing, cladding, fit-out and in-dwelling services; professional fees; consent/development contributions; infrastructure growth charges."]
  ]
}
Rows tagged "h" in "basis" are section headings (bold), rows tagged "" are body text lines.`

function stripFences(text) {
  return text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
}

function slugFilename(name) {
  return (name || 'Schedule').replace(/[^\w\- ]+/g, '').trim().slice(0, 80)
}

function safePathPart(name) {
  return (name || 'file.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}

const router = Router()
router.use(requireAuth)

// Run history — visible to all staff, no role gating (per Tony: all staff, no permissions)
router.get('/runs', async (req, res) => {
  const { data, error } = await db
    .from('ProcessRun')
    .select('*')
    .eq('processId', PROCESS_ID)
    .order('createdAt', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

router.get('/runs/:id/document', async (req, res) => {
  const doc = await getSoqDoc(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No document stored for this run' })
  res.json(doc)
})

// Step 1: browser asks for a signed URL to upload each plan PDF straight to Supabase
// Storage, bypassing Vercel's ~4.5MB serverless request-body limit. Returns the storage
// path (used later by /run) and the signed URL to PUT the file to.
router.post('/upload-url', async (req, res) => {
  const filename = safePathPart(req.body?.filename)
  if (!/\.pdf$/i.test(filename)) return res.status(400).json({ error: 'Only PDF files are accepted' })
  try {
    const path = `${randomUUID()}/${filename}`
    const { signedUrl } = await createUploadUrl(path)
    res.json({ path, signedUrl })
  } catch (err) {
    console.error('SOQ upload-url failed:', err)
    res.status(500).json({ error: err.message || 'Could not start upload' })
  }
})

// Step 2: browser has uploaded the PDFs; it sends the storage paths here. We download
// them server-side, run the take-off, build the workbook, then delete the temp uploads.
router.post('/run', async (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter(p => typeof p === 'string' && p) : []
  if (!paths.length) return res.status(400).json({ error: 'Upload at least one PDF plan set' })

  const projectName = (req.body.projectName || '').trim()
  const notes = (req.body.notes || '').trim()
  const filenames = paths.map(p => p.split('/').pop())

  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: PROCESS_ID,
    processName: PROCESS_NAME,
    input: filenames.join(', ') + (projectName ? ` — ${projectName}` : ''),
    output: null,
    status: 'running',
    runBy: req.user?.email || 'unknown',
    createdAt: new Date().toISOString()
  })

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const buffers = await Promise.all(paths.map(downloadUpload))
    const emptyIdx = buffers.findIndex(b => !b || b.length === 0)
    if (emptyIdx !== -1) throw new Error(`"${filenames[emptyIdx]}" arrived empty — please re-upload it`)

    const userContent = [
      {
        type: 'text',
        text: [
          projectName ? `Project: ${projectName}` : null,
          notes ? `Additional instructions: ${notes}` : null,
          'Read the attached plan set(s) and produce the take-off JSON as specified.'
        ].filter(Boolean).join('\n')
      },
      ...buffers.map(b => ({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b.toString('base64') }
      }))
    ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `API error ${response.status}`)
    }

    const data = await response.json()
    const raw = data.content?.[0]?.text || ''
    const takeoff = JSON.parse(stripFences(raw))

    const { workbook, stats } = buildScheduleXlsx(takeoff)
    const buf = await workbook.xlsx.writeBuffer()

    const baseName = slugFilename(projectName || takeoff.project?.subtitle || takeoff.project?.title)
    const filename = `${baseName} - Materials & Quantities Schedule.xlsx`

    await saveSoqDoc(runId, filename, buf)

    const output = [
      `Schedule of Quantities ready — ${stats.sections} sections, ${stats.items} items.`,
      `Contingency ${Math.round(stats.contingencyPct * 100)}% · GST ${Math.round(stats.gstPct * 100)}%.`,
      'Download the .xlsx below, then fill in the yellow Rate ($) cells — Amount, subtotals and the Summary update automatically.',
      'Cross-check the firm quantities against the drawings before pricing; scaled and provisional items are flagged in the Basis & Assumptions tab.'
    ].join('\n')

    await db.from('ProcessRun').update({ output, status: 'completed' }).eq('id', runId)
    removeUploads(paths).catch(() => {}) // temp PDFs no longer needed
    res.json({ id: runId, output, document: buf.toString('base64'), filename, stats })

  } catch (err) {
    console.error('SOQ run failed:', err)
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    removeUploads(paths).catch(() => {})
    res.status(500).json({ error: err.message || 'Schedule of Quantities failed' })
  }
})

module.exports = router

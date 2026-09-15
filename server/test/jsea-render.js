// Renders a saved JSEA payload and checks the parts that are ours, not Claude's.
// Deliberately makes NO API call: the model's judgement isn't what regresses,
// the date handling and the render are.
//
//   node server/test/jsea-render.js

const assert = require('assert')
const JSZip = require('jszip')
const { todayNZ } = require('../src/lib/jseaPrompts')
const { buildJseaDocx, jseaFilename } = require('../src/lib/buildJseaDocx')

// A trimmed real response, kept with the wrong preparedDate Claude actually
// returned on 16 Sep 2026 — asked for "today's date" with no clock, it answered
// 12-06-2025 from its training data. That is the regression this guards.
const FIXTURE = {
  project: {
    name: '101 Bruce Rd, Glenfield', number: '', location: '101 Bruce Rd, Glenfield, Auckland',
    workType: 'Trenching and pipe laying for a new 300mm stormwater line',
    jseaNumber: 'TBA', reviewCycle: '3-mth', preparedBy: 'Tony Daunt',
    preparedDate: '12-06-2025'
  },
  supervisors: ['Dan'],
  personnelConsulted: [{ name: 'Dan', position: 'Site Supervisor' }],
  associatedDocuments: '',
  ppe: ['Hard hat', 'Hi-vis', 'Safety boots'],
  plantEquipment: [{ item: '20t excavator', sdsAvailable: false }],
  chemicals: [{ item: 'Diesel', sdsAvailable: true }],
  emergencyResponse: { musterPoint: 'Site entrance', firstAider: 'Dan' },
  approver: 'Dan',
  tasks: [{
    step: 1, task: 'Set up traffic management',
    hazards: [{
      hazard: 'Live traffic alongside the work area',
      uncontrolledRisk: 20,
      controls: ['TMP in place before any work starts', 'Cones and signage to the approved layout'],
      residualRisk: 6
    }]
  }]
}

function run(name, fn) {
  try { fn(); console.log(`  ok   ${name}`) }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1 }
}

console.log('jsea-render')

run('todayNZ is DD-MM-YYYY', () => {
  assert.match(todayNZ(), /^\d{2}-\d{2}-\d{4}$/)
})

run('todayNZ agrees with the NZ calendar date', () => {
  const [d, m, y] = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date()).split('/')
  assert.strictEqual(todayNZ(), `${d}-${m}-${y}`)
})

run('the filename carries the date it is given', () => {
  const j = JSON.parse(JSON.stringify(FIXTURE))
  j.project.preparedDate = todayNZ()
  assert.strictEqual(jseaFilename(j), `JSEA_101_Bruce_Rd_Glenfield_${todayNZ()}.docx`)
})

run('a TBA jsea number stays out of the filename', () => {
  assert.ok(!jseaFilename(FIXTURE).includes('TBA'))
})

;(async () => {
  const j = JSON.parse(JSON.stringify(FIXTURE))
  j.project.preparedDate = todayNZ()
  const buf = await buildJseaDocx(j)

  run('docx is a non-trivial file', () => assert.ok(buf.length > 20000, `only ${buf.length} bytes`))

  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')
  run('document body shows the supplied date', () => assert.ok(xml.includes(todayNZ())))
  run('no trace of the model-guessed date', () => assert.ok(!xml.includes('12-06-2025')))
  run('project name reaches the document', () => assert.ok(xml.includes('Bruce')))
  run('risk numbers reach the document', () => assert.ok(xml.includes('20') && xml.includes('6')))

  console.log(process.exitCode ? 'FAILED' : 'all passed')
})()

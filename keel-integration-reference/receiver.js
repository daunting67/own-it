// Reference implementation of the POST /staff endpoint described in
// KEEL-INTEGRATION.md (repo root) — shows the contract Own It's own
// keelSync.js already pushes to, end to end, against an in-memory store.
// Swap `staff` for a real database write to adapt this into Keel's own stack.
//
//   cd keel-integration-reference && npm install express && node receiver.js

const express = require('express')

const API_KEY = process.env.KEEL_REFERENCE_API_KEY || 'dev-only-key'
const staff = new Map() // externalId -> record, so a repeat push updates instead of duplicating

const app = express()
app.use(express.json())

app.use((req, res, next) => {
  const auth = req.headers.authorization || ''
  if (auth !== `Bearer ${API_KEY}`) return res.status(401).json({ error: 'Invalid or missing API key' })
  next()
})

app.post('/staff', (req, res) => {
  const { externalId, name } = req.body || {}
  if (!externalId || !name) return res.status(400).json({ error: 'externalId and name are required' })

  const isUpdate = staff.has(externalId)
  staff.set(externalId, { ...req.body, receivedAt: new Date().toISOString() })

  console.log(`[keel-reference] ${isUpdate ? 'updated' : 'created'} staff record for ${name} (${externalId})`)
  res.status(isUpdate ? 200 : 201).json({ ok: true, externalId })
})

app.get('/staff', (req, res) => res.json([...staff.values()]))

const port = process.env.PORT || 4000
app.listen(port, () => console.log(`Keel reference receiver listening on :${port}`))

const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const PROCESSES = require('../lib/processDefinitions')

const router = Router()
router.use(requireAuth)

// List available processes for this user's role
router.get('/', (req, res) => {
  const userRole = req.user?.role
  const available = PROCESSES
    .filter(p => !p.rolesAllowed || p.rolesAllowed.includes(userRole))
    .map(({ systemPrompt, ...p }) => p) // never expose the system prompt to the frontend
  res.json(available)
})

// Get run history (last 50 runs)
router.get('/runs', async (req, res) => {
  const { data, error } = await db
    .from('ProcessRun')
    .select('*')
    .order('createdAt', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// Run a process
router.post('/run/:id', async (req, res) => {
  const process = PROCESSES.find(p => p.id === req.params.id)
  if (!process) return res.status(404).json({ error: 'Process not found' })

  const userRole = req.user?.role
  if (process.rolesAllowed && !process.rolesAllowed.includes(userRole)) {
    return res.status(403).json({ error: 'You do not have permission to run this process' })
  }

  const { input } = req.body
  if (process.inputRequired && !input?.trim()) {
    return res.status(400).json({ error: 'Input is required for this process' })
  }

  // Create a run record immediately (so we have a record even if it fails)
  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: process.id,
    processName: process.name,
    input: input || '',
    output: null,
    status: 'running',
    runBy: req.user?.email || 'unknown',
    createdAt: new Date().toISOString()
  })

  // Call Claude API
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: process.systemPrompt,
        messages: [{ role: 'user', content: input || 'Run this process.' }]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error?.message || `API error ${response.status}`)
    }

    const data = await response.json()
    const output = data.content?.[0]?.text || ''

    await db.from('ProcessRun').update({ output, status: 'completed' }).eq('id', runId)
    res.json({ id: runId, output, status: 'completed' })

  } catch (err) {
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    res.status(500).json({ error: 'Process failed', details: err.message })
  }
})

module.exports = router

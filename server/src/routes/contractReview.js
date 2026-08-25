const { Router } = require('express')
const { randomUUID } = require('crypto')
const { requireAuth } = require('../middleware/auth')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/contractReviewUploads')
const { saveReview, getReview, listReviews } = require('../lib/contractReviewStore')
const {
  isReadable,
  unreadableReason,
  digestDocument,
  buildReview
} = require('../lib/contractReviewPrompts')

function safePathPart(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}

const router = Router()
router.use(requireAuth)

// Every review, newest first.
router.get('/', async (req, res) => {
  try {
    const reviews = await listReviews()
    res.json({ reviews })
  } catch (err) {
    console.error('Contract review list failed:', err)
    res.status(500).json({ error: err.message || 'Could not load contract reviews' })
  }
})

router.get('/:id', async (req, res) => {
  const review = await getReview(req.params.id)
  if (!review) return res.status(404).json({ error: 'Review not found' })
  res.json(review)
})

// Step 1: browser asks for a signed URL per document and uploads straight to
// Supabase Storage, bypassing Vercel's ~4.5MB serverless request-body limit —
// same pattern as /api/tenders/upload-url.
router.post('/upload-url', async (req, res) => {
  const filename = safePathPart(req.body?.filename)
  if (!isReadable(filename)) {
    return res.status(400).json({ error: unreadableReason(filename), filename })
  }
  try {
    const path = `${randomUUID()}/${filename}`
    const { signedUrl } = await createUploadUrl(path)
    res.json({ path, signedUrl })
  } catch (err) {
    console.error('Contract review upload-url failed:', err)
    res.status(500).json({ error: err.message || 'Could not start upload' })
  }
})

// Step 2: one call per document, so each request stays well under the
// function timeout even on a long subcontract pack. A document that cannot
// be read comes back marked, never dropped.
router.post('/read', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!path) return res.status(400).json({ error: 'No document path supplied' })
  const filename = path.split('/').pop()

  try {
    const buffer = await downloadUpload(path)
    const digest = await digestDocument({ filename, buffer })
    res.json({ ...digest, path })
  } catch (err) {
    console.error(`Contract review read failed for ${filename}:`, err)
    res.json({ filename, path, read: false, reason: err.message || 'Could not be read' })
  }
})

// Step 3: combine the digests into the full adversarial review and file it.
router.post('/review', async (req, res) => {
  const projectName = (req.body?.projectName || '').trim()
  const contractorName = (req.body?.contractorName || '').trim()
  const subcontractNumber = (req.body?.subcontractNumber || '').trim()
  const scope = (req.body?.scope || '').trim()
  const price = (req.body?.price || '').trim()
  const digests = Array.isArray(req.body?.digests) ? req.body.digests : []

  if (!projectName) return res.status(400).json({ error: 'Give the project a name' })
  if (!digests.length) return res.status(400).json({ error: 'Upload at least one document' })

  try {
    const review = await buildReview({ projectName, contractorName, subcontractNumber, scope, price, digests })

    const record = {
      id: randomUUID(),
      projectName,
      contractorName,
      subcontractNumber,
      scope,
      price,
      documents: digests.map(d => ({
        filename: d.filename,
        read: !!d.read,
        reason: d.reason || null,
        documentType: d.documentType || null,
        scheduleLabel: d.scheduleLabel || null,
        pages: d.pages || null
      })),
      review,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.email || 'unknown'
    }

    await saveReview(record)
    removeUploads(digests.map(d => d.path).filter(Boolean)).catch(() => {})

    res.json(record)
  } catch (err) {
    console.error('Contract review build failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the review' })
  }
})

module.exports = router

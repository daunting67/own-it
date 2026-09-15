const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { buildJseaData } = require('../lib/jseaPrompts')
const { buildJseaDocx, jseaFilename } = require('../lib/buildJseaDocx')

const router = Router()
router.use(requireAuth)

// One-shot generate-and-download: the browser posts the job details (a mix
// of explicit fields and a freeform description of the work), Claude turns
// that into the full structured JSEA, and the .docx comes straight back —
// no history/persistence, per the "just ask, get a doc back" spec.
router.post('/generate', async (req, res) => {
  const body = req.body || {}
  if (!body.projectName && !body.description) {
    return res.status(400).json({ error: 'Give at least a project name or a description of the job' })
  }

  try {
    const jsea = await buildJseaData(body)
    const buf = await buildJseaDocx(jsea)
    res.json({ filename: jseaFilename(jsea), document: buf.toString('base64') })
  } catch (err) {
    console.error('JSEA generation failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the JSEA' })
  }
})

module.exports = router

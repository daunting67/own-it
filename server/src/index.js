const express = require('express')
const cors = require('cors')
const authRouter = require('./routes/auth')
const staffRouter = require('./routes/staff')
const sitesRouter = require('./routes/sites')
const suppliersRouter = require('./routes/suppliers')
const invoicesRouter = require('./routes/invoices')
const processesRouter = require('./routes/processes')
const otterRouter = require('./routes/otter')
const teammateRouter = require('./routes/teammate')
const soqRouter = require('./routes/soq')
const costControlRouter = require('./routes/costControl')
const qbtRouter = require('./routes/qbt')
const incidentsRouter = require('./routes/incidents')
const trainingRouter = require('./routes/training')
const plantRouter = require('./routes/plant')
const plantWebhookRouter = require('./routes/plantWebhook')
const operationsRouter = require('./routes/operations')
const djrWebhookRouter = require('./routes/djrWebhook')
const cronRouter = require('./routes/cron')
const prestartRouter = require('./routes/prestart')
const tendersRouter = require('./routes/tenders')

const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:4173']

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true)
    else cb(new Error('Not allowed by CORS'))
  },
  credentials: true
}))
// 5mb, not the 100kb default: a FastField CSV export of a day's plant checks
// is posted as JSON to /api/plant/import. Vercel rejects bodies over ~4.5mb at
// the edge anyway, and the route caps the text itself.
app.use(express.json({ limit: '5mb' }))

app.use('/api/auth', authRouter)
app.use('/api/staff', staffRouter)
app.use('/api/sites', sitesRouter)
app.use('/api/suppliers', suppliersRouter)
app.use('/api/invoices', invoicesRouter)
app.use('/api/processes', processesRouter)
app.use('/api/otter', otterRouter)
app.use('/api/teammate', teammateRouter)
app.use('/api/soq', soqRouter)
app.use('/api/cost-control', costControlRouter)
app.use('/api/qbt', qbtRouter)
app.use('/api/incidents', incidentsRouter)
app.use('/api/training', trainingRouter)
app.use('/api/plant', plantRouter)
app.use('/api/plant-webhook', plantWebhookRouter)
app.use('/api/operations', operationsRouter)
app.use('/api/djr-webhook', djrWebhookRouter)
app.use('/api/cron', cronRouter)
app.use('/api/prestart', prestartRouter)
app.use('/api/tenders', tendersRouter)

app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '2026-08-11-tender-plain-debrief-27' }))

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Own It server running on port ${PORT}`))
}

module.exports = app

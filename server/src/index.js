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
app.use(express.json())

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

app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '2026-07-20-teammate-share-live' }))

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Own It server running on port ${PORT}`))
}

module.exports = app

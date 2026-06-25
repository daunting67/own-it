import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'
import staffRouter from './routes/staff.js'
import sitesRouter from './routes/sites.js'
import suppliersRouter from './routes/suppliers.js'
import invoicesRouter from './routes/invoices.js'

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

app.get('/api/health', (_, res) => res.json({ status: 'ok' }))

// Local dev
if (process.env.NODE_ENV !== 'production' || process.env.USE_LOCAL_SERVER) {
  app.listen(PORT, () => console.log(`Own It server running on port ${PORT}`))
}

export default app

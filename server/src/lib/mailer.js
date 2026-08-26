const nodemailer = require('nodemailer')

// Generic SMTP relay — works with a Microsoft 365 / Google Workspace mailbox
// (app password), a dedicated mailbox, or a transactional email provider's
// SMTP interface. Configured entirely via env vars so no code changes are
// needed once someone sets them:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
//   SMTP_SECURE (optional, "true"/"false" — default: true only on port 465)
//   SMTP_FROM (optional — defaults to SMTP_USER)
let transporter = null

function getTransporter() {
  if (transporter) return transporter
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('Email is not set up yet — SMTP_HOST / SMTP_USER / SMTP_PASS are not configured on the server.')
  }
  const port = Number(process.env.SMTP_PORT) || 587
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  })
  return transporter
}

async function sendDocx({ to, subject, text, filename, buffer }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  await getTransporter().sendMail({
    from,
    to,
    subject,
    text,
    attachments: [{ filename, content: buffer }]
  })
}

module.exports = { sendDocx }

// Uploads the fitted headshots from server/src/assets/headshots/ (built by
// fit-safety-alert-headshots.py) to Supabase Storage, bucket "people-config"
// under "headshots/{filename}" — this is what buildSafetyAlertDocx.js's
// findHeadshotAsset() actually reads at build time. These files are NOT
// committed to git (see .gitignore) since they're real people's photos, so
// this upload step is how a new/updated headshot actually reaches the
// deployed app once the fitting script has run locally.
//
// Requires SUPABASE_URL / SUPABASE_SERVICE_KEY in server/.env.
// Run from the server/ directory: node --env-file=.env scripts/upload-safety-alert-headshots.js
const fs = require('fs')
const path = require('path')
const db = require('../src/lib/supabase')

const DIR = path.join(__dirname, '..', 'src', 'assets', 'headshots')
const BUCKET = 'people-config'
const PREFIX = 'headshots'

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`No local ${DIR} — run fit-safety-alert-headshots.py first.`)
    process.exit(1)
  }
  const files = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png)$/i.test(f))
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(DIR, f))
    const { error } = await db.storage.from(BUCKET).upload(`${PREFIX}/${f}`, bytes, {
      contentType: f.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      upsert: true,
    })
    console.log(f, error ? `FAILED: ${error.message}` : 'OK')
  }
}

main()

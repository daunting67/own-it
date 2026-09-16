const db = require('./supabase')

// One JSON record per credit application review job, at {id}.json — same
// no-schema-migration pattern as contract-review-records.
//
// WHY A JOB AT ALL. Every step of this review is a single Claude call, and measured
// against a real pack (Franklin Smith, 16 Sep 2026) those calls take 85-240 SECONDS
// each: reading a dense page of terms is slow, and deliberately so — it is set to think
// hard, because a missed guarantee clause is the failure that matters. No browser will
// hold a request open that long. Safari gives up at around 60s with "Load failed", which
// is exactly what a completed, correct, 138-second server-side read looked like from the
// outside: a hung page.
//
// So the browser no longer waits on the work. It starts a step, the server writes the
// result here when it finishes, and the browser polls this record every few seconds. Each
// HTTP request is short; the model gets as long as it needs. A dropped connection,
// a closed laptop or a reload no longer destroys a run in progress — the job survives,
// and the page picks it back up.
const BUCKET = 'credit-review-jobs'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

const MISSING_BUCKET = /bucket not found|resource does not exist/i

async function saveJob(job) {
  const body = Buffer.from(JSON.stringify(job, null, 2))
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(`${job.id}.json`, body, opts)
  if (error && MISSING_BUCKET.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(`${job.id}.json`, body, opts))
  }
  if (error) throw error
  return job
}

async function getJob(id) {
  const { data, error } = await db.storage.from(BUCKET).download(`${id}.json`)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text())
  } catch {
    return null
  }
}

// Read-modify-write. Steps run one at a time per job, so there is no concurrent writer to
// race with — the browser starts the next step only once the last one is recorded.
async function patchJob(id, patch) {
  const job = await getJob(id)
  if (!job) return null
  return saveJob({ ...job, ...patch, updatedAt: new Date().toISOString() })
}

module.exports = { saveJob, getJob, patchJob }

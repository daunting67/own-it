const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { probeSubmissionEndpoints, rawGet, missingConfig, getSessionToken } = require('../lib/fastfield')
const { getChecksForDay, getKnownMachines, mergeChecks } = require('../lib/plantChecks')
const { getPlantRegister, clearCache: clearRegisterCache } = require('../lib/plantRegister')
const { probeSubmissionListing, findPlantForms, fetchSubmissions, getPlantFormIds, envFormId } = require('../lib/fastfieldSubmissions')
const { nzDayRange } = require('../lib/nzDay')
const db = require('../lib/supabase')

const router = Router()
router.use(requireAuth)

// Machine names come from two places (the FastField lookup list and the
// submissions themselves) so compare them loosely — a stray double space or a
// capital letter shouldn't make one machine look like two.
const normalise = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

// Mobile Plant Checks for today AND yesterday (NZ days), captured via the
// FastField webhook — see routes/plantWebhook.js — so the two can be compared
// side by side. Each day reports every machine on the register that did NOT
// check in, which is the question Tony actually needs answered each morning.
router.get('/today', async (req, res) => {
  try {
    const deadline = Date.now() + 7000
    const [today, yesterday, seenMachines, register, formIds] = await Promise.all([
      getChecksForDay(0),
      getChecksForDay(-1),
      getKnownMachines(),
      getPlantRegister({ deadline }),
      getPlantFormIds().catch(() => []),
    ])

    // Pull the submitted checklists straight from FastField as well, so a
    // check appears whether or not FastField pushed it to our webhook. The
    // webhook has only ever delivered a couple of submissions; this is the
    // path that actually sees every operator's check.
    const [pulledToday, pulledYesterday] = await Promise.all([
      fetchSubmissions({ formIds, startUtc: nzDayRange(0).startUtc, endUtc: nzDayRange(0).endUtc, deadline }),
      fetchSubmissions({ formIds, startUtc: nzDayRange(-1).startUtc, endUtc: nzDayRange(-1).endUtc, deadline }),
    ])
    today.checks = mergeChecks(today.checks, pulledToday.checks)
    yesterday.checks = mergeChecks(yesterday.checks, pulledYesterday.checks)

    // The register is the authority on what should be checked; machines seen
    // in submissions but absent from it are still listed (plant retired from
    // the list, or a name that doesn't match) so nothing goes unaccounted for.
    const knownMachines = [...register.machines]
    const registered = new Set(register.machines.map(normalise))
    const extraSeen = seenMachines.filter(m => m && !registered.has(normalise(m)))
    knownMachines.push(...extraSeen)

    const summarise = ({ day, checks }) => {
      const checkedMachines = [...new Set(checks.map(c => c.machine).filter(Boolean))]
      const checked = new Set(checkedMachines.map(normalise))
      return {
        day,
        checks,
        checkedMachines,
        missing: knownMachines.filter(m => !checked.has(normalise(m))),
        // Checks whose machine isn't on the register — worth surfacing rather
        // than silently counting them as compliant.
        unregistered: checkedMachines.filter(m => !registered.has(normalise(m))),
      }
    }

    const todaySummary = summarise(today)
    const yesterdaySummary = summarise(yesterday)

    res.json({
      today: todaySummary,
      yesterday: yesterdaySummary,
      knownMachines,
      knownMachineCount: knownMachines.length,
      registerSource: register.source || 'submissions',
      registerCount: register.machines.length,
      registerError: register.error || null,
      // How the checks were obtained, so the page can be honest about it.
      feed: (() => {
        const error = pulledToday.error || pulledYesterday.error || null
        const allErrors = `${error || ''} ${register.error || ''}`
        return {
          formIds,
          endpoint: pulledToday.endpoint || pulledYesterday.endpoint || null,
          pulledToday: pulledToday.checks.length,
          pulledYesterday: pulledYesterday.checks.length,
          truncated: !!(pulledToday.truncated || pulledYesterday.truncated),
          error,
          // Not an error state: checks are expected to arrive by webhook.
          pullDisabled: !!(pulledToday.disabled && pulledYesterday.disabled),
          // Nothing FastField-side can work without these, and the symptom
          // (empty dashboard, no plant list) looks identical to a code bug.
          // Unset credentials and rejected credentials need the same action
          // from Tony (fix them in Vercel), so both raise the same flag.
          needsCredentials: /credentials not configured|authentication failed/i.test(allErrors)
            || missingConfig().length > 0,
          missingEnv: missingConfig(),
        }
      })(),
      generatedAt: new Date().toISOString(),
      // Kept for any browser still running the previous build.
      checks: todaySummary.checks,
      missing: todaySummary.missing,
    })
  } catch (err) {
    console.error('Plant checks fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not load plant checks' })
  }
})

// The plant register itself (FastField lookup list), so the list the
// dashboard measures against can be eyeballed. ?refresh=1 bypasses the
// 15-minute cache after plant is added or retired in FastField.
router.get('/register', async (req, res) => {
  try {
    if (req.query.refresh) clearRegisterCache()
    const register = await getPlantRegister()
    res.json({
      source: register.source || 'unavailable',
      path: register.path || null,
      count: register.machines.length,
      machines: register.machines,
      error: register.error || null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin-only, and deliberately surfaced in the UI (Plant & Equipment →
// Diagnostics) rather than being curl-only: everything needed to work out why
// checks aren't landing, gathered in one call.
//   1. what the lookup-list probe actually returns, path by path
//   2. the last few submissions the webhook received, with the field names
//      FastField sent — an all-empty row means the names don't match what
//      parseSubmission() looks for
//   3. whether the form even has an HTTP delivery action pointing at us
//   4. which forms are actually named "Operator Checklist - Mobile Plant"
//   5. whether submitted checklists can be PULLED instead of pushed
// The FastField probes share one session and run concurrently under a time
// budget, since a serverless request gets ~10 seconds.
router.get('/diagnostics', requireAdmin, async (req, res) => {
  const out = { generatedAt: new Date().toISOString() }
  const deadline = Date.now() + 7000

  // 0. Does the FastField sign-in itself work? One line that separates "wrong
  //    credentials" from "wrong endpoint" — every other section is ambiguous
  //    about it, since a 401 from a probe looks much like a 404.
  out.auth = { missingEnv: missingConfig() }
  if (out.auth.missingEnv.length === 0) {
    try {
      await getSessionToken()
      out.auth.ok = true
    } catch (err) {
      out.auth.ok = false
      out.auth.error = String(err.message).slice(0, 300)
    }
  } else {
    out.auth.ok = false
    out.auth.error = `not configured: ${out.auth.missingEnv.join(', ')}`
  }

  const formId = req.query.formId || envFormId()
  out.formId = formId || null

  clearRegisterCache()
  const [register, plantForms, form] = await Promise.all([
    getPlantRegister({ deadline }).catch(err => ({ machines: [], source: null, error: err.message })),
    findPlantForms(req.query.match || undefined).catch(err => ({ forms: [], error: String(err.message).slice(0, 300) })),
    formId
      ? rawGet(`/forms/${formId}`).catch(err => ({ __error: String(err.message).slice(0, 300) }))
      : Promise.resolve(null),
  ])

  out.register = {
    source: register.source || 'unavailable',
    path: register.path || null,
    count: register.machines.length,
    machines: register.machines.slice(0, 200),
    error: register.error || null,
  }
  out.plantForms = plantForms

  if (form) {
    if (form.__error) {
      out.form = { error: form.__error }
    } else {
      const json = JSON.stringify(form)
      out.form = {
        name: form?.name || form?.data?.name || null,
        topLevelKeys: Object.keys(form || {}),
        // Does the form definition mention our webhook at all?
        mentionsOwnItWebhook: /own-it|plant-webhook/i.test(json),
        deliveryMentions: (json.match(/"[^"]*(deliver|webhook|integration|http)[^"]*"\s*:/gi) || []).slice(0, 40),
      }
    }
  }

  try {
    const { data, error } = await db
      .from('PlantCheck')
      .select('id, receivedAt, machine, operator, rawPayload')
      .order('receivedAt', { ascending: false })
      .limit(5)
    if (error) throw new Error(error.message)
    out.recentSubmissions = (data || []).map(row => {
      const raw = row.rawPayload || {}
      const nested = raw.values && typeof raw.values === 'object' ? raw.values : null
      return {
        id: row.id,
        receivedAt: row.receivedAt,
        machine: row.machine,
        operator: row.operator,
        topLevelKeys: Object.keys(raw),
        valueKeys: nested ? Object.keys(nested) : null,
        // Truncated so a photo-heavy payload can't blow the response up.
        rawPreview: JSON.stringify(raw).slice(0, 4000),
      }
    })
    out.totalStoredNote = 'Newest 5 submissions ever received by the webhook'
  } catch (err) {
    out.recentSubmissions = { error: err.message }
  }

  // Can we PULL submitted checklists instead of waiting to be pushed? Sweeps
  // the plausible listing endpoints; a 400 with a validation message is a
  // better lead than a 404.
  try {
    const probeFormId = out.plantForms?.forms?.[0]?.id || formId
    // On demand only: /today no longer sweeps, this is where it still happens.
    const results = await probeSubmissionListing(probeFormId, { deadline: Date.now() + 6000 })
    // Counts by status make the pattern obvious at a glance: all 404 means
    // wrong paths, all 401 means the session isn't accepted on these routes.
    const statusSummary = results.reduce((acc, r) => {
      const key = r.status ?? (r.error ? 'error' : 'none')
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    out.submissionProbe = {
      formId: probeFormId || null,
      statusSummary,
      results,
    }
  } catch (err) {
    out.submissionProbe = { error: String(err.message).slice(0, 300) }
  }

  res.json(out)
})

// Admin-only diagnostic: every check captured in the last N hours (default 48)
// with no day-windowing at all, so we can tell "the webhook never received it"
// apart from "it was filtered out of the day view".
router.get('/_recent', requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 48, 24 * 14)
    const since = new Date(Date.now() - hours * 3600000).toISOString()
    const { data, error } = await db
      .from('PlantCheck')
      .select('id, receivedAt, checkDate, machine, site, operator')
      .gte('receivedAt', since)
      .order('receivedAt', { ascending: false })
    if (error) throw new Error(error.message)
    res.json({ since, hours, count: (data || []).length, rows: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// TEMPORARY, admin-only: probes candidate FastField v3 endpoints for listing
// submissions so we can find the one that actually works, then remove this
// and build the real /today route on top of it.
router.get('/_probe', requireAdmin, async (req, res) => {
  const formId = req.query.formId || envFormId()
  if (!formId) return res.status(400).json({ error: 'formId required (query param, or FASTFIELD_PLANT_FORM_ID/FASTFIELD_FORM_ID env var)' })
  try {
    const results = await probeSubmissionEndpoints(formId)
    res.json({ formId, results })
  } catch (err) {
    console.error('FastField probe failed:', err)
    res.status(500).json({ error: err.message || 'FastField probe failed' })
  }
})

// TEMPORARY, admin-only: dumps the full raw form definition (fields, layout,
// delivery/webhook config if present) so we can inspect it ourselves.
router.get('/_form-raw', requireAdmin, async (req, res) => {
  const formId = req.query.formId || envFormId()
  if (!formId) return res.status(400).json({ error: 'formId required' })
  try {
    const form = await rawGet(`/forms/${formId}`)
    res.json(form)
  } catch (err) {
    console.error('FastField form fetch failed:', err)
    res.status(500).json({ error: err.message || 'FastField form fetch failed' })
  }
})

// TEMPORARY, admin-only: probes candidate endpoints for reading a lookup
// list's items (the "plant" field is a LookupListPicker referencing a
// FastField Lookup List — that list may be the self-maintained machine
// registry we need for the Plant & Equipment dashboard).
router.get('/_lookup-probe', requireAdmin, async (req, res) => {
  const lookupListId = req.query.lookupListId || 'lookup_eb389c0932544272981996bc1042d82a'
  try {
    const candidates = [
      // List-all first: if one of these works we can find the plant list by
      // name instead of relying on a hardcoded id.
      '/lookupList',
      '/lookupLists',
      '/lookuplist',
      '/lookuplists',
      '/lookupList/list',
      `/lookupList/${lookupListId}`,
      `/lookupLists/${lookupListId}`,
      `/lookupList/${lookupListId}/items`,
      `/lookupLists/${lookupListId}/items`,
      `/lookupList/${lookupListId}/rows`,
      `/lookupList/${lookupListId}/data`,
      `/lookuplist/${lookupListId}`,
      `/lookuplist/${lookupListId}/values`,
    ]
    const results = []
    for (const path of candidates) {
      try {
        const data = await rawGet(path)
        results.push({ path, ok: true, preview: JSON.stringify(data).slice(0, 800) })
      } catch (err) {
        results.push({ path, ok: false, error: err.message.slice(0, 200) })
      }
    }
    res.json({ lookupListId, results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// TEMPORARY, admin-only: lists all FastField forms (paginating /forms),
// optionally filtered by a case-insensitive name substring, so we can find
// form IDs without guessing.
router.get('/_forms-list', requireAdmin, async (req, res) => {
  try {
    const match = (req.query.match || '').toLowerCase()
    const all = await rawGet('/forms')
    const filtered = match ? all.filter(f => (f.name || '').toLowerCase().includes(match)) : all
    res.json(filtered.map(f => ({ id: f.id, name: f.name, updatedAt: f.updatedAt })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

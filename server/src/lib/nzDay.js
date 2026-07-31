// New Zealand day boundaries.
//
// Vercel's serverless functions run in UTC, so `new Date().toISOString()`
// gives the UTC date, not the NZ one. NZ is UTC+12 (+13 in daylight saving),
// which means for the whole first half of every NZ working day the UTC date
// is still YESTERDAY — so a "today" window built from the UTC date silently
// mixes in yesterday's afternoon submissions, and then at NZ midday it flips
// and drops every check submitted that morning (which is exactly when plant
// pre-start checks happen). Everything here works off Pacific/Auckland wall
// time instead, so a "day" is the day the crew actually worked.

const NZ = 'Pacific/Auckland'

// How far ahead of UTC the given zone is, at the given instant, in minutes.
function tzOffsetMinutes(date, timeZone = NZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
    .formatToParts(date)
    .filter(p => p.type !== 'literal')
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {})

  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  return (asIfUtc - date.getTime()) / 60000
}

// The UTC instant of midnight-at-the-start-of `dayStr` (YYYY-MM-DD) in NZ.
// Two passes so daylight-saving transition days resolve correctly.
function nzMidnightUtc(dayStr) {
  const naive = Date.parse(`${dayStr}T00:00:00Z`)
  let offset = tzOffsetMinutes(new Date(naive))
  offset = tzOffsetMinutes(new Date(naive - offset * 60000))
  return new Date(naive - offset * 60000)
}

// Today's date in NZ as YYYY-MM-DD, optionally shifted by whole days.
function nzDateString(offsetDays = 0) {
  // en-CA formats as YYYY-MM-DD.
  const todayNz = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  if (!offsetDays) return todayNz
  const shifted = new Date(Date.parse(`${todayNz}T00:00:00Z`) + offsetDays * 86400000)
  return shifted.toISOString().slice(0, 10)
}

// The NZ calendar date (YYYY-MM-DD) an instant falls on. A check received at
// 06:42 NZ belongs to that NZ day, not to the UTC day it happens to land in.
function nzDateOf(instant) {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

// Whole days between two YYYY-MM-DD day strings (later minus earlier).
function daysBetween(fromDay, toDay) {
  if (!fromDay || !toDay) return null
  const a = Date.parse(`${fromDay}T00:00:00Z`)
  const b = Date.parse(`${toDay}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

// Half-open [start, end) UTC range covering one NZ calendar day.
// offsetDays: 0 = today in NZ, -1 = yesterday, etc.
function nzDayRange(offsetDays = 0) {
  const day = nzDateString(offsetDays)
  const nextDay = nzDateString(offsetDays + 1)
  return {
    day,
    startUtc: nzMidnightUtc(day).toISOString(),
    endUtc: nzMidnightUtc(nextDay).toISOString(),
  }
}

module.exports = { NZ, nzDayRange, nzDateString, nzDateOf, daysBetween, nzMidnightUtc, tzOffsetMinutes }

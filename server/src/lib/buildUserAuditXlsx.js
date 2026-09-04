// P&I (North) Ltd cross-system user audit workbook. Takes buildUserAudit()'s
// output and renders it in the same house style as buildFuelReconXlsx.js /
// buildScheduleXlsx.js (same palette, banded rows, logo above a navy title band).
//
// Tab order is deliberate — the two worklists come first because they're the
// only tabs anyone acts on. The raw per-system lists sit at the back as the
// evidence behind them, which is also what the original audit brief asked for
// (one tab per system plus a summary).
const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')

const FONT = 'Arial'
const NAVY = '1F3864'
const MID = '2E74B5'
const LT = 'D9E1F2'
const ALT = 'F2F6FB'
const WHITE = 'FFFFFF'
const RED = 'C00000'
const GREEN = '2E7D32'
const AMBER = 'B26B00'

const argb = hex => `FF${hex}`
const thinSide = { style: 'thin', color: { argb: argb('AAAAAA') } }
const allBorder = { top: thinSide, bottom: thinSide, left: thinSide, right: thinSide }

function fill(hex) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } } }
function font(size, bold = false, color = '000000') {
  return { name: FONT, size, bold, color: { argb: argb(color) } }
}

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo-soq.png')
const LOGO_NATIVE_W = 1280
const LOGO_NATIVE_H = 388
const LOGO_ROWS = 3
const TITLE_ROW = LOGO_ROWS + 1

function addLogo(workbook) {
  // A missing logo must not cost us the whole export — the audit is the point,
  // the branding isn't.
  try {
    if (!fs.existsSync(LOGO_PATH)) return null
    return workbook.addImage({ buffer: fs.readFileSync(LOGO_PATH), extension: 'png' })
  } catch {
    return null
  }
}

function placeLogo(ws, imageId, h = 64) {
  if (imageId == null) return
  const w = Math.round((h * LOGO_NATIVE_W) / LOGO_NATIVE_H)
  ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: w, height: h } })
}

// Title band + optional subtitle, returning the row the caller should start at.
function titleBand(ws, imageId, title, subtitle, lastCol) {
  for (let i = 1; i <= LOGO_ROWS; i++) ws.getRow(i).height = 22
  placeLogo(ws, imageId)

  ws.mergeCells(TITLE_ROW, 1, TITLE_ROW, lastCol)
  const t = ws.getCell(TITLE_ROW, 1)
  t.value = title
  t.font = font(14, true, WHITE)
  t.fill = fill(NAVY)
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(TITLE_ROW).height = 26

  let row = TITLE_ROW + 1
  if (subtitle) {
    ws.mergeCells(row, 1, row, lastCol)
    const s = ws.getCell(row, 1)
    s.value = subtitle
    s.font = font(9, false, '555555')
    s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    ws.getRow(row).height = 18
    row += 1
  }
  return row + 1
}

function headerRow(ws, rowIdx, headers) {
  const r = ws.getRow(rowIdx)
  headers.forEach((h, i) => {
    const c = r.getCell(i + 1)
    c.value = h
    c.font = font(10, true, WHITE)
    c.fill = fill(MID)
    c.border = allBorder
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  })
  r.height = 20
  return rowIdx + 1
}

function dataRow(ws, rowIdx, values, { banded = true, colorMap = {} } = {}) {
  const r = ws.getRow(rowIdx)
  values.forEach((v, i) => {
    const c = r.getCell(i + 1)
    c.value = v == null || v === '' ? '—' : v
    const color = colorMap[i]
    c.font = font(10, !!color, color || '000000')
    c.border = allBorder
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    if (banded && rowIdx % 2 === 0) c.fill = fill(ALT)
  })
  return rowIdx + 1
}

function setWidths(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
}

// null means "that system couldn't be read", which must not render as "No" —
// see the readable flags in userAudit.js.
const yesNo = b => (b === null || b === undefined ? 'Not known' : b ? 'Yes' : 'No')

function buildUserAuditXlsx(audit) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Own It — Pipeline & Infrastructure (North) Ltd'
  wb.created = new Date()
  const imageId = addLogo(wb)

  const generated = new Date(audit.generatedAt || Date.now())
    .toLocaleString('en-NZ', { dateStyle: 'long', timeStyle: 'short' })
  const stamp = `Generated ${generated} · QuickBooks Time is the reference list — everything is measured against it`

  // ---------------------------------------------------------------- Summary
  {
    const ws = wb.addWorksheet('Summary')
    setWidths(ws, [42, 16, 60])
    let row = titleBand(ws, imageId, 'System Access Audit — Summary', stamp, 3)

    row = headerRow(ws, row, ['Measure', 'Count', 'What it means'])
    const c = audit.counts || {}
    const rows = [
      ['Staff in QuickBooks Time (active)', c.qbtActive, 'The reference list — who actually works here'],
      ['Deactivated QuickBooks Time accounts', c.qbtInactive, 'People who have left, kept for payroll history'],
      ['Users listed in Teammate', c.teammate, 'Employee records in Teammate'],
      ['Users listed in FastField', c.fastfield, audit.fastfieldEndpoint ? `Read from ${audit.fastfieldEndpoint}` : 'Could not be read automatically'],
      ['Active staff missing from a system', (audit.missingSomewhere || []).length, 'Needs adding — see "Missing — to add"'],
      ['Ex-staff still holding accounts', (audit.staleAccounts || []).length, 'Needs removing — see "To remove"'],
      ['Accounts matching nobody in QBT', (audit.notInQbt || []).length, 'Unknown or stale accounts — see "To remove"'],
      ['Duplicate names within a system', (audit.duplicates || []).length, 'Possible double-ups worth checking'],
    ]
    for (const r of rows) row = dataRow(ws, row, r)

    if (Object.keys(audit.errors || {}).length) {
      row += 1
      ws.mergeCells(row, 1, row, 3)
      const e = ws.getCell(row, 1)
      e.value = 'Systems that could not be read'
      e.font = font(11, true, RED)
      row += 1
      row = headerRow(ws, row, ['System', '', 'Problem'])
      for (const [sys, msg] of Object.entries(audit.errors)) {
        row = dataRow(ws, row, [sys, '', msg], { colorMap: { 2: RED } })
      }
    }
  }

  // ---------------------------------------------------------------- To add
  {
    const ws = wb.addWorksheet('Missing — to add')
    setWidths(ws, [28, 34, 22, 30])
    let row = titleBand(ws, imageId, 'Active staff missing from a system', 'These people are working here but have no account in the system(s) listed — they need adding.', 4)
    row = headerRow(ws, row, ['Name', 'Email (from QBT)', 'Missing from', 'Position (Teammate)'])
    const list = audit.missingSomewhere || []
    if (!list.length) {
      row = dataRow(ws, row, ['Nobody — every active staff member is set up in all systems', '', '', ''], { colorMap: { 0: GREEN } })
    } else {
      for (const r of list) {
        row = dataRow(ws, row, [r.name, r.email, r.missingFrom.join(', '), r.teammatePosition], { colorMap: { 2: AMBER } })
      }
    }
  }

  // ---------------------------------------------------------------- To remove
  {
    const ws = wb.addWorksheet('To remove')
    setWidths(ws, [28, 34, 18, 16, 34])
    let row = titleBand(ws, imageId, 'Accounts to review for removal', 'Ex-staff who still hold accounts, plus accounts that match nobody in QuickBooks Time. Check the "possible match" column before removing — a name spelled differently is not the same as a stale account.', 5)

    row = headerRow(ws, row, ['Name', 'Email', 'System', 'Status', 'Possible match in QBT'])

    for (const r of (audit.staleAccounts || [])) {
      row = dataRow(ws, row, [r.name, r.email, r.staleAccountsIn.join(', '), 'Left (inactive in QBT)', ''], { colorMap: { 3: RED } })
    }
    for (const r of (audit.notInQbt || [])) {
      row = dataRow(ws, row, [
        r.name,
        r.email,
        r.system,
        r.active === null ? 'Not known' : r.active ? 'Active' : 'Inactive',
        r.possibleQbtMatches?.length ? r.possibleQbtMatches.join(', ') : '',
      ], { colorMap: { 4: r.possibleQbtMatches?.length ? AMBER : undefined } })
    }

    if (!(audit.staleAccounts || []).length && !(audit.notInQbt || []).length) {
      row = dataRow(ws, row, ['Nothing to remove — every account matches a current staff member', '', '', '', ''], { colorMap: { 0: GREEN } })
    }
  }

  // ---------------------------------------------------------------- Matrix
  {
    const ws = wb.addWorksheet('Staff matrix')
    setWidths(ws, [28, 34, 14, 14, 14, 26])
    let row = titleBand(ws, imageId, 'Every person in QuickBooks Time, and where they are set up', stamp, 6)
    row = headerRow(ws, row, ['Name', 'Email', 'QBT status', 'Teammate', 'FastField', 'Position (Teammate)'])
    for (const r of (audit.roster || [])) {
      row = dataRow(ws, row, [
        r.name,
        r.email,
        r.qbtActive ? 'Active' : 'Inactive',
        yesNo(r.inTeammate),
        yesNo(r.inFastField),
        r.teammatePosition,
      ], {
        colorMap: {
          2: r.qbtActive ? undefined : RED,
          3: r.qbtActive && !r.inTeammate ? AMBER : undefined,
          4: r.qbtActive && !r.inFastField ? AMBER : undefined,
        },
      })
    }
  }

  // ---------------------------------------------------------------- Duplicates
  if ((audit.duplicates || []).length) {
    const ws = wb.addWorksheet('Duplicates')
    setWidths(ws, [28, 22, 12])
    let row = titleBand(ws, imageId, 'Names appearing more than once within one system', 'Two accounts under the same name in the same system — usually a double-up worth merging or removing.', 3)
    row = headerRow(ws, row, ['Name', 'System', 'Accounts'])
    for (const d of audit.duplicates) {
      row = dataRow(ws, row, [d.name, d.system, d.count], { colorMap: { 2: AMBER } })
    }
  }

  // ---------------------------------------------------------------- Raw lists
  const raw = audit.raw || {}
  {
    const ws = wb.addWorksheet('QuickBooks Time')
    setWidths(ws, [28, 34, 22, 12, 18])
    let row = titleBand(ws, imageId, 'QuickBooks Time — all users', 'The reference list. Includes deactivated accounts so ex-staff are visible rather than absent.', 5)
    row = headerRow(ws, row, ['Name', 'Email', 'Username', 'Status', 'Employee no.'])
    for (const u of (raw.qbtUsers || [])) {
      row = dataRow(ws, row, [u.name, u.email, u.username, u.active ? 'Active' : 'Inactive', u.employeeNumber], {
        colorMap: { 3: u.active ? undefined : RED },
      })
    }
  }
  {
    const ws = wb.addWorksheet('Teammate')
    setWidths(ws, [28, 34, 26, 20, 20])
    let row = titleBand(ws, imageId, 'Teammate — employee records', 'Teammate has no user-account list in its API, so these are employee records — the closest available equivalent. This list appears to return only current employees, so someone already terminated in Teammate will not show here at all.', 5)
    row = headerRow(ws, row, ['Name', 'Email', 'Position', 'Branch', 'Workplace'])
    for (const u of (raw.teammateUsers || [])) {
      row = dataRow(ws, row, [u.name, u.email, u.position, u.branch, u.workplace])
    }
  }
  {
    const ws = wb.addWorksheet('FastField')
    setWidths(ws, [28, 34, 14])
    const sub = audit.fastfieldEndpoint
      ? `Read from ${audit.fastfieldEndpoint}`
      : 'FastField could not be read automatically — this list may need exporting by hand from FastField itself.'
    let row = titleBand(ws, imageId, 'FastField — users', sub, 3)
    row = headerRow(ws, row, ['Name', 'Email', 'Status'])
    const ffUsers = raw.fastfieldUsers || []
    if (!ffUsers.length) {
      row = dataRow(ws, row, [audit.errors?.fastfield || 'No users returned', '', ''], { colorMap: { 0: RED } })
    } else {
      for (const u of ffUsers) {
        row = dataRow(ws, row, [u.name, u.email, u.active === null ? 'Not known' : u.active ? 'Active' : 'Inactive'])
      }
    }
  }

  return wb
}

function userAuditFilename() {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `System Access Audit ${stamp}.xlsx`
}

module.exports = { buildUserAuditXlsx, userAuditFilename }

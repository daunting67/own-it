// Teammate "Pre-Start Daily Site Briefing" template + field IDs.
//
// Template created 11 Sep 2026 via POST /api/addFormTemplate, and these ids
// were read back from POST /api/detailFormTemplate { _id } — they are the real
// ids Teammate stores values against, not guesses. Same provenance rule as
// teammateToolboxTalk.js.
//
// Note: /api/detailFormTemplate keys on `_id`. Passing `formTemplateId`
// silently returns a 898-field global list instead of the template — it looks
// like a success, so check the `name` on anything you read back.

const FORM_TEMPLATE_ID = '6aa35858b6fe719713523dbd'

// Section headers (type `section`) carry no value; listed for ordering only.
const SECTIONS = {
  jobDetails: '6aa35858b6fe719713523dd1',
  mission:    '6aa35858b6fe719713523dd5',
  vmp:        '6aa35858b6fe719713523ddb',
  hazards:    '6aa35858b6fe719713523de1',
  signOn:     '6aa35858b6fe719713523de7',
  actions:    '6aa35858b6fe719713523dec',
}

// Plain value fields — write as { value: String(...) } via populateSubmission.
const FIELD_IDS = {
  jobSite:                  '6aa35858b6fe719713523dd2', // text
  area:                     '6aa35858b6fe719713523dd3', // text
  worksDescription:         '6aa35858b6fe719713523dd6',
  mission:                  '6aa35858b6fe719713523dd7',
  otherWorks:               '6aa35858b6fe719713523dd8',
  plantMaterials:           '6aa35858b6fe719713523dd9',
  ppe:                      '6aa35858b6fe719713523dda',
  vmpEntryExit:             '6aa35858b6fe719713523ddc',
  vmpRoutes:                '6aa35858b6fe719713523ddd',
  vmpPedestrianSeparation:  '6aa35858b6fe719713523dde',
  vmpControls:              '6aa35858b6fe719713523ddf', // rows flattened, one per line
  hazards:                  '6aa35858b6fe719713523de2', // "hazard → control" per line
  couldChange:              '6aa35858b6fe719713523de5',
  redPlan:                  '6aa35858b6fe719713523de6',
  permitDetails:            '6aa362dfb6fe719713525cb9', // permit numbers & expiry
  visitors:                 '6aa35858b6fe719713523de9',
}

// employee fields — write as { value: '', optionVal: [{ value: emp._id, employeeName: emp.name }] }
const FOREMAN_FIELD = '6aa35858b6fe719713523dd4'
const CREW_FIELD    = '6aa35858b6fe719713523de8'

// file fields — the site diagram and the sign-on photos.
//
// These are NOT part of formValue at all. A `file` field's uploads live on the
// submission document's top-level `attachment[]`, each entry tagged with the
// field's id as `relatedFormId`. Verified against a real submission, and then
// end to end with a throwaway record on 11 Sep 2026:
//
//   * addFormSubmission and formSubmissionEdit BOTH silently drop `attachment`
//     — they return 200 and the array comes back empty.
//   * the only thing that works is POST /formSubmission/formSubmissionEditImage
//     as multipart: `_id` (the submission — NOT `formSubmissionId`, which is
//     rejected), `relatedFormId`, `attach[0]`. Plain `authtoken` is enough —
//     the separate `fileToken` that /fileUpload insists on is NOT required
//     here. Repeat calls append.
//
// So a photo is only really filed once formSubmissionEditImage confirms, which
// is what the Supabase photo cleanup has to wait on.
const SITE_DIAGRAM_FIELD  = '6aa35858b6fe719713523de0'
const SIGNON_PHOTOS_FIELD = '6aa35858b6fe719713523dea'

// Static declaration text rendered on the form; nothing to write.
const DECLARATION_FIELD = '6aa35858b6fe719713523deb'

// task field — debrief actions go in the form-create `tasks` array, the same
// way submitToolboxTalk does, not into this field.
const TASK_LIST_FIELD = '6aa35858b6fe719713523ded'

// checkbox fields — write as { value: '', optionVal: [{ value: <optionId> }, ...] }
const LIFE_SAVING_RULES_FIELD = '6aa35858b6fe719713523de3'
const LIFE_SAVING_RULE_OPTIONS = {
  'Never work unprotected at height':                          '6aa35858b6fe719713523dbe',
  'Never walk or work in live traffic':                        '6aa35858b6fe719713523dbf',
  'Never enter unprotected excavation':                        '6aa35858b6fe719713523dc0',
  'Always obey exclusion zones':                               '6aa35858b6fe719713523dc1',
  'Always work free from drugs & alcohol':                     '6aa35858b6fe719713523dc2',
  'Never use phone whilst operating and always wear seatbelt': '6aa35858b6fe719713523dc3',
  'Always keep clear of suspended loads':                      '6aa35858b6fe719713523dc4',
  'Always isolate and lock out':                               '6aa35858b6fe719713523dc5',
  'Always locate utilities first':                             '6aa35858b6fe719713523dc6',
}

const PERMITS_FIELD = '6aa35858b6fe719713523de4'
const PERMIT_OPTIONS = {
  'Permit to Work':    '6aa35858b6fe719713523dc7',
  'Hot Works':         '6aa35858b6fe719713523dc8',
  'Working at Height': '6aa35858b6fe719713523dc9',
  'Concrete Pump':     '6aa35858b6fe719713523dca',
  'Dig Permit':        '6aa35858b6fe719713523dcb',
  'Lifting Permit':    '6aa35858b6fe719713523dcc',
  'Confined Space':    '6aa35858b6fe719713523dcd',
  'Complex Lift':      '6aa35858b6fe719713523dce',
  'Dewatering':        '6aa35858b6fe719713523dcf',
  'LOTO (Services)':   '6aa35858b6fe719713523dd0',
}

module.exports = {
  FORM_TEMPLATE_ID,
  SECTIONS,
  FIELD_IDS,
  FOREMAN_FIELD,
  CREW_FIELD,
  SITE_DIAGRAM_FIELD,
  SIGNON_PHOTOS_FIELD,
  DECLARATION_FIELD,
  TASK_LIST_FIELD,
  LIFE_SAVING_RULES_FIELD,
  LIFE_SAVING_RULE_OPTIONS,
  PERMITS_FIELD,
  PERMIT_OPTIONS,
}

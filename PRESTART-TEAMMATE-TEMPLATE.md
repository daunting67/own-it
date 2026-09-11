# Teammate template build sheet — Pre-Start Daily Site Briefing

> **BUILT 11 Sep 2026.** Template `6aa35858b6fe719713523dbd`, 29 fields,
> 6 sections, visible to user group "All Users", coordinator Tony Daunt.
> Real field ids are captured in `server/src/lib/teammatePrestartFields.js`.
> Created with `POST /api/addFormTemplate` (which rejects `coordinate` and
> `isDelete` on create); read back with `POST /api/detailFormTemplate {_id}`.
> A pre-existing stub template "Daily  PRESTART" (`646bce7a2442241182ea946f`,
> 3 fields: person submitting + file upload) was left untouched.

Source of truth: `server/src/lib/prestartForm.js`. Record document:
P&I-HSE-SB-001 | Rev 3 | June 2026. Build this in Teammate's form builder,
then read the real field ids back via
`POST /api/formSubmission/offlineDetailFormTemplate` and wire them into
`server/src/lib/teammatePrestart.js` (copy `teammateToolboxTalk.js`).

Form name: **Pre-Start Daily Site Briefing**

## Header (Teammate's own form metadata — not fields)

| Teammate slot | Filled from |
|---|---|
| formDescription | `Pre-Start — {jobSite} — {date}` |
| formDate | briefing day |
| workplace / branch | Main Office / Head Office (same as Toolbox Talk) |
| coordinators | the foreman, resolved via `findEmployee` |

## Fields to create, in order

| # | Teammate label | Type | Portal field |
|---|---|---|---|
| 1 | Job Site | text | `jobSite` |
| 2 | Area / Location | text | `area` |
| 3 | Foreman / Supervisor | employee (single) | `foreman` |
| 4 | Description of works to be carried out | long text | `worksDescription` |
| 5 | Today's mission · why it matters | long text | `mission` |
| 6 | Other works in your area | long text | `otherWorks` |
| 7 | Required plant & materials | long text | `plantMaterials` |
| 8 | Specific PPE required | long text | `ppe` |
| 9 | Site entry & exit points | long text | `vmpEntryExit` |
| 10 | Vehicle routes · one-way, reversing & shared areas | long text | `vmpRoutes` |
| 11 | Pedestrian / plant separation | long text | `vmpPedestrianSeparation` |
| 12 | Traffic control measures | long text | `vmpControls` (rows flattened, one per line) |
| 13 | Site diagram / vehicle movement plan | image or attachment — **TYPE TO CONFIRM IN BUILDER** | `vmpDiagram` |
| 14 | Hazards and controls | long text | `hazards` (flattened `hazard → control`) — Teammate has a real `table` type, but populating one needs `subFormValues`, which the proven `populateSubmission` path has never exercised. Upgrade later if wanted. |
| 15 | Life saving rules that apply today | multi-select, 9 options | `lifeSavingRules` |
| 16 | Required permits | multi-select, 10 options | `permits` |
| 17 | What could change during the day | long text | `couldChange` |
| 18 | What could push us into the Red · our plan | long text | `redPlan` |
| 19 | Crew signed on | employee multi-select | sign-on roll |
| 20 | Visitors / subcontractors signed on | long text | sign-on entries with no employee match |
| 21 | Sign-on declaration | long text (read-only content) | `SIGN_ON_DECLARATION`, fixed |

## Option lists to type into the builder

**Life saving rules (15)** — order matches the printed briefing:
Never work unprotected at height · Never walk or work in live traffic ·
Never enter unprotected excavation · Always obey exclusion zones ·
Always work free from drugs & alcohol · Never use phone whilst operating and
always wear seatbelt · Always keep clear of suspended loads ·
Always isolate and lock out · Always locate utilities first

**Permits (16)**:
Permit to Work · Hot Works · Working at Height · Concrete Pump · Dig Permit ·
Lifting Permit · Confined Space · Complex Lift · Dewatering · LOTO (Services)

## Not fields — these become Teammate tasks

The debrief's owned actions (`actions`: owner + action + due) map onto the
`tasks` array on form create, exactly as `submitToolboxTalk` does.

## Deliberately left in the portal only

Warm-up (`newTeamMembers`), the debrief narrative (`wentWell`,
`didNotGoWell`, `improvements`), mission colour (`successLooksLike`,
`teamNeeds`, `inTheWay`) and readback (`readbackGaps`, `requests`). These are
coaching content, not the safety record. Easy to add later if Tony wants the
Teammate record to be a full mirror.

## Answered: no image field type

Teammate's field types are: section, text, textarea, number, date, time,
select, radio, checkbox, file, signature, employee, risk, task, table,
contentEditor, weblink, supplier. There is **no image type**, but `file` is
already used elsewhere for photos ("Please take a photo of the induction
form"), so the site diagram and the sign-on photos both use `file`.

Consequence for `teammatePrestart.js`: those two fields are NOT filled by
`populateSubmission`. They need a real upload via `/api/fileUpload`, and the
Supabase photo deletion must wait on that upload confirming — not on the form
create returning 200.

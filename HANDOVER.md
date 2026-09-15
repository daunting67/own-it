# Handover — Pre-Start Traffic Management Plan builder

Written 11 Sep 2026 at the end of the session that built it. Everything below is
live in production unless it says otherwise.

## What was built

A traffic management plan builder inside the Own It portal's **Pre-Start**
module. The foreman (or Tony, at a desk the day before) picks a site, gets the
LINZ aerial photo of that exact spot, and lays the site out on top of it with
the usual TTM kit. It saves as a flat image into the briefing record plus a
structured plan that can be reopened and edited.

It lives in **two** places:

1. **Pre-Start → Traffic Plans** (new tab) — a reusable library. Plans are drawn
   ahead of time, one per site, reused every morning until the layout changes.
2. **Inside a briefing, section 4 (Vehicle Movement Plan)** — offers, in order:
   the plan matching the job site already typed in (one tap), build one now,
   choose any saved plan, or the original photo fallback.

**Attaching copies the image into the briefing.** The library is a working
document; the briefing is a safety record and must keep showing what the crew
was actually briefed on. That is also what makes deleting a plan safe.

## Where the code is

| Path | What |
|---|---|
| `client/src/components/PreStart/tmp/tmpGeo.js` | Web Mercator maths, LINZ tile stitching, GPS, Nominatim address search |
| `client/src/components/PreStart/tmp/tmpSymbols.js` | All 16 symbols, one canvas draw fn each |
| `client/src/components/PreStart/tmp/tmpRender.js` | Composes base + symbols + legend, north arrow, scale bar, title block |
| `client/src/components/PreStart/tmp/TmpBuilder.jsx` | The full-screen editor |
| `client/src/components/PreStart/tmp/PlansView.jsx` | The Traffic Plans library tab |
| `server/src/lib/prestartPlanStore.js` | Plan storage (Supabase Storage bucket `prestart-plans`) |
| `server/src/routes/prestart.js` | `GET/POST /api/prestart/plans`, `GET/DELETE /plans/:id` |
| `server/src/lib/prestartForm.js` | `vmpDiagram` field type changed `photo` → `sitediagram` |
| `client/src/components/PreStart/BriefingRunner.jsx` | `case 'sitediagram'` shares the photo branch; plan suggest + picker |
| `client/src/index.css` | all `.tmp-*` styles (appended at the end) |

## Design decisions — do not undo these by accident

- **No map library.** A TMP is a fixed, printable picture of one site, so the
  aerial is stitched from tiles into one canvas and symbols are drawn over it.
  The client stays React-only (no Leaflet/MapLibre) and export is one
  `toDataURL`. Do not "upgrade" this to a slippy map without a reason.
- **One draw function per symbol**, shared by the editor, the palette icons and
  the export. There is deliberately no second SVG rendering path.
- **Tile origin is rounded to whole pixels** in `renderAerial`. At a fractional
  offset the browser's smoothing leaves a grey seam along every tile edge. This
  looks like a pointless `Math.round` — it is not.
- **Saves into `vmpDiagram`** (the same field the photo used) so BriefingView,
  the stored record and the server size check were untouched. Structured plan
  goes alongside in `vmpDiagramPlan`.
- **Symbols are two kinds**: `point` (tap to place) and `run` (tap along a line;
  the barrier/fence/cone-taper symbols space themselves along the path).

## Outstanding — highest value first

1. **Never tested on a real iPad with a real GPS fix.** Everything else is
   verified. "Drop a pin where I am standing" is the one unexercised path.
2. **The four plan endpoints have never run against real Supabase.** They were
   tested against a stubbed API so nothing touched production. The first saved
   plan creates the `prestart-plans` bucket and is their first real execution.
   Ask Tony whether he has saved one yet. Suggested smoke test: save a throwaway
   plan, confirm it lists with a thumbnail, reopen it, then delete it.
3. **LINZ API key.** Currently falling back to LINZ's *public demo key*
   (`d01eerf7nz5n1cxad3tqy91d0sa`). Tony has requested his own developer key.
   When it arrives: set `VITE_LINZ_API_KEY` in Vercel on the **frontend**
   project (`own-it-d2ra`), and **redeploy** — it is a build-time variable, so
   setting it alone does nothing. `client/.env` already has a commented line
   ready for local use. The footer shows "Using the shared LINZ demo imagery
   key" until it is set; that message disappearing is the confirmation.
4. **Address search is OpenStreetMap Nominatim** — free, keyless, rate-limited,
   expects light use. Fine for a few lookups a week. If plan-drawing ever became
   a bulk daily job it needs a proper geocoder.

## Ideas raised but not built

Tony was offered and has not yet answered: roller, water cart, traffic signals,
pedestrian detour symbols. He asked for excavator and tip truck, which are done.

## Repo state — READ THIS BEFORE COMMITTING

**Tony runs two Claude Code sessions on this repo at the same time.** It
happened throughout this session: `main` moved underneath me twice with Training
commits from the other session, and files I edited had that session's
uncommitted work in them.

- Current branch in the working tree: **`prestart-tmp-builder`** (an ancestor of
  `main`, kept only as history — all its work is merged and pushed).
- `main` == `origin/main` == **`b20e0d9`**. Deployed and verified live.
- **Uncommitted work in the tree is NOT mine** — a `resumeDraft` rewrite in
  `PreStartModule.jsx`, a `MAX_PHOTO_CHARS` bump in `prestart.js`, plus JSEA and
  safety-alert work. I deliberately staged only my own hunks and left all of it
  alone. **Do not `git add -A` in this repo.**
- Merges were done in a temporary `git worktree` rather than switching branches,
  precisely so the other session's working tree was never disturbed. That is the
  safe pattern here — reuse it.
- One loose end: `client/public/brand/icon-maskable-512.png` is untracked and
  unreferenced, left over from an abandoned PWA idea. Safe to delete.

**Latent inconsistency worth knowing:** the other session's `resumeDraft`
comment claims the Vehicle Movement Plan image is "deliberately left out of the
draft ... see BriefingRunner". That is not true of `BriefingRunner` as it
stands — the localStorage draft still writes the whole `values` object, image
included. Either that change is half-landed or the two sessions drifted. I did
not touch it. (I did guard the draft write in a try/catch, because a ~300 KB
plan plus sign-on photos can now exceed the ~5 MB quota, and losing the resume
draft must not take a running briefing down with it.)

## Verification approach used

Worth repeating rather than re-inventing: the builder was driven end to end in a
browser against **live LINZ imagery and live geocoding**, with the portal's own
API stubbed via `window.fetch` so nothing hit production Supabase. Rendering was
checked by cropping regions of the canvas into a second canvas and screenshotting
that. Deploys were confirmed by grepping the **bundle Vercel actually serves**
for known strings — not by trusting that the push succeeded, and not by
comparing build hashes (Vercel's hashes differ from a local build's).

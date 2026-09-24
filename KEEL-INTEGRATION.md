# Own It → Keel

Keel (app.keelsystems.co.nz) is the crew/plant resource board P&I uses. Goal:
Own It is the single point of entry — add a new starter here and they appear
on the Keel board without being typed in twice.

## How it works

Keel has no public API and no import screen. Its own web app talks to a
private backend at `https://app.keelsystems.co.nz/api/`, and the portal uses
that same backend (`server/src/lib/keelSync.js`). The 41 plant resources on
P&I's board were batch-loaded this way, so writing through it is proven.

When someone is added with **+ Add staff member**, the portal (fire-and-forget,
never blocks the add):

1. `login` with the integration login → bearer token
2. `userList` search — skips anyone whose first + last name is already in Keel
3. `CompanyRoleList` — maps Own It's Position onto Keel's role by exact name
   (no match → no role, rather than a wrong one)
4. `addOrUpdateUser` (multipart form, same fields Keel's own Add People form
   sends) — created as crew (`usrType` 3), no Keel login of their own, on the
   default site (normally "Available Resources")

The bulk **Add new staff (.csv)** import does NOT push — it's for people
already working, who are already on the board.

## Switching it on

Needs Keel's agreement first: these are their private endpoints, so they can
change without notice, and the portal shouldn't run on anyone's personal
login. Once Keel provides a dedicated login, set on the server:

- `KEEL_EMAIL`, `KEEL_PASSWORD`
- `KEEL_DEFAULT_SITE_ID`, `KEEL_DEFAULT_SITE_RECEIVER_ID` (134 / 583 for
  "Available Resources", as of 24 Sep 2026)

With `KEEL_EMAIL`/`KEEL_PASSWORD` unset it does nothing.

## Keel's backend (as mapped 24 Sep 2026)

All `POST`, `Authorization: Bearer <token>`, replies `{status: 200, ...}`.
Relevant beyond staff: `plantList`/`addPlant`/`updatePlant`,
`siteList`/`addOrUpdateSite`, `updateUserCompetencies`/`updateUserLicences`/
`updateUserTrainingRecord` (tickets — the next thing worth syncing from
Teammate), and `allSitesUserList`/`allSitesPlantList`/`resourcePlannerList`
(who and what is on each site — for a Pre-Start "who's missing" check).

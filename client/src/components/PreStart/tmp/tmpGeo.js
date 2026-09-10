// Web Mercator tile maths and LINZ Basemaps tile stitching.
//
// The TMP builder does not use a slippy-map library. A traffic management plan
// is a fixed, printable picture of one site, so we stitch a grid of aerial
// tiles into a single canvas once and then draw symbols over the top. That
// keeps the client dependency-free (React only, as it has always been), makes
// the export a one-line canvas.toDataURL, and means the whole plan is one flat
// image the moment the foreman stops editing it.

const TILE = 256

// LINZ Basemaps is free NZ government aerial imagery. The fallback is LINZ's
// own public demo key, published in their WMTS capabilities URL — fine for
// trialling, but set VITE_LINZ_API_KEY to P&I's own key before this sees real
// daily use so our usage is attributed to us and not rate-limited alongside
// every other demo user.
export const LINZ_API_KEY =
  import.meta.env.VITE_LINZ_API_KEY || 'd01eerf7nz5n1cxad3tqy91d0sa'

export const LINZ_IS_DEMO_KEY = !import.meta.env.VITE_LINZ_API_KEY

export function tileUrl(z, x, y) {
  return `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/${z}/${x}/${y}.webp?api=${LINZ_API_KEY}`
}

// Zoom 20 is roughly 0.15 m/pixel at NZ latitudes — a driveway is a couple of
// hundred pixels wide, which is the right scale for laying out cones. LINZ
// serves 21 in the main centres but it is upsampled in much of the country.
export const MIN_ZOOM = 16
export const MAX_ZOOM = 21
export const DEFAULT_ZOOM = 20

// World pixel coordinates at a given zoom: the whole globe is 256 * 2^z px.
export function lonLatToWorld(lon, lat, z) {
  const size = TILE * 2 ** z
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const r = (clamped * Math.PI) / 180
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size,
  }
}

export function worldToLonLat(x, y, z) {
  const size = TILE * 2 ** z
  const lon = (x / size) * 360 - 180
  const n = Math.PI - 2 * Math.PI * (y / size)
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lon, lat }
}

// Ground resolution, used for the scale bar. Mercator stretches with latitude,
// so this has to know where in the country we are.
export function metresPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}

function loadTile(url) {
  return new Promise(resolve => {
    const img = new Image()
    // The tiles are drawn into a canvas we later export, so the canvas must not
    // be tainted. LINZ serves permissive CORS headers on the tile endpoint.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null) // a missing tile leaves a blank square
    img.src = url
  })
}

// Draw the aerial photo for `centre` at `zoom` into a canvas of width x height.
// Returns the canvas so the caller can use it as an immutable base plate and
// redraw symbols over it as often as it likes without refetching tiles.
export async function renderAerial({ lon, lat, zoom, width, height, onProgress }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#20242a'
  ctx.fillRect(0, 0, width, height)

  const centre = lonLatToWorld(lon, lat, zoom)
  // World pixel of the plan's top-left corner, rounded to whole pixels: at a
  // fractional offset every tile is drawn half-way between two pixels and the
  // browser's smoothing leaves a visible grey seam along every tile edge.
  // Rounding moves the centre by under a metre and makes the aerial seamless.
  const originX = Math.round(centre.x - width / 2)
  const originY = Math.round(centre.y - height / 2)

  const firstCol = Math.floor(originX / TILE)
  const lastCol = Math.floor((originX + width) / TILE)
  const firstRow = Math.floor(originY / TILE)
  const lastRow = Math.floor((originY + height) / TILE)
  const span = 2 ** zoom

  const jobs = []
  for (let tx = firstCol; tx <= lastCol; tx++) {
    for (let ty = firstRow; ty <= lastRow; ty++) {
      // Wrap east-west, but a plan that runs off the top or bottom of the world
      // is not a thing that happens on a NZ worksite — skip those rows.
      if (ty < 0 || ty >= span) continue
      const wrapped = ((tx % span) + span) % span
      jobs.push({ tx, ty, wrapped })
    }
  }

  let done = 0
  await Promise.all(
    jobs.map(async ({ tx, ty, wrapped }) => {
      const img = await loadTile(tileUrl(zoom, wrapped, ty))
      done += 1
      onProgress?.(done, jobs.length)
      if (!img) return
      ctx.drawImage(img, tx * TILE - originX, ty * TILE - originY)
    })
  )

  return canvas
}

// Find a site by address rather than by standing on it. Plans are now drawn
// ahead of time at a desk, where the GPS fix is the office car park and not the
// job — so an address search is the primary way in for a planned job, and the
// GPS pin is for the foreman who is already on site.
//
// OpenStreetMap's Nominatim is free and needs no key. It is rate-limited to
// roughly one request a second and asks that it not be hammered, which suits a
// handful of lookups a week. Results are restricted to New Zealand.
export async function searchAddress(query) {
  const q = String(query || '').trim()
  if (q.length < 3) return []
  const url = 'https://nominatim.openstreetmap.org/search'
    + `?q=${encodeURIComponent(q)}&countrycodes=nz&format=jsonv2&limit=6&addressdetails=0`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Address search is unavailable right now.')
  const rows = await res.json()
  return rows.map(r => ({
    label: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))
}

// One shared position lookup so the "drop a pin where I'm standing" button
// behaves the same everywhere. High accuracy matters here: a 100 m civic-centre
// fix would put the plan on the wrong street.
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device cannot find your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos =>
        resolve({
          lon: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
        }),
      err => {
        const messages = {
          1: 'Location is blocked. Allow location for this site in Settings, then try again.',
          2: 'Could not get a fix — no GPS or network signal right now.',
          3: 'Timed out looking for your location. Try again outside.',
        }
        reject(new Error(messages[err.code] || 'Could not find your location.'))
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    )
  })
}

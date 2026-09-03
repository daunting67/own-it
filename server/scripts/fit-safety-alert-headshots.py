"""
Fit each real staff headshot from ~/Documents/Claude/Projects/Safety Alert
Project/Headshots/{Name}.jp(e)g into the Safety Alert template's HEADSHOT
frame (the thank-you box picture, word/media/image4.jpeg / rId10), so
buildSafetyAlertDocx.js can swap the right person's photo in by name at
build time via a pure byte replacement (see DEFAULT_PHOTO_ASSETS's comment
for why matching dimensions matters).

UNLIKE the three PHOTO frames (which use Tony's non-negotiable "never crop,
pad white" rule for graphics/logos/posters), a headshot is a real portrait of
a person's face — the standard, expected treatment is a filled, center-cropped
photo like any ID photo, not a face floating in white space. So this uses
cover-crop, not contain-and-pad.

Output files are named exactly after the source (e.g. "Tony Daunt.jpg" ->
"Tony Daunt.jpg" in server/src/assets/headshots/), so buildSafetyAlertDocx.js
matches an alert's `reportedBy` to a file by name at build time — add a new
person by dropping their photo in the source folder and re-running this.

Run from the server/ directory: python3 scripts/fit-safety-alert-headshots.py
Requires Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageOps

# White, not near-black — a sub-pixel mismatch between this canvas and the
# template's <a:srcRect> crop can leave a sliver of it visible as a thin
# border-like line (confirmed by direct pixel sampling on a real export, on
# the default-photo frames this same contract is shared with). White makes
# that same sliver invisible against the page instead of a fault line.
CANVAS_BG = (255, 255, 255)

SOURCE_DIR = "/Users/tonydaunt/Documents/Claude/Projects/Safety Alert Project/Headshots"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "headshots")

# The template's own headshot image (word/media/image4.jpeg, rId10) is
# 342x345px, cropped by a fixed <a:srcRect l="14416" r="14416"/> (14.416% off
# each side, no top/bottom crop) -> visible window (49.30, 0)-(292.70, 345).
CANVAS = (342, 345)
VISIBLE = (49.30, 0, 292.70, 345)


def cover_crop(img, target_w, target_h):
    src_w, src_h = img.size
    scale = max(target_w / src_w, target_h / src_h)
    scaled = img.resize((round(src_w * scale), round(src_h * scale)), Image.LANCZOS)
    sw, sh = scaled.size
    x0, y0 = (sw - target_w) / 2, (sh - target_h) / 2
    return scaled.crop((round(x0), round(y0), round(x0) + target_w, round(y0) + target_h))


def build(filename):
    canvas_w, canvas_h = CANVAS
    vx0, vy0, vx1, vy1 = VISIBLE
    vw, vh = round(vx1 - vx0), round(vy1 - vy0)

    # exif_transpose: phone photos often carry a rotation in EXIF metadata
    # rather than in the actual pixels — skip it and a portrait photo shot
    # sideways renders sideways.
    src = ImageOps.exif_transpose(Image.open(os.path.join(SOURCE_DIR, filename))).convert("RGB")
    fitted = cover_crop(src, vw, vh)

    canvas = Image.new("RGB", (canvas_w, canvas_h), CANVAS_BG)
    canvas.paste(fitted, (round(vx0), round(vy0)))

    out_path = os.path.join(OUT_DIR, filename)
    canvas.save(out_path, quality=92)
    print(filename, "->", canvas.size, "saved to", out_path)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    names = sorted(f for f in os.listdir(SOURCE_DIR) if f.lower().endswith((".jpg", ".jpeg", ".png")))
    for f in names:
        build(f)
    print(f"\n{len(names)} headshot(s) fitted.")

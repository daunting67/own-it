"""
Fit Tony's own three "Default Photos" (~/Documents/Claude/Projects/Safety
Alert Project/Default Photos/Default {1,2,3}.jp*g) into the Safety Alert
template's three photo frames.

Each output image MUST be the exact pixel size of the template photo it
stands in for, because document.xml crops each frame with a fixed
<a:srcRect> percentage.

Per Tony: "we can never cut off a photo. Whitespace is acceptable" — so the
source photo is "contain"-fit (scaled down to fit ENTIRELY within the
frame's VISIBLE window, never cropped) and centered on a white background
that fills the rest of that window, then pasted at the window's offset
inside a full-size canvas. The canvas area outside the visible window is
supposed to be invisible — cropped away by Word (that crop is baked into the
template's own XML and this script cannot touch it) — but a sub-pixel
mismatch between this canvas and that crop can leave a sliver of it showing
as a thin line. It's filled white (CANVAS_BG), not the "it'll never be seen
anyway" near-black this used to be, precisely so that if it DOES leak
through, it's invisible against the page rather than reading as a fault
line — found by direct pixel sampling on a real export, not by eye.

WHICH PHOTO GOES IN WHICH FRAME IS NOT FIXED (per Tony: pick by fit, not by
matching numbers) — this brute-forces all 3! assignments of the 3 source
photos to the 3 frames and keeps whichever one leaves the least total white
space (i.e. each photo displays as large as possible within its frame), so a
portrait source doesn't get crammed into a landscape frame just because they
share a number. The scoring math is the same whether the mismatch is resolved
by cropping or by padding — only how the leftover mismatch is handled (cut
vs. pad) changed — so the optimal assignment is unchanged from the
cover-crop version of this script.

Run from the server/ directory: python3 scripts/fit-safety-alert-default-photos.py
Requires Pillow (pip install pillow).
"""
import os
from itertools import permutations
from PIL import Image, ImageOps

# White, not near-black — a sub-pixel mismatch between this canvas and the
# template's <a:srcRect> crop leaves a sliver of it visible as a thin
# border-like line (confirmed by direct pixel sampling on a real export).
# White makes that same sliver invisible against the page instead of a fault
# line, since PI_BLACK was only ever meant to be a "you'll never see this"
# fallback, not a colour anyone was supposed to be able to spot.
CANVAS_BG = (255, 255, 255)

SOURCE_DIR = "/Users/tonydaunt/Documents/Claude/Projects/Safety Alert Project/Default Photos"
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "assets")

SOURCES = ["Default 1.jpg", "Default 2.jpeg", "Default 3.jpeg"]

# out filename, canvas px (= the template photo's own size), visible window
# px (x0,y0,x1,y1) = that frame's srcRect crop applied to the canvas.
FRAMES = [
    dict(out="safety-alert-photo1-placeholder.jpeg", canvas=(1025, 770), visible=(308.5, 234.7, 785.8, 641.9)),
    dict(out="safety-alert-photo2-placeholder.jpeg", canvas=(484, 644), visible=(0, 68.6, 484, 575.4)),
    dict(out="safety-alert-photo3-placeholder.jpg", canvas=(800, 450), visible=(71.9, 0, 648, 397.2)),
]


def coverage_fraction(src_aspect, frame_aspect):
    # Contain-fit scales to the more restrictive dimension, so the photo
    # covers this fraction of the frame's area and the rest pads white — 1.0
    # when the aspect ratios match exactly (no padding), falling as they
    # diverge either way. Same formula whichever way the leftover mismatch
    # gets resolved (crop vs. pad), so this also happens to be the fraction
    # of source area a cover-crop would have kept — see the module docstring.
    return min(src_aspect / frame_aspect, frame_aspect / src_aspect)


def best_assignment(src_aspects, frame_aspects):
    best_perm, best_score = None, -1
    for perm in permutations(range(len(frame_aspects))):
        score = sum(coverage_fraction(src_aspects[i], frame_aspects[perm[i]]) for i in range(len(perm)))
        if score > best_score:
            best_score, best_perm = score, perm
    return best_perm, best_score


def contain_pad(img, target_w, target_h):
    # Never crops: scales the WHOLE photo down to fit inside target_w x
    # target_h, then centers it on a white canvas of exactly that size.
    src_w, src_h = img.size
    scale = min(target_w / src_w, target_h / src_h)
    scaled = img.resize((round(src_w * scale), round(src_h * scale)), Image.LANCZOS)
    sw, sh = scaled.size
    canvas = Image.new("RGB", (target_w, target_h), (255, 255, 255))
    canvas.paste(scaled, (round((target_w - sw) / 2), round((target_h - sh) / 2)))
    return canvas


def build(src_name, frame):
    canvas_w, canvas_h = frame["canvas"]
    vx0, vy0, vx1, vy1 = frame["visible"]
    vw, vh = round(vx1 - vx0), round(vy1 - vy0)

    # exif_transpose: a source photographed on a phone can carry its rotation
    # in EXIF metadata rather than in the pixels themselves.
    src = ImageOps.exif_transpose(Image.open(os.path.join(SOURCE_DIR, src_name))).convert("RGB")
    fitted = contain_pad(src, vw, vh)

    canvas = Image.new("RGB", (canvas_w, canvas_h), CANVAS_BG)
    canvas.paste(fitted, (round(vx0), round(vy0)))

    out_path = os.path.join(ASSETS_DIR, frame["out"])
    canvas.save(out_path, quality=92)
    print(frame["out"], "<-", src_name, "->", canvas.size, "saved to", out_path)


if __name__ == "__main__":
    sources = [ImageOps.exif_transpose(Image.open(os.path.join(SOURCE_DIR, s))) for s in SOURCES]
    src_aspects = [w / h for w, h in (im.size for im in sources)]
    frame_aspects = [(f["visible"][2] - f["visible"][0]) / (f["visible"][3] - f["visible"][1]) for f in FRAMES]

    perm, score = best_assignment(src_aspects, frame_aspects)
    print(f"best assignment (score {score:.3f} of max {len(FRAMES)}.0):")
    for src_i, frame_i in enumerate(perm):
        print(f"  {SOURCES[src_i]} -> {FRAMES[frame_i]['out']}")

    for src_i, frame_i in enumerate(perm):
        build(SOURCES[src_i], FRAMES[frame_i])

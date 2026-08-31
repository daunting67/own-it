"""
Regenerate the three default Safety Alert photo placeholders in
server/src/assets/ — the images buildSafetyAlertDocx.js swaps into an alert's
photo frames when the source incident has no attachments (see
DEFAULT_PHOTO_ASSETS there).

Each output image MUST keep the exact pixel dimensions of the template photo
it stands in for (image1.jpeg / image2.jpeg / image5.jpg inside
safety-alert-template.docx), because document.xml crops each frame with a
fixed <a:srcRect> percentage. Matching dimensions means the swap in
buildSafetyAlertDocx.js is a pure byte replacement — no XML edits, no risk of
corrupting the .docx. The visible window for each frame (below) was derived
from that srcRect once, by hand; re-derive it (see the crop-math comment in
buildSafetyAlertDocx.js) if the template's photo frames are ever resized.

Run from the server/ directory: python3 scripts/make-safety-alert-placeholders.py
Requires Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageDraw, ImageFont

PI_BLACK = (22, 22, 22)
PI_ORANGE = (232, 91, 26)      # matches --pi-orange in client/src/index.css
PANEL = (58, 58, 58)           # neutral warm-grey "no photo" panel — reads as deliberate, not broken
PANEL_LINE = (90, 90, 90)
TEXT = (214, 214, 214)

FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "assets")

SPECS = [
    # out filename, canvas px (= original template image's own size), visible
    # window px (x0,y0,x1,y1) = the frame's srcRect crop applied to that canvas
    dict(out="safety-alert-photo1-placeholder.jpeg", canvas=(1025, 770), visible=(308.5, 234.7, 785.8, 641.9)),
    dict(out="safety-alert-photo2-placeholder.jpeg", canvas=(484, 644), visible=(0, 68.6, 484, 575.4)),
    dict(out="safety-alert-photo3-placeholder.jpg", canvas=(800, 450), visible=(71.9, 0, 648, 397.2)),
]


def camera_off_icon(draw, cx, cy, size, color, width):
    # Simple, unambiguous "no photo" glyph: camera body + lens + a slash.
    w, h = size, size * 0.72
    left, top = cx - w / 2, cy - h / 2
    right, bottom = cx + w / 2, cy + h / 2
    body_top = top + h * 0.22
    draw.rounded_rectangle([left, body_top, right, bottom], radius=size * 0.08, outline=color, width=width)
    bump_w = w * 0.34
    draw.rectangle([cx - bump_w / 2, top, cx + bump_w / 2, body_top + 2], outline=color, width=width)
    lens_r = h * 0.30
    draw.ellipse([cx - lens_r, cy + h * 0.06 - lens_r, cx + lens_r, cy + h * 0.06 + lens_r], outline=color, width=width)
    pad = size * 0.12
    draw.line([left - pad, bottom + pad, right + pad, top - pad], fill=color, width=int(width * 1.15))


def build(spec):
    canvas_w, canvas_h = spec["canvas"]
    vx0, vy0, vx1, vy1 = spec["visible"]
    vw, vh = vx1 - vx0, vy1 - vy0
    vcx, vcy = (vx0 + vx1) / 2, (vy0 + vy1) / 2

    img = Image.new("RGB", (canvas_w, canvas_h), PI_BLACK)
    draw = ImageDraw.Draw(img)

    # Panel fills the visible window with a small inset so a hairline border
    # reads as a deliberate frame edge once the surrounding canvas is cropped away.
    inset = min(vw, vh) * 0.035
    px0, py0, px1, py1 = vx0 + inset, vy0 + inset, vx1 - inset, vy1 - inset
    draw.rectangle([px0, py0, px1, py1], fill=PANEL, outline=PANEL_LINE, width=max(2, int(inset * 0.4)))

    # Thin orange hazard tick in each corner — echoes the alert's own hazard-band
    # branding without trying to reproduce it.
    tick = min(vw, vh) * 0.09
    tw = max(3, int(inset * 0.5))
    for (cx0, cy0, sx, sy) in [(px0, py0, 1, 1), (px1, py0, -1, 1), (px0, py1, 1, -1), (px1, py1, -1, -1)]:
        draw.line([cx0, cy0, cx0 + sx * tick, cy0], fill=PI_ORANGE, width=tw)
        draw.line([cx0, cy0, cx0, cy0 + sy * tick], fill=PI_ORANGE, width=tw)

    icon_size = min(vw, vh) * 0.30
    icon_cy = vcy - vh * 0.06
    camera_off_icon(draw, vcx, icon_cy, icon_size, TEXT, max(3, int(icon_size * 0.045)))

    caption = "PHOTO NOT SUPPLIED"
    font = ImageFont.truetype(FONT_PATH, max(12, int(vh * 0.062)))
    bbox = draw.textbbox((0, 0), caption, font=font)
    tw_ = bbox[2] - bbox[0]
    ty = icon_cy + icon_size * 0.62
    draw.text((vcx - tw_ / 2, ty), caption, font=font, fill=TEXT)

    out_path = os.path.join(ASSETS_DIR, spec["out"])
    img.save(out_path, quality=90)
    print(spec["out"], "->", img.size, "saved to", out_path)


if __name__ == "__main__":
    for s in SPECS:
        build(s)

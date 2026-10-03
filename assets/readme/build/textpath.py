"""Turn text into SVG path outlines, so cards need no web fonts on GitHub.

GitHub serves repo SVGs with a strict content policy, so an SVG shown as an
image cannot load or embed fonts reliably. Every word on a card is drawn as
shapes instead, shaped with HarfBuzz so kerning matches the real typeface.
"""
import io

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

import glob
import os

# Montserrat and Gelasio (SIL Open Font License), as bundled with the
# ep-brand-guidelines skill. Point EP_FONTS at that folder if it lives elsewhere.
_CANDIDATES = [os.environ.get("EP_FONTS", "")] + sorted(
    glob.glob("/mnt/skills/*/ep-brand-guidelines/assets/fonts")
    + glob.glob(os.path.expanduser("~/.claude/skills/**/ep-brand-guidelines/assets/fonts"), recursive=True))
FONT_DIR = next((d for d in _CANDIDATES if d and os.path.isdir(d)), "fonts").rstrip("/") + "/"

# Archivo (SIL Open Font License) ships beside this script, because Room Pulse
# draws its map in it and the Room Pulse card borrows that map.
HERE = os.path.dirname(os.path.abspath(__file__)) + "/fonts/"

FACES = {
    "archivo": HERE + "archivo-latin-500-normal.woff2",
    "archivo-bold": HERE + "archivo-latin-700-normal.woff2",
    "bold": "Montserrat-Bold.ttf",
    "semibold": "Montserrat-SemiBold.ttf",
    "medium": "Montserrat-Medium.ttf",
    "regular": "Montserrat-Regular.ttf",
    "serif": "Gelasio-Regular.ttf",
    "serif-italic": "Gelasio-Italic.ttf",
}

_cache = {}


def _load(face):
    if face not in _cache:
        name = FACES[face]
        path = name if name.startswith("/") else FONT_DIR + name
        tt = TTFont(path)
        if tt.flavor:   # woff2: unpack to plain font bytes for HarfBuzz (needs brotli)
            tt.flavor = None
            raw = io.BytesIO()
            tt.save(raw)
            tt = TTFont(io.BytesIO(raw.getvalue()))
            blob = hb.Blob(raw.getvalue())
        else:
            blob = hb.Blob.from_file_path(path)
        hbfont = hb.Font(hb.Face(blob))
        _cache[face] = (hbfont, tt, tt["head"].unitsPerEm, tt.getGlyphSet(), tt.getGlyphOrder())
    return _cache[face]


class _RoundPen(SVGPathPen):
    """SVGPathPen with coordinates rounded to whole units to keep files small."""

    def __init__(self, glyphSet):
        super().__init__(glyphSet, ntos=lambda v: "%d" % round(v))


def measure(text, face, size, tracking=0.0):
    hbfont, tt, upem, gs, order = _load(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    scale = size / upem
    adv = sum(p.x_advance for p in buf.glyph_positions) * scale
    return adv + tracking * size * max(len(buf.glyph_infos) - 1, 0)


def text_path(text, face, size, x, y, anchor="start", tracking=0.0):
    """Return (path d, width) for text whose baseline starts at (x, y)."""
    hbfont, tt, upem, gs, order = _load(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    scale = size / upem
    width = measure(text, face, size, tracking)
    if anchor == "middle":
        x -= width / 2
    elif anchor == "end":
        x -= width
    pen = _RoundPen(gs)
    cx = x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        gx = cx + pos.x_offset * scale
        gy = y - pos.y_offset * scale
        tpen = TransformPen(pen, (scale, 0, 0, -scale, gx, gy))
        gs[name].draw(tpen)
        cx += pos.x_advance * scale + tracking * size
    return pen.getCommands(), width


def wrap(text, face, size, max_width):
    """Greedy word wrap by measured width."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if measure(trial, face, size) <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

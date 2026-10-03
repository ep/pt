"""Build the README cards for github.com/ep/pt.

Every card is a self-contained SVG: no fonts, no images, no scripts, nothing
loaded from outside. Words are outlines (textpath.py). Colors follow the EP
palette and switch to deep versions when the viewer's system is in dark mode.
Each motif plays its signature moment once when the image loads, then rests;
viewers who ask for reduced motion see the resting picture straight away.

Every motif draws from one shared set of measures (TOKENS below) and sits on
the same stage, so the cards read as one family.

To rebuild after a change:  pip install fonttools uharfbuzz brotli  then  python3 build.py
The cards are written to the folder above this one (assets/readme/).
"""
import json
import math
import os
from xml.sax.saxutils import escape

from textpath import text_path, measure, wrap

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..")

# ---------------------------------------------------------------- tokens

HEAVY, MED, FINE = 16, 8, 5          # line weights: outlines, details, guides
DOT_S, DOT_M, DOT_L = 9, 18, 24      # people, markers, the one gold accent
R_PAGE, R_BLOCK = 20, 14             # corner radii: pages and tiles, small blocks
GUIDE = 'stroke-linecap="round" stroke-dasharray="1 14"'   # dotted guide line

# half cards: 1000 x 640. The stage is where the picture lives, above the words.
STAGE_TOP, STAGE_BOTTOM, STAGE_CX = 72, 424, 500
STAGE_CY = (STAGE_TOP + STAGE_BOTTOM) / 2

# ---------------------------------------------------------------- palette

INK, INK_D = "#293851", "#F3F5F9"
SUB, SUB_D = "#586A90", "#B4BED2"

FAMILIES = {
    #         light bg,  light soft, dark bg
    "teal":  ("#E4F4F4", "#C3E6E5", "#13343A"),
    "warm":  ("#F6E2D5", "#EFCBB5", "#38241C"),
    "green": ("#E9F0CF", "#D5E2A4", "#232F18"),
    "gold":  ("#FEF6C9", "#FBE592", "#352D14"),
    "blue":  ("#EEF0F5", "#D5D9E3", "#1D293D"),
    "paper": ("#F9F6F6", "#ECE5E3", "#1E2534"),
    "cobalt": ("#293851", "#3A4A66", "#172036"),
}

ACCENTS = {
    # name: (light, dark)
    "co": ("#68BFBD", "#68BFBD"),
    "pr": ("#D86527", "#E57A42"),
    "fe": ("#90B210", "#9EC21A"),
    "go": ("#FFCC00", "#FFCC00"),
    "gw": ("#F2C94C", "#FFCC00"),   # warmer gold for large shapes on light paper
    "ae": ("#586A90", "#8FA1C7"),
    "cb": ("#293851", "#D5D9E3"),
    "t": (INK, INK_D),
    "s": (SUB, SUB_D),
    "ln": ("rgba(41,56,81,.22)", "rgba(255,255,255,.24)"),
    "rule": ("#DDE1EA", "rgba(255,255,255,.18)"),
}

MOTION = """
.a{animation-duration:.9s;animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.75,.25,1);transform-box:fill-box}
.pop{animation-name:pop;transform-origin:50% 50%}
.rise{animation-name:rise;transform-origin:50% 100%}
.gl{animation-name:gx;transform-origin:100% 50%}
.gr{animation-name:gx;transform-origin:0% 50%}
.drop{animation-name:drop}
.up{animation-name:up}
.fade{animation-name:fade}
.draw{animation-name:draw;stroke-dasharray:1 1}
.fan{animation-name:fan;transform-origin:50% 100%}
.stamp{animation-name:stamp;transform-origin:50% 50%}
.spin{animation-name:spin;transform-origin:50% 50%;animation-duration:1.6s}
@keyframes pop{from{transform:scale(0);opacity:0}65%{transform:scale(1.1);opacity:1}to{transform:scale(1)}}
@keyframes rise{from{transform:scaleY(0)}}
@keyframes gx{from{transform:scaleX(0)}}
@keyframes drop{from{transform:translateY(-70px);opacity:0}70%{transform:translateY(4px);opacity:1}to{transform:translateY(0)}}
@keyframes up{from{transform:translateY(26px);opacity:0}}
@keyframes fade{from{opacity:0}}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes fan{from{transform:rotate(0deg) translateY(16px);opacity:0}}
@keyframes stamp{from{transform:scale(1.8);opacity:0}70%{transform:scale(.94);opacity:1}to{transform:scale(1)}}
@keyframes spin{from{transform:rotate(-50deg);opacity:0}}
@media (prefers-reduced-motion:reduce){.a{animation:none}}
"""


def mix(hex_a, hex_b, t):
    """Solid blend of two hex colors, so overlapping shapes never show through."""
    a = [int(hex_a[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(hex_b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def style(family, extra=""):
    bg, soft, bg_d = FAMILIES[family]
    light, dark = [], []
    pp_d, soft_d = mix(bg_d, "#FFFFFF", .1), mix(bg_d, soft, .2)
    pp = "#FFFFFF"
    if family == "cobalt":                    # the hub and Podium pages are cobalt, so their cards are too
        pp, pp_d = mix(bg, "#FFFFFF", .08), mix(bg_d, "#FFFFFF", .08)
    tints = {
        "co2": ("#B3DFDE", mix(bg_d, "#68BFBD", .45)), "pr2": ("#EBB293", mix(bg_d, "#E57A42", .45)),
        "tt": ("#E4F4F4", mix(bg_d, "#68BFBD", .2)), "ct": ("#F6E2D5", mix(bg_d, "#E57A42", .2)),
        "pol": ("#FEF6C9", mix(bg_d, "#FFCC00", .14)),
        "hdr": ("#293851", "#3A4D72"),          # a cobalt header band that stays cobalt in the dark
        "dt": ("#3E8E8C", "#7FCFCC"), "dc": ("#B14E1C", "#F0956A"),
        "hub": ("rgba(255,255,255,.82)", "rgba(255,255,255,.82)"), "hub2": ("rgba(255,255,255,.3)", "rgba(255,255,255,.3)"),
    }
    for cls, l, d in (("bg", bg, bg_d), ("soft", soft, soft_d), ("pp", pp, pp_d)):
        sel = ".bg" if cls == "bg" else ".f-" + cls
        light.append("%s{fill:%s}.s-%s{stroke:%s}" % (sel, l, cls, l))
        dark.append("%s{fill:%s}.s-%s{stroke:%s}" % (sel, d, cls, d))
    for k, (lc, dc) in list(ACCENTS.items()) + list(tints.items()):
        light.append(".f-%s{fill:%s}.s-%s{stroke:%s}" % (k, lc, k, lc))
        dark.append(".f-%s{fill:%s}.s-%s{stroke:%s}" % (k, dc, k, dc))
    if family == "cobalt":
        light.append(".f-t{fill:#FFFFFF}.f-s{fill:#C5CDDD}")
    return ("<style>%s%s\n@media (prefers-color-scheme:dark){%s}%s</style>"
            % ("".join(light), MOTION, "".join(dark), extra))


def A(kind, delay):
    return ' class="a %s" style="animation-delay:%.2fs"' % (kind, delay)


def anim(color, kind, delay, more=""):
    return ' class="%s a %s" style="animation-delay:%.2fs%s"' % (color, kind, delay, more)


def doc(w, h, family, title, body, extra_css=""):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" role="img">'
        "<title>%s</title>%s"
        '<defs><clipPath id="c"><rect x="14" y="14" width="%d" height="%d" rx="40"/></clipPath></defs>'
        '<rect class="bg" x="14" y="14" width="%d" height="%d" rx="40"/>'
        '<g clip-path="url(#c)">%s</g></svg>'
    ) % (w, h, w // 2, h // 2, escape(title), style(family, extra_css), w - 28, h - 28, w - 28, h - 28, body)


def txt(text, face, size, x, y, cls, anchor="start", tracking=0.0):
    d, w = text_path(text, face, size, x, y, anchor, tracking)
    return '<path class="%s" d="%s"/>' % (cls, d), w


def fit(text, face, size, width):
    while measure(text, face, size) > width:
        size -= 1
    return size


def runs(parts, x, y, anchor="start"):
    """A line made of runs in different faces: [(text, face, size, class), ...]."""
    widths = [measure(t, f, s) for t, f, s, _ in parts]
    if anchor == "middle":
        x -= sum(widths) / 2
    out = []
    for (t, f, s, c), w in zip(parts, widths):
        p, _ = txt(t, f, s, x, y, c)
        out.append(p)
        x += w
    return "".join(out), x


# ---------------------------------------------------------------- text blocks

def half_text(title, line, line_face="serif"):
    t, _ = txt(title, "bold", fit(title, "bold", 56, 856), 72, 528, "f-t", tracking=-0.01)
    l, _ = txt(line, line_face, fit(line, line_face, 32, 856), 72, 584, "f-s")
    return '<g%s>%s%s</g>' % (A("up", 0.05), t, l)


def wide_text(title, line, title_face="bold", line_face="serif", gold_dot=False, max_w=880):
    size = fit(title, title_face, 84 if title_face == "bold" else 92, max_w - (30 if gold_dot else 0))
    lines = wrap(line, line_face, 38, 820)
    block_h = size * 0.72 + 30 + len(lines) * 54
    y0 = (640 - block_h) / 2 + size * 0.72
    t, w = txt(title, title_face, size, 96, y0, "f-t", tracking=-0.015 if title_face == "bold" else 0)
    parts = [t]
    if gold_dot:   # the sketchbook's own title ends on a gold dot
        parts.append('<circle%s cx="%.1f" cy="%.1f" r="%.1f"/>' % (anim("f-go", "pop", 0.9), 96 + w + size * .16, y0 - size * .09, size * .11))
    for i, ln in enumerate(lines):
        p, _ = txt(ln, line_face, 38, 96, y0 + 30 + 38 + i * 54, "f-s")
        parts.append(p)
    return '<g%s>%s</g>' % (A("up", 0.05), "".join(parts))


# ---------------------------------------------------------------- motifs
# Each picture is drawn from the page the card opens: its own front-page art where it has
# one, otherwise the screen people remember from it.

def pair_poll():
    """Pair Poll's own front-page miniature, scaled up: two statements, a room of dots
    settling on the sides they chose, then the wings drawing from the dashed midline."""
    s = 1.75
    X = lambda x: 500 + (x - 260) * s
    Y = lambda y: 78 + (y - 60) * s
    out = []
    for x0, card, pill, widths in ((30, "f-tt", "s-co", (150, 120, 90)), (290, "f-ct", "s-pr", (140, 105, 70))):
        out.append('<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f"/>' % (card, X(x0), Y(60), 200 * s, 120 * s, 16 * s))
        out.append('<rect class="f-pp %s" stroke-width="%.1f" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f"/>'
                   % (pill, 2 * s, X(x0 + 22), Y(84), 70 * s, 14 * s, 7 * s))
        for l, w in enumerate(widths):
            out.append('<rect class="f-cb" opacity=".25" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f"/>'
                       % (X(x0 + 22), Y(112 + l * 16), w * s, 7 * s, 3.5 * s))
    seed = [7]

    def rnd():
        seed[0] = (seed[0] * 9301 + 49297) % 233280
        return seed[0] / 233280

    kf = []
    for i in range(14):
        left = i < 9
        tx = -(60 + rnd() * 140) if left else (60 + rnd() * 140)
        ty = (rnd() - 0.5) * 90
        kf.append("@keyframes v%d{from{transform:translate(%.1fpx,%.1fpx) scale(.3);opacity:0}25%%{opacity:1}}" % (i, -tx * s, -ty * s))
        out.append('<circle class="%s a" style="animation:v%d 1s cubic-bezier(.2,.8,.2,1) %.2fs both;transform-box:fill-box;transform-origin:50%% 50%%" cx="%.1f" cy="%.1f" r="12"/>'
                   % ("f-dt" if left else "f-dc", i, 0.2 + i * 0.06, X(260 + tx), Y(120 + ty)))
    out.append('<line class="s-cb" opacity=".55" x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke-width="%.1f" stroke-dasharray="%.1f %.1f"/>'
               % (X(260), Y(215), X(260), Y(257), 2 * s, 4 * s, 4 * s))
    out.append('<rect%s x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f"/>' % (anim("f-co", "gl", 1.25), X(118), Y(226), 140 * s, 20 * s, 10 * s))
    out.append('<rect%s opacity=".45" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f"/>' % (anim("f-pr", "gr", 1.35), X(262), Y(226), 72 * s, 20 * s, 10 * s))
    return "".join(out), "".join(kf)


def chips():
    """A Place Your Chips lens reveal: each initiative, each player's chips as a bar,
    and the initiative the table split on most marked as worth the airtime."""
    groups = [(6, 7, 4), (1, 4, 8), (9, 3, 6)]
    players = ("pr", "co", "fe")              # Ash, Bea and Cole in the test drive
    out = []
    y = 84
    k = 0
    for gi, vals in enumerate(groups):
        top = y
        if gi == 1:                            # worth the airtime: the widest spread
            out.append('<g%s><rect class="f-pol" x="76" y="%d" width="848" height="%d" rx="12"/>'
                       '<rect class="f-go" x="76" y="%d" width="7" height="%d" rx="3.5"/></g>' % (A("fade", 1.7), top - 14, 112, top - 14, 112))
        out.append('<rect class="f-cb" x="104" y="%d" width="%d" height="14" rx="7" opacity=".85"/>' % (y, (230, 190, 160)[gi]))
        y += 30
        for p, v in zip(players, vals):
            out.append('<rect class="f-%s" x="104" y="%d" width="36" height="10" rx="5"/>' % (p, y + 3))
            out.append('<rect class="f-soft" x="160" y="%d" width="740" height="16" rx="8"/>' % y)
            for c in range(v):
                out.append('<rect%s x="%d" y="%d" width="30" height="16" rx="4"/>' % (anim("f-" + p, "pop", 0.2 + k * 0.03), 160 + c * 36, y))
                k += 1
            y += 26
        y += 18
    return "".join(out)


def drop_zone(x, y, w, h):
    """The report builders' own drop zone, with a CSV landing in it."""
    out = ['<rect class="f-pp s-ln" x="%d" y="%d" width="%d" height="%d" rx="30" stroke-width="4" stroke-dasharray="16 12"/>' % (x, y, w, h),
           '<rect class="s-co a fade" style="animation-delay:.95s" x="%d" y="%d" width="%d" height="%d" rx="30" fill="none" stroke-width="4" stroke-dasharray="16 12"/>' % (x, y, w, h)]
    fx, fy, fw, fh = x + w / 2 - 58, y + 46, 116, 146
    sheet = ('<path class="f-pp s-cb" stroke-width="4" stroke-linejoin="round" d="M%.1f %.1fh%.1fl28 28v%.1fh-%.1fz"/>'
             '<path class="s-cb" stroke-width="4" stroke-linejoin="round" fill="none" d="M%.1f %.1fv28h28"/>') % (
        fx, fy, fw - 28, fh - 28, fw, fx + fw - 28, fy)
    for r in range(4):
        for c in range(3):
            sheet += '<rect class="f-soft" x="%.1f" y="%.1f" width="22" height="12" rx="3"/>' % (fx + 16 + c * 30, fy + 48 + r * 20)
    out.append('<g%s>%s</g>' % (A("drop", 0.3), sheet))
    out.append('<rect class="s-cb" opacity=".5" x="%.1f" y="%d" width="112" height="40" rx="20" fill="none" stroke-width="3"/>' % (x + w / 2 - 56, y + h - 70))
    return "".join(out)


def ringed(cx, cy, n, tint, delay, r=22):
    num, _ = txt(n, "serif", 22, cx, cy + 8, "f-t", anchor="middle")
    return '<g%s><circle class="f-pp s-%s" stroke-width="4" cx="%d" cy="%d" r="%d"/>%s</g>' % (A("pop", delay), tint, cx, cy, r, num)


def sponsor_reports():
    """WBWAI 201's report builder: a CSV dropped in, and the sponsor report's
    'What this group achieved', each highlight with its ringed number."""
    out = [drop_zone(80, 96, 300, 304)]
    for i, x in enumerate((406, 426, 446)):
        out.append('<circle%s cx="%d" cy="248" r="6"/>' % (anim("f-ae", "pop", 0.8 + i * 0.1), x))
    px, py, pw, ph = 472, 72, 414, 352
    head, _ = txt("What this group achieved", "serif", 29, px + 32, py + 54, "f-t")
    out.append('<g%s><rect class="f-pp" x="%d" y="%d" width="%d" height="%d" rx="%d"/>%s</g>' % (A("up", 0.95), px, py, pw, ph, R_PAGE, head))
    for i, (n, tint, w1, w2) in enumerate((("12", "go", 280, 210), ("31", "co", 264, 180), ("8", "pr", 286, 236), ("3", "fe", 250, 150))):
        cy = py + 110 + i * 62
        out.append(ringed(px + 54, cy, n, tint, 1.2 + i * 0.12))
        out.append('<g%s><rect class="f-rule" x="%d" y="%d" width="%d" height="11" rx="5.5"/><rect class="f-rule" x="%d" y="%d" width="%d" height="11" rx="5.5"/></g>'
                   % (A("fade", 1.25 + i * 0.12), px + 90, cy - 14, w1, px + 90, cy + 6, w2))
    return "".join(out)


def team_reports():
    """KickstartChange's report builder: one report per team, fanned like a hand,
    each in the report's own style with its ringed numbers."""
    out = []
    top, h = STAGE_TOP + 10, 320
    pages = [(-14, -110, 0.25, ("go", "co", "pr")), (14, 110, 0.4, ("go", "pr", "co")), (0, 0, 0.55, ("go", "co", "pr"))]
    for idx, (ang, dx, d, tints) in enumerate(pages):
        name, _ = txt("Team %d" % (2, 3, 1)[idx], "serif", 26, 428, top + 50, "f-t")
        inner = ['<rect class="f-pp s-bg" stroke-width="6" x="400" y="%d" width="200" height="%d" rx="%d"/>' % (top, h, R_PAGE), name]
        for r, tint in enumerate(tints):
            cy = top + 106 + r * 70
            num, _ = txt(str((3, 5, 2)[r] + idx), "serif", 20, 440, cy + 7, "f-t", anchor="middle")
            inner.append('<circle class="f-pp s-%s" stroke-width="4" cx="440" cy="%d" r="19"/>%s' % (tint, cy, num))
            inner.append('<rect class="f-rule" x="470" y="%d" width="104" height="10" rx="5"/><rect class="f-rule" x="470" y="%d" width="70" height="10" rx="5"/>' % (cy - 12, cy + 6))
        out.append('<g class="a fan" style="animation-delay:%.2fs;transform:translate(%dpx,%dpx) rotate(%ddeg)">%s</g>'
                   % (d, dx, abs(dx) // 6, ang, "".join(inner)))
    return "".join(out)


def agent():
    """Build your agent: the page's four platform cards, each with its small icon and a way in."""
    glyph = {
        "bot": '<rect x="-14" y="-9" width="28" height="22" rx="6" fill="none" stroke-width="4"/><circle cx="-5" cy="2" r="2.6"/><circle cx="5" cy="2" r="2.6"/>'
               '<path d="M0 -9v-6" stroke-width="4" stroke-linecap="round"/>',
        "chat": '<path d="M-14 -11h28a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H-3l-8 7v-7h-3a4 4 0 0 1-4-4v-13a4 4 0 0 1 4-4z" fill="none" stroke-width="4" stroke-linejoin="round"/>',
        "bolt": '<path d="M3 -16L-10 3h9l-3 14 13-20h-9z" stroke-linejoin="round" stroke-width="2"/>',
        "star": "".join('<path d="M0 0L%.1f %.1f" stroke-width="4" stroke-linecap="round"/>' % (14 * math.cos(math.radians(a)), 14 * math.sin(math.radians(a))) for a in range(-90, 270, 60)),
    }
    out = []
    cards = [(136, 80, "bot", 150), (512, 80, "chat", 128), (136, 260, "bolt", 112), (512, 260, "star", 138)]
    for i, (x, y, g, nw) in enumerate(cards):
        w, h = 352, 160
        body = ['<rect class="f-pp %s" stroke-width="%d" x="%d" y="%d" width="%d" height="%d" rx="18"/>' % ("s-go" if i == 0 else "s-rule", 4 if i == 0 else 3, x, y, w, h, ),
                '<rect class="s-rule" fill="none" stroke-width="3" x="%d" y="%d" width="52" height="52" rx="12"/>' % (x + 26, y + 24),
                '<g class="f-cb s-cb" transform="translate(%d %d)">%s</g>' % (x + 52, y + 50, glyph[g]),
                '<rect class="f-cb" x="%d" y="%d" width="%d" height="18" rx="9"/>' % (x + 26, y + 94, nw),
                '<rect class="f-ae" opacity=".45" x="%d" y="%d" width="%d" height="10" rx="5"/>' % (x + 26, y + 124, nw + 40),
                '<rect class="f-cb" x="%d" y="%d" width="40" height="10" rx="5"/>' % (x + w - 92, y + h - 34),
                '<path class="s-cb" d="M%d %dh18m-7-7l7 7-7 7" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' % (x + w - 44, y + h - 29)]
        out.append('<g%s>%s</g>' % (A("up", 0.2 + i * 0.14), "".join(body)))
    return "".join(out)


def charter():
    """The Six-Sentence Charter: six numbered sentences, three drafted by the tool and
    three left for the sponsor, with the cursor waiting on the first of those."""
    x, y, w, h = 236, 72, 528, 352
    out = ['<g%s><rect class="f-pp" x="%d" y="%d" width="%d" height="%d" rx="%d"/>'
           '<rect class="f-hdr" x="%d" y="%d" width="%d" height="78" rx="%d"/><rect class="f-hdr" x="%d" y="%d" width="%d" height="40"/>'
           '<rect fill="#fff" x="%d" y="%d" width="206" height="16" rx="8"/><rect fill="#fff" opacity=".45" x="%d" y="%d" width="300" height="8" rx="4"/></g>'
           % (A("up", 0.1), x, y, w, h, R_PAGE, x, y, w, R_PAGE, x, y + 38, w, x + 30, y + 22, x + 30, y + 50)]
    widths = (318, 286, 340, 300, 262, 330)
    for i, bw in enumerate(widths):
        cy = y + 112 + i * 40
        num, _ = txt("%02d" % (i + 1), "bold", 15, x + 50, cy + 5.5, "f-pp", anchor="middle")
        badge = '<rect class="f-cb" x="%d" y="%d" width="40" height="26" rx="4"/>%s' % (x + 30, cy - 13, num)
        if i < 3:
            line = '<rect%s x="%d" y="%d" width="%d" height="12" rx="6"/>' % (anim("f-rule", "gr", 0.5 + i * 0.18), x + 88, cy - 6, bw)
        else:
            line = '<rect class="s-ae a fade" style="animation-delay:%.2fs" opacity=".7" x="%d" y="%d" width="%d" height="14" rx="7" fill="none" stroke-width="3" stroke-dasharray="7 7"/>' % (1.1 + (i - 3) * 0.12, x + 88, cy - 7, bw)
        out.append('<g%s>%s</g>%s' % (A("fade", 0.35 + i * 0.1), badge, line))
    out.append('<rect%s x="%d" y="%d" width="5" height="28" rx="2.5"/>' % (anim("f-go", "pop", 1.6), x + 96, y + 112 + 3 * 40 - 14))
    return "".join(out)


def hub(columns):
    """A partner hub's own opening: the gold rule and the three columns,
    Understand, Sell and Demo, each a numbered list of what's inside."""
    out = ['<defs><radialGradient id="hg" cx="85%" cy="0%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".09"/>'
           '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>',
           '<rect x="14" y="14" width="972" height="612" fill="url(#hg)"/>',
           '<rect%s x="76" y="84" width="66" height="5" rx="2.5"/>' % anim("f-go", "gr", 0.2),
           '<rect class="f-hub2" x="76" y="106" width="848" height="2"/>']
    k = 0
    for c, items in enumerate(columns):
        x0 = 76 + c * 290
        out.append('<rect class="f-hub2" x="%d" y="140" width="%d" height="8" rx="4"/>' % (x0, (92, 52, 56)[c]))
        for r, (mark, w) in enumerate(items):
            y = 186 + r * 40
            if mark == ">":
                m = '<path class="s-go" d="M%d %dl7 7-7 7m9-14l7 7-7 7" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' % (x0 + 1, y - 13)
            else:
                m, _ = txt(mark, "bold", 18, x0, y + 1, "f-go")
            out.append('<g%s>%s<rect class="f-hub" x="%d" y="%d" width="%d" height="13" rx="6.5"/></g>' % (A("up", 0.35 + k * 0.06), m, x0 + 40, y - 12, w))
            k += 1
    return "".join(out)


def kc_hub():
    return hub([[("01", 108), (">", 176)],
                [("02", 132), ("03", 158), ("04", 124), ("05", 110), (">", 150)],
                [(">", 182)]])


def wbwai_hub():
    return hub([[("01", 104), ("02", 118), (">", 174)],
                [("03", 136), ("04", 116), ("05", 102), ("06", 120), ("07", 104), (">", 196)],
                [(">", 178), (">", 160)]])


def podium_text():
    """Podium's own hero, in miniature: the headline with its gold italic ending,
    the line about whose IP it is, and the row of facts beneath."""
    out = []
    t, _ = txt("Podium for partners", "bold", 72, 96, 300, "f-t", tracking=-0.015)
    out.append(t)
    l, _ = txt("Your IP. Your brand. Your facilitators.", "serif-italic", 38, 96, 372, "f-s")
    out.append(l)
    left = '<g%s>%s</g>' % (A("up", 0.05), "".join(out))
    rx = 1108
    a, _ = runs([("The ", "regular", 64, "f-t"), ("platform", "bold", 64, "f-t"), (" behind", "regular", 64, "f-t")], rx, 168)
    b, _ = runs([("workshops ", "regular", 64, "f-t"), ("people", "serif-italic", 74, "f-go")], rx, 250)
    c, _ = runs([("remember.", "serif-italic", 74, "f-go")], rx, 332)
    right = ['<g%s>%s%s%s</g>' % (A("up", 0.25), a, b, c),
             '<rect%s x="%d" y="404" width="796" height="2"/>' % (anim("f-hub2", "gr", 0.6), rx)]
    for i, (fact, w) in enumerate((("30 years", 190), ("AI-ready", 170), ("Global", 160))):
        f, _ = txt(fact, "bold", 30, rx + i * 270, 462, "f-t")
        right.append('<g%s>%s<rect class="f-hub2" x="%d" y="482" width="%d" height="9" rx="4.5"/></g>' % (A("up", 0.8 + i * 0.12), f, rx + i * 270, w))
    return left + "".join(right)


def sketchbook():
    """The sketchbook's own opening: a quiet square map where a room's dots gather,
    one of them in gold."""
    x0, y0, S = 1392, 76, 488
    X = lambda u: x0 + u * S
    Y = lambda v: y0 + v * S
    out = ['<rect class="s-rule" x="%d" y="%d" width="%d" height="%d" fill="none" stroke-width="3"/>' % (x0, y0, S, S),
           '<path class="s-rule" d="M%d %dV%dM%d %dH%d" stroke-width="3"/>' % (X(.5), y0, y0 + S, x0, Y(.5), x0 + S)]
    dots = [(.22, .16), (.25, .36), (.31, .32),
            (.72, .14), (.77, .12), (.81, .14), (.74, .2), (.79, .21), (.83, .19), (.7, .37), (.73, .34), (.76, .36), (.68, .4),
            (.2, .6), (.3, .66), (.21, .63),
            (.71, .58), (.74, .62), (.77, .6), (.73, .65), (.76, .8), (.77, .83)]
    for i, (u, v) in enumerate(dots):
        out.append('<circle%s cx="%.1f" cy="%.1f" r="10"/>' % (anim("f-cb", "pop", 0.25 + i * 0.04), X(u), Y(v)))
    out.append('<circle%s cx="%.1f" cy="%.1f" r="11"/>' % (anim("f-go", "pop", 1.3), X(.795), Y(.165)))
    return "".join(out)


def room_pulse():
    """Room Pulse's own front-page map, redrawn: the same demo room, the same corners,
    hills and words. The room lands where it started, holds, then everyone moves."""
    data = json.load(open(os.path.join(HERE, "data", "room-pulse-hero.json")))
    S, x0, y0 = 536, 1398, 52
    X = lambda x: x0 + (x + 1) / 2 * S
    Y = lambda y: y0 + (1 - y) / 2 * S
    corners = {"TL": (216, 101, 39), "TR": (104, 191, 189), "BL": (88, 106, 144), "BR": (144, 178, 16)}

    def hexc(rgb):
        return "#%02X%02X%02X" % rgb

    def lin_mix(a, b):
        f = lambda c: (c / 255) ** 2.2
        g = lambda v: round(255 * v ** (1 / 2.2))
        return tuple(g((f(p) + f(q)) / 2) for p, q in zip(a, b))

    defs = []
    # the terrain's colour: each corner's own hue, blended only near the axes
    for name, (l, r) in (("rt", ("TL", "TR")), ("rb", ("BL", "BR"))):
        defs.append('<linearGradient id="%s" gradientUnits="userSpaceOnUse" x1="%.1f" y1="0" x2="%.1f" y2="0">'
                    '<stop offset="0" stop-color="%s"/><stop offset=".5" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>'
                    % (name, X(-.32), X(.32), hexc(corners[l]), hexc(lin_mix(corners[l], corners[r])), hexc(corners[r])))
    defs.append('<linearGradient id="rv" gradientUnits="userSpaceOnUse" x1="0" y1="%.1f" x2="0" y2="%.1f">'
                '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
                '<mask id="rm"><rect x="%d" y="%d" width="%d" height="%d" fill="url(#rv)"/></mask>' % (Y(.32), Y(-.32), x0, y0, S, S))
    # a faint wash of each corner's colour, as on the tool's frame
    for q, (cxp, cyp) in (("TL", (x0, y0)), ("TR", (x0 + S, y0)), ("BL", (x0, y0 + S)), ("BR", (x0 + S, y0 + S))):
        defs.append('<radialGradient id="w%s" gradientUnits="userSpaceOnUse" cx="%d" cy="%d" r="%.1f">'
                    '<stop offset="0" stop-color="%s" stop-opacity=".16"/><stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>'
                    % (q, cxp, cyp, S * .66, hexc(corners[q]), hexc(corners[q])))
    out = ['<defs>%s</defs>' % "".join(defs),
           '<clipPath id="rc"><rect x="%d" y="%d" width="%d" height="%d"/></clipPath>' % (x0, y0, S, S),
           '<g clip-path="url(#rc)">']
    out += ['<rect x="%d" y="%d" width="%d" height="%d" fill="url(#w%s)"/>' % (x0, y0, S, S, q) for q in corners]

    def rings_d(rings):
        return "".join("M" + "L".join("%.1f %.1f" % (X(px), Y(py)) for px, py in r) + "Z" for r in rings)

    band = [.17, .169, .217, .296]          # stacked, these give the tool's band strengths .17 .31 .46 .62
    iso = [.24, .31, .38, .46]

    def terrain(levels, tag):
        shapes, g = [], []
        for k, rings in enumerate(levels):
            if rings:
                shapes.append('<path id="%s%d" d="%s" fill-rule="evenodd"/>' % (tag, k, rings_d(rings)))
                g.append('<g opacity="%.3f"><use href="#%s%d" fill="url(#rb)"/><use href="#%s%d" fill="url(#rt)" mask="url(#rm)"/></g>'
                         % (band[k], tag, k, tag, k))
        for k, rings in enumerate(levels):
            if rings:
                g.append('<use href="#%s%d" class="s-iso" fill="none" stroke-width="2.4" stroke-linejoin="round" opacity="%.2f"/>' % (tag, k, iso[k]))
        return '<defs>%s</defs>%s' % ("".join(shapes), "".join(g))

    out.append('<g class="a ta" style="opacity:0">%s</g>' % terrain(data["hillsA"], "ha"))
    out.append('<g class="a tb">%s</g>' % terrain(data["hillsB"], "hb"))
    out.append('</g>')
    # axes, border and the measured ticks
    m = S / 2
    out.append('<path class="s-ax" d="M%d %dV%dM%d %dH%d" stroke-width="2.2"/>' % (x0 + m, y0, y0 + S, x0, y0 + m, x0 + S))
    ticks = []
    for k in range(1, 8):
        p, L = S * k / 8, S * (.012 if k % 2 else .022)
        ticks.append("M%.1f %dv%.1fM%.1f %dv-%.1fM%d %.1fh%.1fM%d %.1fh-%.1f" % (x0 + p, y0, L, x0 + p, y0 + S, L, x0, y0 + p, L, x0 + S, y0 + p, L))
    out.append('<path class="s-tk" d="%s" stroke-width="2.4"/>' % "".join(ticks))
    out.append('<rect class="s-bd" x="%d" y="%d" width="%d" height="%d" fill="none" stroke-width="3"/>' % (x0, y0, S, S))
    # corner names and the eight feeling words, set in Archivo as the tool sets them
    for q, label, (lx, ly, anc) in (("tl", "TENSE", (x0 + 18, y0 + 34, "start")), ("tr", "ENERGIZED", (x0 + S - 18, y0 + 34, "end")),
                                     ("bl", "DRAINED", (x0 + 18, y0 + S - 18, "start")), ("br", "SETTLED", (x0 + S - 18, y0 + S - 18, "end"))):
        p, _ = txt(label, "archivo-bold", 19, lx, ly, "q-" + q, anchor=anc, tracking=.08)
        out.append(p)
    # the people: each lands where they first stood, then moves to where they ended
    kf = []
    for i, ((ax, ay), (bx, by)) in enumerate(zip(data["A"], data["B"])):
        dx, dy = X(ax) - X(bx), Y(ay) - Y(by)
        kf.append("@keyframes p%d{0%%{transform:translate(%.1fpx,%.1fpx) scale(0)}10%%{transform:translate(%.1fpx,%.1fpx) scale(1)}"
                  "50%%{transform:translate(%.1fpx,%.1fpx)}74%%,100%%{transform:translate(0,0)}}" % (i, dx, dy, dx, dy, dx, dy))
        dot = ('<circle class="f-go s-cb" stroke-width="3" cx="%.1f" cy="%.1f" r="11"/>' if i == 3 else
               '<circle class="f-cb" cx="%.1f" cy="%.1f" r="7"/>') % (X(bx), Y(by))
        out.append('<g class="a" style="animation:p%d 4.8s cubic-bezier(.45,0,.2,1) %.2fs both;transform-box:fill-box;transform-origin:50%% 50%%">%s</g>'
                   % (i, .15 + i * .025, dot))
    # you, in EP gold, with a ring where you started
    ax, ay = data["A"][3]
    out.append('<circle class="s-cb a fade" style="animation-delay:3.7s" cx="%.1f" cy="%.1f" r="11" fill="none" stroke-width="3" stroke-dasharray="4 5"/>' % (X(ax), Y(ay)))
    for w in data["words"]:
        c = data["countsB"][data["words"].index(w)]
        face = "archivo-bold" if w["w"] in data["boldB"] else "archivo"
        p, _ = txt(w["w"], face, 30, X(w["x"]), Y(w["y"]) + 10, "f-t halo" + ("" if c else " w-none"), anchor="middle")
        out.append(p)
    css = ("".join(kf)
           + "@keyframes ta{0%{opacity:0}12%,50%{opacity:1}72%,100%{opacity:0}}@keyframes tb{0%,50%{opacity:0}74%,100%{opacity:1}}"
           + ".ta{animation:ta 4.8s ease both}.tb{animation:tb 4.8s ease both}"
           + ".s-iso{stroke:#293851}.s-ax{stroke:rgba(14,16,18,.16)}.s-tk{stroke:rgba(14,16,18,.38)}.s-bd{stroke:rgba(14,16,18,.34)}"
           + ".q-tl{fill:#AE4A15}.q-tr{fill:#27706D}.q-bl{fill:#4A5B80}.q-br{fill:#5A6F06}.w-none{opacity:.38}"
           + ".halo{stroke:rgba(249,246,246,.75);stroke-width:7px;stroke-linejoin:round;paint-order:stroke}"
           + "@media (prefers-color-scheme:dark){.s-iso{stroke:#D5D9E3}.s-ax{stroke:rgba(255,255,255,.18)}.s-tk{stroke:rgba(255,255,255,.4)}"
           + ".s-bd{stroke:rgba(255,255,255,.36)}.halo{stroke:rgba(30,37,52,.75)}.q-tl{fill:#EE9A6A}.q-tr{fill:#86D3D1}.q-bl{fill:#AEBBDA}.q-br{fill:#B9D449}}")
    return "".join(out), css


def banner():
    W, H = 2000, 560
    out = []
    # the house circle cluster, anchored bottom right and running off the edges
    circles = [(1840, 478, 196, "gw"), (1652, 330, 122, "co"), (1908, 196, 108, "pr"), (1556, 520, 86, "gw"),
               (1748, 118, 72, "co"), (1468, 368, 52, "pr"), (1990, 34, 64, "gw")]
    for i, (cx, cy, r, col) in enumerate(circles):
        out.append('<circle%s cx="%d" cy="%d" r="%d"/>' % (anim("f-" + col, "pop", 0.25 + i * 0.12), cx, cy, r))
    for i, (cx, cy, r, col) in enumerate(((1404, 246, 12, "ae"), (1552, 178, 8, "gw"), (1520, 262, 7, "fe"), (1626, 40, 9, "co"))):
        out.append('<circle%s cx="%d" cy="%d" r="%d"/>' % (anim("f-" + col, "pop", 1.2 + i * 0.1), cx, cy, r))
    t, _ = txt("What we're building", "bold", 104, 104, 268, "f-t", tracking=-0.02)
    body = ['<g%s>%s' % (A("up", 0.05), t)]
    for i, ln in enumerate(("Live tools, partner hubs and experiments", "from ExperiencePoint.")):
        p, _ = txt(ln, "serif-italic", 46, 106, 352 + i * 62, "f-s")
        body.append(p)
    body.append("</g>")
    return doc(W, H, "paper", "What we're building: live tools, partner hubs and experiments from ExperiencePoint.",
               "".join(out) + "".join(body))


# ---------------------------------------------------------------- cards

# ---------------------------------------------------------------- cards

def half(slug, family, title, line, motif, extra="", line_face="serif"):
    write(slug, doc(1000, 640, family, "%s. %s" % (title, line), motif + half_text(title, line, line_face), extra))


def wide(slug, family, title, line, motif, extra="", **text):
    write(slug, doc(2000, 640, family, "%s. %s" % (title, line), motif + wide_text(title, line, **text), extra))


def write(slug, svg):
    with open(os.path.join(OUT, slug + ".svg"), "w") as f:
        f.write(svg)
    print("%-26s %6.1f KB" % (slug, len(svg.encode()) / 1024))


if __name__ == "__main__":
    write("banner", banner())
    rp, rp_css = room_pulse()
    wide("room-pulse", "paper", "Room Pulse",
         "Everyone picks the feeling that fits. You show the room where it stands, then how it moved.", rp, rp_css)
    pp, pp_css = pair_poll()
    half("pair-poll", "paper", "Pair Poll", "Two contrasting statements. Everyone picks a side. You reveal the split.", pp, pp_css)
    half("place-your-chips", "blue", "Place Your Chips", "Deal silently. Reveal together. Change your mind out loud.", chips())
    half("sponsor-reports", "green", "Sponsor reports", "Turns a WBWAI 201 CSV into a sponsor-ready report.", sponsor_reports())
    half("team-reports", "warm", "Team reports", "Turns a KickstartChange CSV into team-by-team reports.", team_reports())
    half("first-agent", "blue", "Create Your First Agent", "One real working agent, on the platform your team uses.", agent())
    half("champion-charter", "paper", "The Six-Sentence Charter", "Helps sponsors draft a charter for their AI champions.", charter())
    half("kickstartchange", "cobalt", "KickstartChange",
         "Everything to position, propose and sell it, in one place.", kc_hub(), line_face="serif-italic")
    half("work-better-with-ai", "cobalt", "Work Better with AI 201",
         "Everything to position, propose and sell it, in one place.", wbwai_hub(), line_face="serif-italic")
    write("podium-for-partners", doc(2000, 640, "cobalt", "Podium for partners. The platform behind workshops people remember.", podium_text()))
    wide("podium-pulse-sketchbook", "paper", "Podium Pulse sketchbook",
         "A check-in that bookends a session: how a room arrives, how it leaves, and the moment it sees the difference.",
         sketchbook(), title_face="serif", line_face="serif-italic", gold_dot=True)

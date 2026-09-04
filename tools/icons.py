#!/usr/bin/env python3
"""
App icons, one mark per game.

Each mark is the smallest complete statement of its game — not a logo with a
name in it, and not a screenshot. It has to survive being cropped to a circle
by Android and shrunk to 192px, so everything is geometry and nothing is text
except where the number IS the mechanic.

Regenerate:  python3 tools/icons.py            (every game)
             python3 tools/icons.py arrows     (just one)

Needs Pillow. Colours are the studio tokens from packages/ui/src/tokens.css and
the per-game hues from identity.css — keep them in step by hand; there is no
build step that reads CSS from Python and there should not be one for three
constants.
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (242, 240, 236)     # --s-bg
INK = (23, 23, 26)       # --s-ink
WHITE = (255, 255, 255)  # --s-surface

ACCENT = {
    'bridges': (180, 71, 47),    # #b4472f
    'arrows': (122, 75, 150),    # #7a4b96
    'twostars': (138, 100, 16),  # #8a6410, the starbattle hue
    'loop': (51, 88, 140),       # #33588c, the slitherlink hue
}
# Arrows draws in its own warm maze ink rather than the text colour.
LINE = (74, 59, 40)          # --s-line
LINE_SOFT = (160, 142, 117)  # --s-line-soft

SUPERSAMPLE = 4
ROOT = os.path.join(os.path.dirname(__file__), '..')
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
]


def find_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def bridges_mark(d, s, c, k):
    """Two islands needing two bridges each, joined by a double bridge. The
    smallest complete Bridges solution, and it belongs to no other game."""
    r = k * 0.145
    gap = k * 0.275
    outline = max(2, int(k * 0.030))
    sep = k * 0.055
    bridge = int(k * 0.040)

    for dy in (-sep, sep):
        d.line([(c - gap, c + dy), (c + gap, c + dy)], fill=ACCENT['bridges'], width=bridge)

    font_path = find_font()
    font = ImageFont.truetype(font_path, int(r * 1.28)) if font_path else None
    for dx in (-gap, gap):
        d.ellipse([dx + c - r, c - r, dx + c + r, c + r], fill=WHITE, outline=INK, width=outline)
        if font:
            d.text((dx + c, c), '2', font=font, fill=INK, anchor='mm')


def arrows_mark(d, s, c, k):
    """One path leaving: a pale tail that turns a corner, and a head already
    clear of it. The whole rule of the game in one stroke — the head is what
    decides and the tail costs nothing, so the head is the loud part.

    Drawn in a unit square and then fitted, because an icon that drifts off
    centre is the sort of thing nobody notices until it is on a home screen
    next to thirty that do not."""
    # The tail runs UNDER the head's back edge, so the two read as one path
    # rather than a line standing next to a triangle.
    TAIL = [(0.06, 0.88), (0.06, 0.30), (0.64, 0.30)]
    TIP = (0.98, 0.30)
    BACK_X, HALF = 0.58, 0.18
    WIDTH = 0.145

    xs = [p[0] for p in TAIL] + [TIP[0], BACK_X]
    ys = [p[1] for p in TAIL] + [TIP[1], TIP[1] - HALF, TIP[1] + HALF]
    lo_x, hi_x = min(xs) - WIDTH / 2, max(xs)
    lo_y, hi_y = min(ys), max(ys) + WIDTH / 2
    scale = k / max(hi_x - lo_x, hi_y - lo_y)
    off_x = c - (lo_x + hi_x) / 2 * scale
    off_y = c - (lo_y + hi_y) / 2 * scale

    def at(p):
        return (p[0] * scale + off_x, p[1] * scale + off_y)

    w = max(2, int(WIDTH * scale))
    d.line([at(p) for p in TAIL], fill=LINE_SOFT, width=w, joint='curve')
    # PIL leaves square ends on a polyline; the body has rounded caps.
    for p in (TAIL[0], TAIL[-1]):
        x, y = at(p)
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=LINE_SOFT)

    d.polygon(
        [at(TIP), at((BACK_X, TIP[1] - HALF)), at((BACK_X, TIP[1] + HALF))],
        fill=ACCENT['arrows'],
    )


def _star(cx, cy, r):
    """Five points, one up. Same geometry as the star in GameLogo."""
    import math
    pts = []
    for k in range(10):
        radius = r if k % 2 == 0 else r * 0.42
        a = math.radians(-90 + k * 36)
        pts.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    return pts


def twostars_mark(d, s, c, k):
    """Two stars that do not touch — the rule, and the reason the game is
    called what it is. The gap between them is the mark."""
    big, small = k * 0.24, k * 0.175
    d.polygon(_star(c - k * 0.17, c - k * 0.15, big), fill=ACCENT['twostars'])
    d.polygon(_star(c + k * 0.20, c + k * 0.19, small), fill=ACCENT['twostars'])


def loop_mark(d, s, c, k):
    """One closed loop threaded through a lattice of dots.

    The dots go on TOP of the line, which is how a Slitherlink board actually
    looks: the lattice is what is there before anyone draws anything, and the
    loop runs from dot to dot. Drawn under the line they simply vanish, which
    is what the first version did — it read as a plain blue shape."""
    PATH = [(0.0, 0.0), (0.5, 0.0), (0.5, 0.5), (1.0, 0.5), (1.0, 1.0), (0.0, 1.0)]
    # Inset, so the loop does not run into the edge of the icon.
    scale = k * 0.82
    ox, oy = c - scale / 2, c - scale / 2
    width = max(2, int(scale * 0.11))
    pts = [(x * scale + ox, y * scale + oy) for x, y in PATH]

    d.line(pts + [pts[0]], fill=ACCENT['loop'], width=width, joint='curve')
    for x, y in pts:
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=ACCENT['loop'])

    r = scale * 0.045
    for gx in (0.0, 0.5, 1.0):
        for gy in (0.0, 0.5, 1.0):
            x, y = gx * scale + ox, gy * scale + oy
            d.ellipse([x - r, y - r, x + r, y + r], fill=INK)


MARKS = {
    'bridges': bridges_mark,
    'arrows': arrows_mark,
    'twostars': twostars_mark,
    'loop': loop_mark,
}


def mark(game, size, content=1.0):
    """`content` shrinks the drawing for the maskable variant, which the OS crops."""
    s = size * SUPERSAMPLE
    img = Image.new('RGB', (s, s), BG)
    d = ImageDraw.Draw(img)
    MARKS[game](d, s, s / 2, s * content)
    return img.resize((size, size), Image.LANCZOS)


def write(game):
    out = os.path.join(ROOT, 'games', game, 'public')
    os.makedirs(out, exist_ok=True)
    print(game)
    for name, img in [
        ('icon-192.png', mark(game, 192)),
        ('icon-512.png', mark(game, 512)),
        # Maskable icons get cropped to a circle, so everything sits in the safe zone.
        ('icon-maskable.png', mark(game, 512, content=0.70)),
    ]:
        path = os.path.join(out, name)
        img.save(path)
        print(f'  {name:20} {img.size[0]}x{img.size[1]}  {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    games = sys.argv[1:] or sorted(MARKS)
    for g in games:
        if g not in MARKS:
            raise SystemExit(f'no mark for "{g}" — add one to MARKS')
        write(g)

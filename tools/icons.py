#!/usr/bin/env python3
"""
Bridges app icons.

The mark is the smallest complete Bridges solution: two islands needing two
bridges each, joined by a double bridge. It is a solved puzzle, it is legible
at 192px, and it belongs to no other game.

Regenerate:  python3 tools/icons.py
Needs Pillow. Colours are the studio tokens from packages/ui/src/tokens.css.
"""

import os
from PIL import Image, ImageDraw, ImageFont

BG = (242, 240, 236)   # --s-bg
INK = (23, 23, 26)     # --s-ink
WHITE = (255, 255, 255)  # --s-surface
ACCENT = (180, 71, 47)   # --s-accent

SUPERSAMPLE = 4
OUT = os.path.join(os.path.dirname(__file__), '..', 'games', 'bridges', 'public')
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


def mark(size, content=1.0):
    """`content` shrinks the drawing for the maskable variant, which the OS crops."""
    s = size * SUPERSAMPLE
    img = Image.new('RGB', (s, s), BG)
    d = ImageDraw.Draw(img)
    c = s / 2
    k = s * content

    r = k * 0.145
    gap = k * 0.275
    outline = max(2, int(k * 0.030))
    sep = k * 0.055
    bridge = int(k * 0.040)

    for dy in (-sep, sep):
        d.line([(c - gap, c + dy), (c + gap, c + dy)], fill=ACCENT, width=bridge)

    font_path = find_font()
    font = ImageFont.truetype(font_path, int(r * 1.28)) if font_path else None
    for dx in (-gap, gap):
        d.ellipse([dx + c - r, c - r, dx + c + r, c + r], fill=WHITE, outline=INK, width=outline)
        if font:
            d.text((dx + c, c), '2', font=font, fill=INK, anchor='mm')

    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, img in [
        ('icon-192.png', mark(192)),
        ('icon-512.png', mark(512)),
        # Maskable icons get cropped to a circle, so everything sits in the safe zone.
        ('icon-maskable.png', mark(512, content=0.70)),
    ]:
        path = os.path.join(OUT, name)
        img.save(path)
        print(f'{name:20} {img.size[0]}x{img.size[1]}  {os.path.getsize(path)} bytes')

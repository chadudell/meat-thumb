"""Cut the seven Meat Thumb states and the title lettering out of the
on-model sketch sheet (art/meat-thumb-sheet-v2.png; v1 kept for reference), knock out the paper,
and register every hand on one shared canvas so the UI can crossfade them.

    python3 art/extract.py      # needs pillow, numpy, scipy
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / 'art' / 'meat-thumb-sheet-v2.png'
OUT = ROOT / 'assets'

# (name, crop box on the sheet, fist top-right corner on the sheet, scale)
# The second row is drawn ~15% larger; scaling by fist size keeps the hand
# registered so states crossfade without ghosting (max meat stays bigger
# because the thumb itself is bigger, not the drawing).
STATES = [
    ('01-clean', (20, 125, 335, 565), (289, 355), 1.0),
    ('02-sub-bass', (335, 125, 655, 565), (604, 367), 1.0),
    ('03-fat-filter', (655, 125, 980, 565), (941, 370), 1.0),
    ('04-resonance', (980, 125, 1305, 565), (1270, 377), 1.0),
    ('05-overdrive', (15, 625, 405, 1125), (361, 893), 0.87),
    ('06-reverb', (400, 625, 812, 1125), (712, 872), 0.87),
    ('07-max-meat', (805, 615, 1305, 1128), (1258, 882), 0.87),
]
CANVAS = (600, 476)
ANCHOR = (470, 256)  # where every fist's top-right corner lands


def knock_out(rgb, paper):
    """Paper → transparent, with the paper colour un-mixed from soft edges."""
    diff = np.abs(rgb - paper).max(axis=2)
    alpha = np.clip((diff - 10) / 45, 0, 1)
    a = alpha[..., None]
    colour = np.where(a > 0.01, (rgb - (1 - a) * paper) / np.maximum(a, 0.01), 0)
    return np.clip(colour, 0, 255), alpha


def keep_components(alpha, drop):
    lab, n = ndimage.label(alpha > 0.25)
    keep = np.zeros(n + 1, bool)
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        keep[i] = not drop(sl)
    mask = ndimage.binary_dilation(keep[lab], iterations=2)
    return alpha * mask, lab, keep


def main():
    sheet = np.asarray(Image.open(SHEET).convert('RGB')).astype(float)
    paper = np.median(sheet[:12, :12].reshape(-1, 3), axis=0)
    (OUT / 'thumbs').mkdir(parents=True, exist_ok=True)

    for name, (x0, y0, x1, y1), fist, scale in STATES:
        rgb = sheet[y0:y1, x0:x1]
        colour, alpha = knock_out(rgb, paper)
        # Title drips poke into the top of the first row: drop anything touching the top edge.
        alpha, _, _ = keep_components(alpha, lambda sl: sl[0].start == 0)
        rgba = np.dstack([colour, alpha * 255]).astype(np.uint8)
        img = Image.fromarray(rgba)
        if scale != 1:
            img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
        ox = round(ANCHOR[0] - (fist[0] - x0) * scale)
        oy = round(ANCHOR[1] - (fist[1] - y0) * scale)
        canvas = Image.new('RGBA', CANVAS)
        canvas.alpha_composite(img, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
        clipped = ox < 0 or oy < 0 or ox + img.width > CANVAS[0] or oy + img.height > CANVAS[1]
        canvas.save(OUT / 'thumbs' / f'{name}.webp', quality=88, method=6)
        print(f'{name}: offset ({ox},{oy}){"  CLIPPED" if clipped else ""}')

    # Title lettering ("MEAT THUMB") — red on white is what it already is; just lose the paper.
    rgb = sheet[0:178, 55:1062]
    colour, alpha = knock_out(rgb, paper)
    # Keep the scratch marks either side; drop the thumb tips poking up from below.
    alpha, _, _ = keep_components(alpha, lambda sl: sl[0].stop == alpha.shape[0])
    out = np.dstack([colour, alpha * 255]).astype(np.uint8)
    Image.fromarray(out).save(OUT / 'meat-thumb-title.webp', quality=90, method=6)
    print('title', out.shape)

    # Wordmark: the same lettering printed in one butcher-red ink on white —
    # luminance mapped onto an oxblood → red → pink duotone, so the drips,
    # outline and highlights all survive without the black.
    lum = colour @ np.array([0.299, 0.587, 0.114])
    t = np.clip((lum - 25) / 200, 0, 1)[..., None]
    oxblood, red, pink = (np.array(c, float) for c in ((92, 8, 16), (212, 33, 41), (250, 214, 208)))
    ink = np.where(t < 0.5, oxblood + (red - oxblood) * (t / 0.5), red + (pink - red) * ((t - 0.5) / 0.5))
    out = np.dstack([ink, alpha * 255]).astype(np.uint8)
    Image.fromarray(out).save(OUT / 'meat-thumb-wordmark.webp', quality=90, method=6)


if __name__ == '__main__':
    main()

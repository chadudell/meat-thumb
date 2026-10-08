"""Bake the faceplate's grime textures into tileable PNGs (assets/textures/).

They used to be inline SVG feTurbulence filters, which WebKit recomputes on
every repaint of anything sitting on top of them — tiny meter updates were
costing ~90% of a core. Rasters repaint for free.

    python3 art/textures.py      # needs numpy, scipy, pillow
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'textures'
rng = np.random.default_rng(7)


def noise(h, w, sigma, octaves=3):
    """Tileable fractal-ish noise, mean 0.5, roughly fractalNoise's spread."""
    total = np.zeros((h, w))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        s = (sigma[0] / 2 ** o, sigma[1] / 2 ** o)
        n = ndimage.gaussian_filter(rng.standard_normal((h, w)), s, mode='wrap')
        total += amp * n / (n.std() + 1e-9)
        norm += amp
        amp *= 0.5
    total /= norm
    return 0.5 + 0.14 * total / (total.std() + 1e-9)


def save(name, rgb, alpha):
    a = np.clip(alpha, 0, 1)
    img = np.dstack([np.broadcast_to(np.array(rgb) * 255, a.shape + (3,)), a * 255]).astype(np.uint8)
    Image.fromarray(img).save(OUT / f'{name}.png', optimize=True)
    print(name, img.shape, f'{(OUT / f"{name}.png").stat().st_size // 1024}KB')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Fine grain over everything.
    save('grain', (0.35, 0.25, 0.15), 0.16 * noise(256, 256, (0.7, 0.7), 2) * 1.0)
    # Big soft grime blotches.
    save('blotch', (0.36, 0.24, 0.12), 1.6 * noise(400, 600, (40, 60), 4) - 0.78)
    # Long horizontal scratches / wipe marks.
    scratch = noise(500, 700, (0.8, 140), 2)
    save('scratch', (1.0, 0.98, 0.94), 0.75 * scratch - 0.45 + 0.75 * np.clip(scratch - 0.78, 0, 1) * 2)
    # Chipped paint on the red header strips.
    save('chip', (0.98, 0.93, 0.85), 4 * noise(60, 260, (2.5, 1.2), 3) - 2.55)
    # Wear mask for the rubber stamps (opaque with holes).
    save('worn', (0, 0, 0), -6 * noise(120, 200, (1.4, 1.4), 3) + 4.9)


if __name__ == '__main__':
    main()

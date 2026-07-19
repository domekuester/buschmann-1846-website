#!/usr/bin/env python3
"""Buschmann 1846 — Bildpipeline.

Erzeugt aus 01-originalfotos/ optimierte Webbilder (WebP + JPG-Fallback,
mehrere Breiten) nach assets/img/. Die Originale werden nie verändert.

Aufruf aus dem Projektstamm:  python3 03-webbilder/build-images.py
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "01-originalfotos"
OUT = ROOT / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)

# name -> (quelldatei, crop-box oder None, liste der zielbreiten)
# crop-box = (left, top, right, bottom) im Original
JOBS = {
    "hero":           ("P1360101.jpg", None,                    [1200, 2000]),
    "hero-mobile":    ("P1360101.jpg", (1120, 0, 2870, 2665),   [750, 1400]),
    "claudia":        ("Claudia.jpg",  (950, 400, 2630, 2500),  [800, 1200]),
    "window-team":    ("P1360788.jpg", (0, 250, 2651, 2650),    [600, 1200]),
    "machine":        ("P1360191.jpg", None, [800, 1200]),
    "copper":         ("P1360329.jpg", None, [800, 1200]),
    "cake":           ("P1360096.jpg", None, [800, 1200]),
    "cherries":       ("P1360370.jpg", None, [800, 1200]),
    "pour":           ("P1360272.jpg", None, [800, 1200]),
    "hands":          ("P1360346.jpg", None, [800, 1200]),
    "barista":        ("P1360057.jpg", None, [800, 1200]),
    "almonds":        ("P1360218.jpg", None, [600, 1200]),
    "piping":         ("P1360326.jpg", None, [600, 1200]),
    "window-outside": ("P1360109.jpg", None, [600, 1200]),
    "butter":         ("P1360381.jpg", None, [600, 1200]),
}

def export(im: Image.Image, stem: str, width: int) -> None:
    scaled = im.resize(
        (width, round(im.height * width / im.width)), Image.LANCZOS
    )
    scaled.save(OUT / f"{stem}-{width}.webp", "WEBP", quality=78, method=6)
    scaled.save(OUT / f"{stem}-{width}.jpg", "JPEG", quality=82,
                progressive=True, optimize=True)

for stem, (src, box, widths) in JOBS.items():
    im = ImageOps.exif_transpose(Image.open(SRC / src)).convert("RGB")
    if box:
        im = im.crop(box)
    for w in widths:
        export(im, stem, w)
    print(f"{stem}: {im.width}x{im.height} -> {widths}")

# Social-Preview 1200x630 aus dem Fassadenfoto (Schriftzug im Bild)
im = ImageOps.exif_transpose(Image.open(SRC / "P1360101.jpg")).convert("RGB")
im.crop((0, 285, 3990, 2380)).resize((1200, 630), Image.LANCZOS).save(
    OUT / "og-image.jpg", "JPEG", quality=85, progressive=True, optimize=True)

# Logo (bereinigte transparente Fassung) + Favicons
logo = Image.open(ROOT / "04-logo" / "buschmann-logo-transparent.png")
logo.save(OUT / "logo.png")
for size, name in ((180, "apple-touch-icon.png"), (48, "favicon-48.png")):
    fav = logo.copy()
    fav.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(fav, ((size - fav.width) // 2, (size - fav.height) // 2), fav)
    canvas.save(OUT / name)
print("og-image, logo, favicons ok")

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
    # Mobil 4:5 um die Gebäudeachse: Schriftzug, Tür und die Gäste bleiben drin.
    "hero-mobile":    ("P1360101.jpg", (929, 0, 3061, 2665),    [750, 1400]),
    "claudia":        ("Claudia.jpg",  (950, 400, 2630, 2500),  [800, 1200]),
    # Eng auf die Begegnung: beide Gesichter liegen bei rund 45 % Höhe, die
    # tote Fläche über den Köpfen ist weg, vom Leuchtpfeil bleibt nur noch
    # ein Rest als Kontext. Untere Spiegelungsscheibe weg (Regel 4).
    # Seitenverhältnis 0,62 — entspricht dem Anzeigefenster in der Galerie.
    "window-team":    ("P1360788.jpg", (629, 950, 1571, 2470),  [600, 1200]),
    "machine":        ("P1360191.jpg", None, [800, 1200]),
    "copper":         ("P1360329.jpg", None, [800, 1200]),
    "cake":           ("P1360096.jpg", None, [800, 1200]),
    "cherries":       ("P1360370.jpg", None, [800, 1200]),
    "pour":           ("P1360272.jpg", None, [800, 1200]),
    "hands":          ("P1360346.jpg", None, [800, 1200]),
    "barista":        ("P1360057.jpg", None, [800, 1200]),
    "almonds":        ("P1360218.jpg", None, [600, 1200]),
    # Enger auf die Tätigkeit: Kopf, Hände und Kanne bleiben zusammen im
    # Bild, die leere Kachelwand links und der dunkle Boden fallen weg.
    "piping":         ("P1360326.jpg", (321, 0, 2538, 3600), [600, 1200]),
    "window-outside": ("P1360109.jpg", None, [600, 1200]),
    "butter":         ("P1360381.jpg", None, [600, 1200]),

    # ---- Eigene Mobilcrops -------------------------------------------------
    # Auf schmalen Displays steht jedes dieser Motive in einer halbbreiten
    # Spalte. Das Anzeigefenster ist dort schmaler als das Quellformat, also
    # beschneidet object-fit nur seitlich und lässt die volle Bildhöhe stehen —
    # genau die toten Zonen (Fensterbank, Boden, dunkle Maschinenfläche), die
    # mobil nicht gezeigt werden dürfen. Deshalb bekommen die beiden Motive
    # mit Menschen einen echten, eng gerechneten Ausschnitt.

    # Claudia: bewusst weiter gefasst als zuvor (war 610 × 1020 im Verhältnis
    # 0,598 — eine sehr enge Gesichtsaufnahme). Gemessen am Original
    # (2664 × 3988): ihr Kopf liegt bei y 880–1150, das Gesicht bei x≈1620,
    # der Fensterpfosten bei x 1900–2050. Der neue 4:5-Ausschnitt zeigt Kopf,
    # Oberkörper und Fenstersituation gemeinsam; vom Gast bleibt links ein
    # schmaler Streifen als Gesprächskontext, ohne zu dominieren. Die
    # Glitzerhose unterhalb y 2000 bleibt draußen.
    "claudia-m":      ("Claudia.jpg",  (1120, 690, 2110, 1928),  [400, 800]),
    # Louis am Kaffee: Kopf, Schulter, Hand mit Kanne und die linke Hälfte der
    # Maschine bleiben zusammen. Der dunkle Boden und die leere rechte
    # Maschinenfläche sind raus — keine reine Gerätefläche mehr.
    "barista-m":      ("P1360057.jpg", (100, 336, 1336, 2400),   [300, 600]),

    # Kaffeemaschine — Materialdetail für die Bildstrecke. Das Original ist
    # bereits 2:3 (1401 × 2101). Der obere Rand ist unscharfes, dunkles
    # Maschinengehäuse und fällt weg; Brühgruppe, Dampflanze, Typenschild und
    # Abtropfgitter bleiben vollständig.
    "coffee":         ("Kaffemaschine.jpg", (60, 180, 1341, 2101),  [400, 800]),
    # Mobil steht das Bild in einer schmalen Spalte neben dem Fensterteam.
    # Enger auf Brühgruppe und Lanze, damit das Chrom auch auf 106 px trägt.
    "coffee-m":       ("Kaffemaschine.jpg", (300, 500, 1100, 2101), [300, 600]),

    # Tyll Schulte in der Backstube.
    # Gemessen am Original (2672 × 4000): Haaransatz y≈280, Kinn y≈1500,
    # Nasenspitze x≈300, Schürzenlatz ab y≈2100. Er blickt nach links, also
    # beginnen beide Ausschnitte bei x=0 — nur so bleibt vor dem Gesicht Luft
    # statt dahinter. Der frühere Ausschnitt startete bei x=150 bzw. x=330 und
    # drückte das Profil an die linke Kante.
    # Desktop 2:3 wie die übrigen Hochformate: Kopf im oberen Viertel,
    # Schürze als Anker, Werkzeugwand als Kontext.
    "tyll":           ("Tyll-final.jpg", (0, 100, 2200, 3400),  [600, 1200]),
    # Mobil 4:5 statt schmalem Hochformat: In der halben Spaltenbreite muss der
    # Kopf vollständig mit Abstand zum Rand stehen, Schulter und Schürzenlatz
    # geben den Arbeitskontext.
    "tyll-m":         ("Tyll-final.jpg", (0, 150, 1960, 2600),  [400, 800]),
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

# Markenzeichen für Navy-Flächen: Das Original ist eine navyfarbene Scheibe mit
# hellen Linien. Auf Navy gesetzt wirkt es als aufgeklebte Plakette. Deshalb
# wird die Scheibe transparent gerechnet und nur die Linienzeichnung in
# Elfenbein behalten — so sitzt die Marke in der Fläche statt darauf.
DISC_L, LINE_L = 30.0, 205.0          # Luminanz der Scheibe bzw. der Linien
INK = (243, 237, 223)                 # --ivory
src = logo.convert("RGBA")
mark = Image.new("RGBA", src.size, INK + (0,))
sp, mp = src.load(), mark.load()
for y in range(src.height):
    for x in range(src.width):
        r, g, b, a = sp[x, y]
        if not a:
            continue
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        t = (lum - DISC_L) / (LINE_L - DISC_L)
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        mp[x, y] = INK + (round(a * t),)
mark.save(OUT / "logo-mark.png")
for size, name in ((180, "apple-touch-icon.png"), (48, "favicon-48.png")):
    fav = logo.copy()
    fav.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(fav, ((size - fav.width) // 2, (size - fav.height) // 2), fav)
    canvas.save(OUT / name)
print("og-image, logo, favicons ok")

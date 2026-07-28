#!/usr/bin/env python3
"""Buschmann 1846 — Bildpipeline mit reproduzierbarem Grading.

Erzeugt aus 01-originalfotos/ optimierte Webbilder (WebP + JPG-Fallback,
mehrere Breiten) nach assets/img/. Die Originale werden nie verändert —
gelesen wird ausschließlich, geschrieben ausschließlich nach assets/img/.

Aufruf aus dem Projektstamm:  python3 03-webbilder/build-images.py

Die Datei enthält drei Blöcke:

  JOBS    — Ausschnitt und Zielbreiten je Motiv
  GRADES  — Farb- und Tonwertkorrektur je Motiv (das Grading-Manifest)
  Ablauf  — crop → grade → skalieren → schärfen → Korn → speichern

Alles, was ein Bild verändert, steht als Zahl in diesem Skript. Es gibt
keine manuell überschriebenen Dateien in assets/img/ und keine CSS-Filter
über den Bildern: Ein Durchlauf dieses Skripts erzeugt den ausgelieferten
Stand vollständig neu.
"""
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps

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
    # Claudia Fourmont am Verkaufsfenster — Ausschnitt neu gesetzt (23.07.2026).
    # Gemessen am Original (2664 × 3988) über ein Helligkeitsprofil: Links vom
    # Fenster steht heller Putz (x 0–400, Luminanz bis 213), rechts ab x≈2020
    # der weiße Fensterpfosten und die Hauswand (Luminanz 177–228). Der alte
    # Ausschnitt (950–2630) nahm diese rechte Weißfläche zu rund einem Viertel
    # mit: Sie war das hellste Element im Bild und zog den Blick von Claudia
    # weg. Der neue Schnitt endet bei x 1990, also genau an der Kante zum
    # Pfosten. Links bleiben rund 360 px vom Gast (dunkle Lederjacke) als
    # Gesprächskontext stehen — er trägt die Szene, ohne sie zu dominieren.
    # Ihr Gesicht liegt bei x≈1720 / y≈1076, im Fenster also auf 40 % Höhe.
    # Die Fensterbank (y 1794–1914) bleibt als Ortsangabe unten im Bild.
    # 3:5 — entspricht exakt dem Anzeigefenster auf Desktop, object-fit
    # schneidet dadurch nichts mehr nach.
    "claudia":        ("Claudia.jpg",  (1030, 430, 1990, 2030),  [500, 950]),
    # Eng auf die Begegnung: beide Gesichter liegen bei rund 45 % Höhe, die
    # tote Fläche über den Köpfen ist weg, vom Leuchtpfeil bleibt nur noch
    # ein Rest als Kontext. Untere Spiegelungsscheibe weg (Regel 4).
    # Seitenverhältnis 0,62 — entspricht dem Anzeigefenster in der Galerie.
    "window-team":    ("P1360788.jpg", (629, 950, 1571, 2470),  [600, 1200]),
    "machine":        ("P1360191.jpg", None, [800, 1200]),
    "copper":         ("P1360329.jpg", None, [800, 1200]),
    # Zitronen-Cheesecake — Ausschnitt neu gesetzt (23.07.2026).
    # Gemessen am Original (2566 × 3849): Der Teller liegt bei x 90–2420 und
    # y 1620–3040, das Tortenstück mittig darin. Der alte Ausschnitt nutzte das
    # volle Bild; im 4:5-Fenster blieben davon rund 55 % dunkle Stahlplatte,
    # das Produkt selbst füllte keine 30 % der Fläche. Der neue Schnitt legt
    # den Teller fast randlos ins Bild: Er bleibt vollständig sichtbar (der
    # grün-goldene Rand trägt die Porzellangeschichte des Textes), die
    # Arbeitsplatte wird auf einen Rahmen zurückgenommen. Oben links bleibt
    # ein Rest des blau-weißen Tellerstapels als Hinweis auf das alte Service.
    "cake":           ("P1360096.jpg", (155, 790, 2355, 3540), [800, 1200]),
    "cherries":       ("P1360370.jpg", None, [800, 1200]),
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

    # Claudia mobil 4:5 — derselbe rechte Anschlag am Fensterpfosten wie beim
    # Desktopbild, aber näher heran: Kopf, Schulter und Latz füllen die Spalte,
    # vom Gast bleibt ein schmaler Streifen. Der alte Mobilausschnitt endete
    # unten in der dunklen Hose und lief dadurch zu 17,5 % zu — mit Abstand der
    # schlechteste Wert der ganzen Seite. Dieser Schnitt endet über der
    # Fensterbank und enthält keine Fläche mehr, die zulaufen könnte.
    "claudia-m":      ("Claudia.jpg",  (1200, 648, 1990, 1636),  [400, 790]),
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

    # ---- Die drei Schlussfassungen (22.07.2026) ----------------------------
    # `palette.jpg`, `Gregor-final.jpg` und `Tyll-final2.jpg` sind eine bewusst
    # gemeinsam entwickelte Serie: gleiche Kamera, gleiches Format (2672 × 4000),
    # gleiche Gradation — warmes Bernstein, offene Schatten, feines Korn. Ihre
    # Zusammengehörigkeit trägt sich über die Entwicklung selbst; es liegt
    # deshalb bewusst KEIN CSS-Farbfilter über diesen Bildern. Was sie hier
    # unterscheidet, ist allein der Ausschnitt — jeder einzeln vermessen.

    # Handwerksdetail: Hand, Winkelpalette, Teig und Form.
    # Gemessen am Original: Hand x 0–720 / y 100–1300, Palettenblatt von
    # x 200 bis zur Spitze x 2200 (y 1300–1620), Teig y 1900–2350, Formwand
    # y 2350–3300, Holztisch ab y 3400.
    # Desktop 4:5 — bewusst gedrungener als Gregors 2:3, damit die beiden
    # Bilder nebeneinander nicht als Paar gleicher Rechtecke lesen. Der Schnitt
    # bei y 3340 nimmt die Form als Materialfläche mit und lässt den Tisch weg.
    "palette":        ("palette.jpg", (0, 0, 2672, 3340),  [600, 1200]),
    # Mobil enger auf den Vorgang: In der schmalen Spalte muss der Teig tragen,
    # nicht die leere Formwand. Schnitt bei x 2100 verkürzt nur die Blattspitze,
    # der Griff bleibt vollständig. Der Einstieg bei y 200 nimmt oben etwas vom
    # Handrücken (der ohnehin am Bildrand endet) und gibt dafür unten die Kante
    # der Backform frei — sonst säße der Teig direkt auf der Unterkante.
    "palette-m":      ("palette.jpg", (0, 200, 2100, 2825),  [400, 800]),

    # Gregor Buschmann beim Angießen.
    # Gemessen am Original: Mützenkante y≈55, Augen y≈750, Bart y≈1150,
    # Hand am Kessel ab y 330, Guss x 950–1250 / y 1750–2600, Kupferschüssel
    # y 2650–3820. Über der Mütze stehen nur 55 px — der Ausschnitt beginnt
    # deshalb zwingend bei y=0, sonst wird die Kappe angeschnitten.
    # Er blickt nach links unten auf den Guss, also bleibt die linke Bildhälfte
    # als Blickraum stehen. Desktop 2:3, praktisch die volle Aufnahme: Gesicht
    # und Tätigkeit sind gleichzeitig lesbar, die Schüssel bleibt ganz.
    "gregor":         ("Gregor-final.jpg", (0, 0, 2666, 3999),  [800, 1400]),
    # Mobil 3:4 — weiter gefasst statt näher heran. Die Kappe behält Luft, der
    # Guss bleibt vollständig, die Schüssel wird unten am Rand angeschnitten
    # (die einzige Kante, die man opfern darf, ohne dass etwas unverständlich
    # wird). Kein stärkerer Zoom: das Gesicht ist hier ohnehin schon groß.
    "gregor-m":       ("Gregor-final.jpg", (0, 0, 2670, 3560),  [500, 1000]),

    # Tyll Schulte in der Backstube — verbindliche Fassung (Tyll-final2).
    # Gemessen am Original: Haaransatz y≈90, Ohr x 1180–1330, Nasenspitze
    # x≈235 / y≈1400, Kinn y≈1560, Schürzenlatz y 2150–3400, Topfgriff ab
    # y 3550. Er blickt nach links unten; vor der Nase stehen 235 px, dahinter
    # liegt ab x≈1900 nur noch dunkle Wand. Beide Ausschnitte beginnen deshalb
    # bei x=0 und enden früh — so wächst der Anteil des Freiraums VOR dem
    # Gesicht, statt hinter dem Kopf tote Fläche mitzuschleppen.
    # Desktop 2:3: Kopf, Schulter und der obere Schürzenlatz als Arbeitsanker.
    "tyll":           ("Tyll-final2.jpg", (0, 0, 1900, 2850),  [500, 1000]),
    # Mobil 4:5: derselbe Gedanke, nur weiter — der Kopf steht vollständig mit
    # Luft über dem Haar und vor dem Profil, Schulter und Latz bleiben als
    # Kontext. Bewusst kein engerer Gesichtsausschnitt.
    "tyll-m":         ("Tyll-final2.jpg", (0, 0, 2000, 2500),  [450, 900]),
}

# ==========================================================================
# GRADING-MANIFEST
#
# Vier fotografische Familien, ein gemeinsamer Nenner — aber bewusst NICHT
# ein gemeinsamer Filter. Der gemeinsame Nenner ist nicht die Farbe, sondern
# die Tonwertdisziplin: offener Schwarzpunkt, keine zulaufenden Schatten,
# kontrollierte Sättigung, feines Korn. Die Farbtemperatur bleibt dort, wo
# das Licht der Aufnahme war — Gregor und Tyll stehen im Kunstlicht der
# Backstube, Claudia und die Fassade im Tageslicht draußen. Sie auf dieselbe
# Temperatur zu ziehen hieße, dem Bild sein Licht zu nehmen.
#
# Maßstab ist die vom Auftraggeber abgestimmte Serie palette / Gregor-final /
# Tyll-final2. Gemessen (1. Perzentil der Luminanz, Sättigung, Wärme R−B):
#
#   palette   p01 29.8   sat 0.59   R−B 100
#   gregor    p01 31.6   sat 0.60   R−B  82
#   tyll      p01 27.4   sat 0.43   R−B  41
#
# Daraus der gemeinsame Zielwert: 1. Perzentil bei 29, Anteil zulaufender
# Pixel (Luminanz < 8) unter 0,3 %, ausgefressene Lichter unter 0,12 %.
# Diese drei Bilder werden NICHT gegradet — sie sind die Referenz und stehen
# hier nur der Vollständigkeit halber mit leeren Werten.
#
# `black`, `shadow`, `highlight` und `sat` sind keine geschätzten Werte: Sie
# wurden je Motiv gegen diese Zielgrößen gerechnet. Der erste Ansatz hatte
# black und shadow gleichzeitig hoch gesetzt — beide heben den Fußpunkt, und
# addiert ergaben sie ein 1. Perzentil von 39 bis 57 statt 29. Die ganze Seite
# war damit milchig und in den Schatten entsättigt. Jetzt trägt `shadow` drei
# Viertel der Hebung (es wirkt nur in den tiefen Schatten) und `black` ein
# Viertel; die Sättigung ist so nachgeführt, dass kein Motiv über seiner
# Ausgangssättigung landet — angehoben wird nur, was die Schattenhebung
# vorher weggenommen hat.
#
# Parameter:
#   exposure  Belichtung, multiplikativ in linearem Licht
#   temp      Farbtemperatur: + wärmt (R hoch, B runter), − kühlt
#   tint      Grün/Magenta über den Grünkanal
#   shadow    hebt ausschließlich die tiefen Schatten ((1−s)³)
#   highlight rollt ausschließlich die Lichter ab (s³)
#   contrast  weiche S-Kurve, kein harter Knick
#   black     Schwarzpunkt — der eigentliche Träger der Handschrift
#   sat       Sättigung, multiplikativ
#   clarity   lokaler Kontrast (großer Radius, geringe Stärke)
#   cyan      farbtonselektiver Cyanabzug (siehe decyan) — nur Außenaufnahmen
#   grain     Korn in Ausgabepixeln, erst nach dem Skalieren
# ==========================================================================
REFERENCE = {}          # unverändert ausliefern

GRADES = {
    # ---- A · MENSCHEN UND BACKSTUBE ---------------------------------------
    # Ziel: natürliche Hauttöne, warme Schatten, Gesichter lesbar, Umgebung
    # bleibt sichtbar. Kein Beauty-Retusche-Look, keine geglättete Haut.
    "gregor": REFERENCE, "gregor-m": REFERENCE,
    "tyll": REFERENCE,   "tyll-m": REFERENCE,

    # Claudia: der schlechteste Ausgangswert der Seite — p01 1.0, knapp 10 %
    # der Fläche zugelaufen, mobil sogar 17,5 %. Das Motiv ist Tageslicht
    # unter Wolken, also bewusst nur eine kleine Wärmekorrektur: Der Schnitt
    # und der Schwarzpunkt leisten die Arbeit, nicht die Farbe. Stärkeres
    # Wärmen ließ ihre Haut rötlich und die graue Lederjacke braun werden.
    # Der frühere Sättigungswert 1.40 verstärkte genau diesen Rotstich. Die
    # Schlussfassung kühlt minimal, nimmt Sättigung zurück und behält die
    # bereits bewährte Schattenöffnung bei.
    "claudia":   dict(exposure=1.22, temp=-.010, shadow=.096, highlight=.06,
                      contrast=.06, black=.032, sat=.90, clarity=.12, grain=1.2),
    "claudia-m": dict(exposure=1.16, temp=-.010, shadow=.092, highlight=.07,
                      contrast=.06, black=.031, sat=.90, clarity=.12, grain=1.2),
    # Fensterteam: Median 44, das Motiv stand deutlich zu dunkel im hellen
    # Galerieumfeld. Beide Gesichter tragen die Aufnahme, also Belichtung hoch
    # und Sättigung leicht an — ohne die Hauttöne zu kippen.
    "window-team": dict(exposure=1.16, temp=.014, shadow=.020, highlight=.10,
                        contrast=.05, black=.007, sat=1.22, clarity=.14, grain=1.4),
    # Barista: starkes Gegenlicht durch das Fenster (p95 239). Hier arbeitet
    # vor allem die Lichterabrollung, damit der Fensterausschnitt nicht als
    # weißes Loch neben der Person steht.
    "barista":   dict(exposure=1.10, temp=.018, shadow=.052, highlight=.16,
                      contrast=.04, black=.017, sat=1.40, clarity=.14, grain=1.4),
    "barista-m": dict(exposure=1.06, temp=.018, shadow=.046, highlight=.18,
                      contrast=.04, black=.015, sat=1.40, clarity=.14, grain=1.4),
    # Spritzbeutel: das dunkelste Motiv der Seite (Mittelwert 44, p01 9).
    # Dunkles Shirt vor dunkler Wand — ohne Schattenhebung ist die Tätigkeit
    # nicht lesbar, und genau die ist der Zweck des Bildes.
    "piping":    dict(exposure=1.34, temp=.020, shadow=.065, highlight=.05,
                      contrast=.04, black=.022, sat=1.40, clarity=.16, grain=1.4),

    # ---- B · HANDWERK UND MATERIAL ----------------------------------------
    # Ziel: Material fühlbar, Kupfer und Metall unterscheidbar, kräftiger
    # Mikrokontrast — aber ausdrücklich keine orange Farbsuppe.
    "palette": REFERENCE, "palette-m": REFERENCE,

    # Kupferkessel: mit Abstand der Ausreißer der ganzen Seite — Sättigung
    # 0.93 bei einer Wärme von R−B 124. Das Bild war keine Kupferaufnahme
    # mehr, sondern eine orange Fläche, in der Stäbe und Masse zu einer
    # Textur verschmolzen. Sättigung deutlich zurück, Temperatur leicht ins
    # Kühle, dafür lokaler Kontrast hoch: So wird wieder unterscheidbar, was
    # Metall ist und was Sahne.
    "copper":  dict(exposure=1.12, temp=-.012, shadow=.096, highlight=.08,
                    contrast=.05, black=.032, sat=1.01, clarity=.20, grain=1.4),
    # Anschlagmaschine: cremefarbener Lack, technisch und eher neutral
    # (Sättigung 0.32). Sie darf nicht ins Warme kippen — das Gerät ist
    # historisch, nicht gemütlich. Nur Belichtung und Mikrokontrast.
    "machine": dict(exposure=1.20, temp=.012, shadow=.026, highlight=.05,
                    contrast=.05, black=.009, sat=1.27, clarity=.18, grain=1.4),
    # Kaffeemaschine: Chrom muss Chrom bleiben. Deshalb keine Wärmekorrektur
    # und eine bewusst niedrige Sättigung — mit dem gerechneten Wert 1.40 kam
    # der Gelbstich der Reflexionen mit hoch und das Metall verlor seine
    # Neutralität. Das Motiv lebt ohnehin von der Zeichnung in Brühgruppe und
    # Lanze, nicht von Farbe; die Klarheit leistet hier die Arbeit.
    "coffee":   dict(exposure=1.16, temp=.000, shadow=.056, highlight=.10,
                     contrast=.06, black=.019, sat=1.15, clarity=.20, grain=1.4),
    "coffee-m": dict(exposure=1.16, temp=.000, shadow=.058, highlight=.10,
                     contrast=.06, black=.019, sat=1.15, clarity=.20, grain=1.4),
    # Mandelblättchen und Butter auf Schokolade: beide von Haus aus stark
    # gesättigt (0.67 / 0.73) und sehr warm. Sie stehen in der Bildstrecke
    # neben dem Kupferkessel — zu dritt ergaben sie genau die braune
    # Gleichförmigkeit, die vermieden werden soll. Deshalb hier gezielt
    # Sättigung zurück statt hoch.
    "almonds": dict(exposure=1.06, temp=-.004, shadow=.021, highlight=.04,
                    contrast=.04, black=.007, sat=.93, clarity=.16, grain=1.4),
    "butter":  dict(exposure=1.08, temp=-.006, shadow=.074, highlight=.05,
                    contrast=.04, black=.025, sat=1.03, clarity=.16, grain=1.4),

    # ---- C · PRODUKT UND PÂTISSERIE ---------------------------------------
    # Ziel: appetitlich und hell genug, Glasur und Schichtung lesbar, Weiß
    # nicht grau — und trotzdem glaubwürdig. Bewusst die kleinste Sättigungs-
    # anhebung der Seite: Übersättigtes Essen wirkt sofort unecht.
    "cake":     dict(exposure=1.28, temp=.012, shadow=.089, highlight=.12,
                     contrast=.10, black=.030, sat=1.40, clarity=.18, grain=1.4),
    # Kirschfüllung: satte Rottöne sind hier echt, sie brauchen keine Hilfe.
    # Nur die Schatten öffnen und die Sättigung leicht zurücknehmen, damit
    # das Rot nicht zuläuft.
    "cherries": dict(exposure=1.12, temp=.000, shadow=.066, highlight=.06,
                     contrast=.05, black=.022, sat=1.08, clarity=.16, grain=1.4),

    # ---- D · ORT UND GESCHICHTE -------------------------------------------
    # Ziel: natürliche Architekturfarben. Ausdrücklich KEIN Küchenfilter auf
    # Außenaufnahmen — der Himmel bleibt Himmel. Zwei Aufgaben hier:
    # Erstens lief die Fassade zu 5,3 % zu, die Gäste unter den Schirmen
    # waren fast schwarz. Zweitens war der Himmel cyan statt blau (siehe
    # decyan) — die Aufnahme war ein lupenreiner Teal-and-Orange-Look und
    # damit das einzige Bild der Seite, das nach Filter aussah statt nach
    # Düsseldorf. Der Cyanabzug ist farbtonselektiv und rührt die Fassade
    # nicht an; die Wärmekorrektur bleibt winzig.
    "hero":        dict(exposure=1.06, temp=.010, shadow=.100, highlight=.04,
                        contrast=.03, black=.033, sat=1.40, clarity=.12,
                        cyan=.35, grain=1.2),
    "hero-mobile": dict(exposure=1.06, temp=.010, shadow=.100, highlight=.04,
                        contrast=.03, black=.033, sat=1.40, clarity=.12,
                        cyan=.35, grain=1.2),
    # Gast am Verkaufsfenster: hell und kühl, das Gegenstück zur Backstube.
    # Es darf hell bleiben — nur die Spitzlichter am Putz werden abgerollt
    # und die Farbe bekommt etwas Substanz.
    "window-outside": dict(exposure=1.00, temp=.012, shadow=.050, highlight=.10,
                           contrast=.04, black=.017, sat=1.40, clarity=.12, grain=1.2),
}

# Ausgabeschärfung: Jedes Herunterskalieren kostet Kantenschärfe. Der Wert
# gilt für alle Motive gleichermaßen — auch für die drei Referenzbilder, denn
# das ist eine Resampling-Korrektur und keine Bildlook-Entscheidung.
#
# Der Wert ist bewusst niedrig. Gemessen an fünf Motiven kostet Schärfung in
# WebP spürbar Bytes: 0 % → 1480 kB, 22 % → 1703 kB, 42 % → 1971 kB. 42 % war
# der erste Ansatz und damit sowohl das teuerste als auch das gestalterisch
# falsche Ende — sichtbare Säume an Kanten sind ein Ausschlusskriterium.
# 22 % stellt die Kantenschärfe des Originals wieder her und kostet dafür
# 15 % Dateigröße statt 33 %.
SHARPEN = .22


# ---------------------------------------------------------------------------
# Grading-Kern — reine PIL-Lookup-Tabellen, keine Fremdabhängigkeiten
# ---------------------------------------------------------------------------
def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _lin_to_srgb(c):
    c = 0.0 if c < 0 else (1.0 if c > 1 else c)
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def _band(exposure, gain, shadow, highlight, contrast, black, white):
    """256-Werte-Kurve für einen Kanal."""
    out = []
    for i in range(256):
        # Belichtung wirkt in linearem Licht, sonst verhält sie sich in den
        # Schatten anders als in den Lichtern.
        s = _lin_to_srgb(_srgb_to_lin(i / 255) * exposure * gain)
        s = s + shadow * (1 - s) ** 3          # hebt nur die tiefen Schatten
        s = s - highlight * s ** 3             # rollt nur die Lichter ab
        s = 0.0 if s < 0 else (1.0 if s > 1 else s)
        if contrast:
            s = s + contrast * (s * s * (3 - 2 * s) - s)   # weiche S-Kurve
            s = 0.0 if s < 0 else (1.0 if s > 1 else s)
        s = black + s * (white - black)        # Schwarzpunkt zuletzt
        out.append(0 if s < 0 else (255 if s > 1 else round(s * 255)))
    return out


def decyan(im, amount):
    """Zieht einen Cyanstich zurück, ohne den Rest des Bildes anzufassen.

    Gemessen am Fassadenfoto lag der Himmel bei R 59 / G 182 / B 199 — Grün
    und Blau praktisch gleichauf. Genau das ist Cyan und nicht Himmelblau,
    und zusammen mit der warmen Fassade (R−B +47) ergab es den Teal-and-
    Orange-Look, der ausdrücklich ausgeschlossen ist.

    Ein globaler Grünabzug würde die ganze Aufnahme magenta kippen. Deshalb
    wird eine Maske aus dem Bild selbst gerechnet: min(G, B) − R. Sie ist
    dort groß, wo ein Pixel cyan ist, und null, sobald Rot mitspielt — also
    an Ziegel, Putz, Holz und Haut. Der Grünkanal wird nur um diesen Anteil
    abgesenkt; aus Cyan wird Blau, alles andere bleibt unberührt.

    Am gemessenen Himmelpixel: min(182, 199) − 59 = 123, davon 35 % = 43.
    Neu also R 59 / G 139 / B 199 — ein Blau mit klarem Abstand zwischen
    Grün und Blau. Am Putz (R 242 / G 211 / B 199) ist die Maske null.
    """
    r, gc, b = im.split()
    mask = ImageChops.subtract(ImageChops.darker(gc, b), r)   # 0 ausserhalb Cyan
    return Image.merge("RGB", (
        r, ImageChops.subtract(gc, mask.point(lambda v: round(v * amount))), b))


def apply_grade(im, g):
    """Ton- und Farbkorrektur auf voller Auflösung."""
    if not g:
        return im
    if g.get("cyan"):
        im = decyan(im, g["cyan"])
    ex, tp, tn = g.get("exposure", 1.0), g.get("temp", 0.0), g.get("tint", 0.0)
    sh, hl = g.get("shadow", 0.0), g.get("highlight", 0.0)
    ct, bk, wt = g.get("contrast", 0.0), g.get("black", 0.0), g.get("white", 1.0)
    im = im.point(_band(ex, 1 + tp, sh, hl, ct, bk, wt)
                  + _band(ex, 1 + tn, sh, hl, ct, bk, wt)
                  + _band(ex, 1 - tp, sh, hl, ct, bk, wt))
    if g.get("sat", 1.0) != 1.0:
        im = ImageEnhance.Color(im).enhance(g["sat"])
    if g.get("clarity"):
        # Großer Radius, geringe Stärke: das ist lokaler Kontrast, keine
        # Schärfung. Der Radius skaliert mit dem Bild, damit ein Hoch- und
        # ein Querformat dieselbe Wirkung bekommen.
        im = im.filter(ImageFilter.UnsharpMask(
            radius=max(8, round(min(im.size) / 55)),
            percent=round(g["clarity"] * 100), threshold=2))
    return im


def finish(im, grain):
    """Schärfe und Korn — erst nach dem Skalieren, also in Ausgabepixeln.
    Vor dem Skalieren gerechnet, hätte ein 1400er Derivat sichtbar anderes
    Korn als ein 500er aus derselben Datei."""
    im = im.filter(ImageFilter.UnsharpMask(
        radius=1.0, percent=round(SHARPEN * 100), threshold=3))
    if grain:
        n = Image.effect_noise(im.size, grain).convert("L")
        im = ImageChops.add(im, Image.merge("RGB", (n, n, n)), scale=1, offset=-128)
    return im


# WebP-Qualität. Das Grading öffnet die Schatten, und offene Schatten enthalten
# Zeichnung, die vorher schwarz war — die Dateien wurden dadurch schwerer. An
# sechs Motiven gemessen kostet der Schritt von 75 auf 78 überproportional:
# 845 kB gegen 1002 kB, also 19 % mehr Bytes. Der Bildunterschied liegt bei
# einer mittleren Abweichung von 3,4 bis 4,6 von 255 und ist im direkten
# 1:1-Vergleich nicht auszumachen; bei 68 dagegen wird das Korn in ruhigen
# Flächen sichtbar fleckig. Deshalb 75.
WEBP_Q = 75


def export(im, stem, width, grain):
    scaled = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    scaled = finish(scaled, grain)
    scaled.save(OUT / f"{stem}-{width}.webp", "WEBP", quality=WEBP_Q, method=6)
    scaled.save(OUT / f"{stem}-{width}.jpg", "JPEG", quality=82,
                progressive=True, optimize=True)


def source(stem):
    """Original laden und zuschneiden — ohne Grading. Auch von den
    Prüfskripten genutzt, damit dort exakt dieselben Ausschnitte gelten."""
    src, box, _ = JOBS[stem]
    im = ImageOps.exif_transpose(Image.open(SRC / src)).convert("RGB")
    return im.crop(box) if box else im


def build(selected=None):
    jobs = JOBS.items()
    if selected:
        unknown = sorted(set(selected) - set(JOBS))
        if unknown:
            raise SystemExit(f"Unbekannte Bildjobs: {', '.join(unknown)}")
        jobs = ((stem, JOBS[stem]) for stem in selected)

    for stem, (_, _, widths) in jobs:
        g = GRADES.get(stem, {})
        im = apply_grade(source(stem), g)
        for w in widths:
            export(im, stem, w, g.get("grain", 0))
        print(f"{stem}: {im.width}x{im.height} -> {widths} "
              f" [{'referenz' if not g else 'gegradet'}]")

    if selected:
        return

    # Social-Preview 1200x630 aus dem Fassadenfoto (Schriftzug im Bild).
    # Bekommt dieselbe Korrektur wie der Hero — sonst zeigt die Vorschau in
    # sozialen Netzwerken eine andere Fassade als die Startseite.
    im = ImageOps.exif_transpose(Image.open(SRC / "P1360101.jpg")).convert("RGB")
    im = apply_grade(im.crop((0, 285, 3990, 2380)), GRADES["hero"])
    im.resize((1200, 630), Image.LANCZOS).save(
        OUT / "og-image.jpg", "JPEG", quality=85, progressive=True, optimize=True)

    # Logo (bereinigte transparente Fassung) + Favicons
    logo = Image.open(ROOT / "04-logo" / "buschmann-logo-transparent.png")
    logo.save(OUT / "logo.png")

    # Markenzeichen für Navy-Flächen: Das Original ist eine navyfarbene Scheibe
    # mit hellen Linien. Auf Navy gesetzt wirkt es als aufgeklebte Plakette.
    # Deshalb wird die Scheibe transparent gerechnet und nur die Linien-
    # zeichnung in Elfenbein behalten — so sitzt die Marke in der Fläche
    # statt darauf.
    DISC_L, LINE_L = 30.0, 205.0      # Luminanz der Scheibe bzw. der Linien
    INK = (243, 237, 223)             # --ivory
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


if __name__ == "__main__":
    build(sys.argv[1:] or None)

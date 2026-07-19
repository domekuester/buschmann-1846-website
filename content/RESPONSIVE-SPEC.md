# RESPONSIVE-SPEC — Desktop und Mobil gleichwertig

## Breakpoints

```css
/* Mobile-first */
--bp-sm: 560px;   /* große Phones quer, kleine Tablets */
--bp-md: 768px;   /* Tablet hochkant */
--bp-lg: 1024px;  /* Desktop-Einstieg, Nav sichtbar */
--bp-xl: 1440px;  /* große Desktops, Container greift */
```

Prüfpflicht bei jeder visuellen Änderung:
Desktop 1024 / 1280 / 1366 / 1440 / 1680 / 1920 px ·
Mobil/Tablet 320×568, 360×800, 375×667, 390×844, 393×852, 430×932, 768×1024 ·
Zoom 100 % / 125 % / 150 %.

## Header

**Desktop (≥1024):** Infozeile 32 px (--navy-brand, Kicker-Typo) →
Header 72 px auf --paper: Nav links (Geschichte, Pâtisserie) · Logo
geometrisch zentriert (120 px) · Nav rechts (Catering, Samstag, Standort).
Keine Social-Icons im Hauptheader. Keine abgeschnittenen Punkte
(Nav bei 1024 px mit reduziertem letter-spacing testen).

**Mobil (<1024):** Infozeile kompakt: „SA · 12–17 UHR · AKADEMIESTRASSE 8".
Header 60 px: Logo links (96 px, unverzerrt), Menübutton rechts (44×44 px
Touchfläche). Menü: Vollflächen-Overlay --navy-brand, Nav-Punkte in
Newsreader, darunter sekundär Adresse + Instagram/Facebook.
Enter/Escape + Fokusfalle im Menü, aria-expanded am Button.

## Hero

**Desktop:** Bild P1360101 volle Breite, Höhe ≈ 78vh (min 560px, max 820px);
Headline-Block auf Papierfläche unterhalb/überlappend links —
Text NIE auf unruhigem Bildbereich; „Düsseldorfer" darf nie umbrechen
oder abgeschnitten sein (getestet bei 1024 und 1920).
**Mobil:** eigener Hochkant-Crop (Schriftzug + Eingang + Schirme),
Höhe 70–85 svh inkl. Headline-Block; nächste Sektion ragt sichtbar an.

## Chronologie

Desktop: Zahlen (Newsreader, Champagner) links an der Wirbelsäule, Texte
rechts, eine Zeile pro Station.
Mobil: untereinander, Zahl ÜBER dem Text, nie ausgeblendet — Jahreszahlen
sind Pflichtinhalt auf allen Breiten (320 px getestet).

## Galerie

Desktop ≥1024: 3 Spuren (Grid), Versatz 0/80/160 px.
768–1023: 2 Spuren, Versatz 0/64 px.
<768: kontrollierte Paare — Muster: 1 großes 4:5 → Paar (klein+hoch) →
Paar (hoch+klein); Gap 12 px; kein Masonry-Skript, reines Grid.

## Bilder

- `<picture>` mit Art Direction: Hero und Claudia bekommen eigene
  Mobil-Crop-Dateien; alles andere object-fit: cover + object-position.
- width/height-Attribute überall (kein CLS), lazy loading außer Hero
  (fetchpriority="high").
- WebP + JPG-Fallback; sizes-Attribute pro Slot.

## Samstagsfenster

Desktop: 2 Spalten — links Text + Faktenblock + kleines 057-Bild,
rechts Claudia groß vertikal (55–60 %-Crop, Gesicht im oberen Drittel).
Mobil: Headline → Claudia 4:5 (Kopf komplett, nicht zu hoch) → Text +
Fakten → 057 kompakt. Claudia bleibt auf jeder Breite das Hauptmotiv.

## Catering

Desktop: dunkle Fläche, 3 Textblöcke nebeneinander (Gastronomie /
Unternehmen / Privat) mit feinen Champagner-Trennlinien — KEINE Karten.
Mobil: untereinander mit Linien; Bild P1360381 als kompaktes 4:5.

## Footer

Desktop: 3 Spalten (Adresse+Zeiten / Nav / Social) + Claim in Newsreader.
Mobil: gestapelt, Logo ≤110 px, alles klickbar, Touchflächen ≥44 px.

## Harte Regeln

- kein horizontales Scrollen auf irgendeiner Breite (320 px inklusive)
- keine ausgeblendeten Pflichtinhalte auf Mobil (Jahreszahlen!)
- Touchflächen ≥ 44×44 px
- Zeilenlängen: Fließtext auch auf 320 px ≥ 45 Zeichen (Padding klein halten)
- Wirbelsäule auf allen Breiten durchgehend (8 px mobil), Inhalte nie gequetscht

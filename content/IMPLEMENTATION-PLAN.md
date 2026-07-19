# IMPLEMENTATION-PLAN — GATE 2 (erst nach „FREIGABE UMSETZEN")

## Zielstruktur

```
index.html
assets/
├── css/main.css          (ein File, klar sektioniert, Custom Properties)
├── js/main.js            (Menü, IntersectionObserver: Reveal + Spine-Punkt)
├── fonts/                (Newsreader + Instrument Sans, WOFF2 + OFL.txt)
└── img/                  (optimierte Kopien; Originale bleiben in 01-originalfotos)
03-webbilder/             (Zwischenexporte der Bildpipeline)
```

Statisch, kein Framework, kein Build-Zwang. Relative Pfade (GitHub-Pages-
Unterordner-kompatibel). Ein `<script defer>`, keine Dependencies.

## Reihenfolge (mit Prüfpflicht nach jedem Schritt)

1. **Fundament**: Fonts lokal, Custom Properties, Reset, Wrapper,
   Wirbelsäule global → Commit `feat: rebuild Buschmann design system`
2. **Bildpipeline**: sips/ImageMagick-Skript → 03-webbilder → assets/img
   (WebP+JPG, Breiten 480–2000, Hero-/Claudia-Sondercrops)
3. **Header + Infozeile + mobiles Menü**, **Hero** →
   Commit `feat: rebuild responsive header and hero`
4. **Einordnung, Geschichte, Chronologie** →
   Commit `feat: restore Buschmann history and timeline`
5. **Pâtisserie, Backstube, Galerie** →
   Commit `feat: restore patisserie and editorial photography`
6. **Catering, Samstagsfenster, Standort, Footer** →
   Commit `feat: restore catering and Saturday experience`
7. **Mobilfeinschliff, Accessibility-Pass, Performance-Pass** →
   Commit `feat: complete responsive flagship polish`
8. **GitHub-Pages-Check** (Pfade, Title, Meta, Favicon, og:image) →
   Commit `fix: prepare Buschmann site for GitHub Pages`

Nach jedem Hauptabschnitt: lokal rendern (python3 -m http.server),
Screenshots Desktop 1440 + Mobil 390 (Chrome DevTools MCP/Playwright),
Vergleich mit Konzeptboards, Abweichungen beheben, DANN weiter.

## Accessibility-Checkliste (Schritt 7)

Semantik/Landmarks, h1–h3-Hierarchie, Skip-Link, Tastatur komplett,
Menü Enter/Escape + Fokusfalle, aria-expanded/aria-current, Alt-Texte aus
COPY-INVENTORY, Kontraste (Champagner nie für Fließtext), Touch ≥44 px,
prefers-reduced-motion, keine doppelten IDs, kein horizontales Scrollen.

## Performance-Checkliste (Schritt 7)

Hero preload + fetchpriority, Rest lazy, width/height überall (CLS=0),
nur 2 Fontfamilien × benötigte Achsen, font-display: swap,
CSS ein File < 40 KB, JS < 6 KB, Lighthouse-Durchlauf lokal.

## Git-Disziplin

- alles auf `rebuild/flagship-recovery`, Push nur dieses Branches
- kein Force-Push, kein Merge nach main, keine Pages-Aktivierung
  ohne ausdrückliche Freigabe

## Offene Entscheidungen für den Auftraggeber (vor/nach GATE 2)

1. Personennamen auf der Website (Claudia belegt; Louis/Till/Gregor an
   Bildern erst nach Bestätigung)
2. Kontaktweg Catering (bis dahin: Verweis auf Instagram/Facebook)
3. Impressum/Datenschutz-Inhalte
4. Logo in höherer Auflösung vorhanden?

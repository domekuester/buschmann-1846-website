# FINAL-DESIGN-SPEC — Designsystem Buschmann 1846

## 1. Farben (CSS-Custom-Properties)

```css
:root {
  /* Navy — Marke und dunkle Flächen */
  --navy-night:   #061729;  /* dunkelste Fläche, Footer-Ende */
  --navy-brand:   #0A2139;  /* Buschmann-Navy: Wirbelsäule, Header-Akzente */
  --navy-raised:  #102B47;  /* differenzierte Navy-Fläche (z. B. Samstag) */

  /* Helle Flächen — Papierwelt */
  --ivory:        #F3EDDF;  /* Sektionen mit Substanz (Geschichte) */
  --paper:        #F7F2E8;  /* Standard-Seitenhintergrund */
  --porcelain:    #FCF9F3;  /* hellste Fläche (Pâtisserie, Karteninneres) */

  /* Braun — Catering/Backstube */
  --choc-deep:    #1B100C;  /* dunkelbraune Fläche (Catering) */
  --choc-warm:    #281711;  /* warme Braunfläche, Bildhintergründe */

  /* Champagner — nur Linien und kleine Akzente */
  --champagne:      #C59A52;
  --champagne-soft: #D1B27B;

  /* Text */
  --text-dark:      #101923;  /* Headlines auf hell */
  --text-warm:      #3F3932;  /* Fließtext auf hell */
  --text-secondary: #746D64;  /* Captions, Meta */
  --text-on-dark:   #F3EDDF;  /* Text auf Navy/Braun = Elfenbein */
}
```

Regeln:

- Champagner NIE als Fläche, nur als 1-px-Linien, Zahlen-Akzente, Marker.
- Keine Verläufe, kein Blur, keine Glows, keine Schatten > 1 px Kante.
- Flächenwechsel hart und bewusst: Papier → Elfenbein → Navy → Braun.
- Kontraste: Fließtext nur --text-warm auf hell / --ivory auf dunkel
  (--text-secondary nur ≥ 14 px und nie für tragende Information).

## 2. Typografie

**Serif/Display: Newsreader Variable** (WOFF2 lokal, opsz-Achse nutzen)
Hero-Headline, Sektions-Headlines, Jahreszahlen, Zitat, Samstag, Footer-Claim.

**Sans/UI: Instrument Sans Variable** (WOFF2 lokal)
Navigation, Infozeile, Fließtext, Fakten, Buttons, Captions, Adresse.

```css
font-display: swap;
font-optical-sizing: auto;
```

Skala (clamp, Desktop-Zielwerte):

| Token | Größe | Verwendung |
|---|---|---|
| --fs-hero | clamp(2.6rem, 6.5vw, 5.2rem) | Hero-Headline (Newsreader 400, opsz hoch) |
| --fs-h2 | clamp(2rem, 4vw, 3.2rem) | Sektions-Headlines |
| --fs-year | clamp(1.8rem, 3vw, 2.6rem) | Jahreszahlen (Newsreader, Champagner) |
| --fs-lead | clamp(1.1rem, 1.5vw, 1.3rem) | Einleitungs-/Begleittexte |
| --fs-body | 1rem / 1.0625rem | Fließtext (Instrument Sans) |
| --fs-caption | 0.8125rem | Captions, Meta |
| --fs-kicker | 0.75rem, letter-spacing 0.14em, uppercase | Kicker/Infozeile |

Regel: pro Bildschirm nur EIN dominantes Typografieelement.
Zeilenlänge Fließtext: 58–68 Zeichen (max-width ≈ 62ch).

## 3. Abstände und Container

```css
--space-1: 0.5rem;  --space-2: 1rem;   --space-3: 1.5rem;
--space-4: 2.5rem;  --space-5: 4rem;   --space-6: 6.5rem;
--section-pad-desktop: clamp(5rem, 10vh, 8rem);
--section-pad-mobile: 3.5rem;
--container-max: 1200px;     /* Textinhalt */
--container-wide: 1440px;    /* Bildkompositionen */
--container-pad: clamp(1.25rem, 4vw, 3rem);
```

## 4. Linien und Bildkanten

- Trennlinien: 1 px, `--champagne` mit 45 % Deckung auf hell,
  `--champagne-soft` 35 % auf dunkel.
- Bilder: keine Rahmen, kein border-radius (0), keine Schatten.
  Optional 1 px Innenkante Champagner bei Bildern auf dunklen Flächen.
- Keine schwebenden Karten; Inhalte sitzen auf der Fläche.

## 5. Wirbelsäule (globaler Navy-Streifen)

- EIN globales Element: `body::before`, `position: fixed`, links,
  `top: var(--header-height)` bis unten; z-index über Sektionshintergründen,
  unter Header/Menü.
- Breite: Desktop 11 px · Tablet 9 px · Mobil 8 px (innerhalb der Richtwerte).
- Farbe `--navy-brand`; rechte Innenkante 1 px `--champagne-soft` 40 %,
  damit sie auf Navy-/Braunflächen sichtbar bleibt.
- Layout-Regel: Sektions-Padding-links berücksichtigt die Streifenbreite
  (padding-left: calc(var(--container-pad) + 11px)) — kein Grid-Umbau,
  kein horizontales Scrollen, keine gequetschten Inhalte.
- Abschnittsmarker (Signature-Interaktion 3): 5-px-Punkt in Champagner auf
  dem Streifen, Position = aktive Sektion (IntersectionObserver).

## 6. Buttons und Links

- Primär-Link („Anfahrt", Social): Text in Instrument Sans 500 + 1-px-
  Unterstreichung Champagner, Hover: Unterstreichung wird --text-dark.
- Es gibt KEINE gefüllten Buttons — die Seite verkauft nichts online.
- Fokus: 2 px Outline `--champagne` mit 2 px Offset, überall sichtbar.
- Social Links: komplette Textzeile klickbar, `target="_blank"`,
  `rel="noopener noreferrer"`, aria-label („Instagram von Buschmann 1846,
  öffnet in neuem Tab").

## 7. Bildrollen (redaktionelle Galerie)

Desktop: CSS-Grid, 3 Spalten (Spuren), `align-items: start`, Spur 2/3 mit
`margin-top` 80/160 px versetzt; Bildhöhen variieren (4:5, 3:4, 1:1).
Mobil: 2-spaltige kontrollierte Paare + einzelne 4:5-Bilder,
6 Bilder gesamt, Reihenfolge = Dramaturgie (siehe IMAGE-USAGE.md).

## 8. Motion-Regeln (max. 3 Signature-Interaktionen)

1. **Navigationslinie**: 1-px-Linie wächst unter dem aktiven/gehoverten
   Nav-Punkt (transform: scaleX, 200 ms ease-out).
2. **Bild-Reveal**: Bilder blenden EINMAL beim ersten Sichtbarwerden ein
   (opacity 0→1 + translateY 12px→0, 500 ms, IntersectionObserver,
   `once`-Verhalten).
3. **Wirbelsäulen-Punkt**: wandert weich zur aktiven Sektion (300 ms).

`@media (prefers-reduced-motion: reduce)`: alle drei deaktiviert,
Inhalte sofort sichtbar. Keine Parallax, keine Loops, keine Zooms.

## 9. Logo

- Natürliche Proportion 374:346 — width UND height nie widersprüchlich
  setzen; `height: auto`.
- Header: ~120 px Breite Desktop, ~96 px Mobil. Footer: ≤ 140 px.
- Kein object-fit: fill, kein sichtbares Rechteck (PNG hat Alphakanal).
- Auflösungsgrenze 374 px beachten → nie größer als 170 px CSS-Breite.

## 10. Sektions-Flächenfolge (vertikaler Rhythmus)

| Sektion | Fläche |
|---|---|
| Infozeile | --navy-brand (Text Elfenbein) |
| Header | --paper |
| Hero | Bild + --paper |
| Einordnung | --paper |
| Geschichte | --ivory |
| Chronologie | --ivory → --navy-raised (Zahlen Champagner) |
| Pâtisserie | --porcelain |
| Backstube | --paper |
| Galerie | --paper |
| Catering | --choc-deep (Text Elfenbein) |
| Samstagsfenster | --navy-raised (Text Elfenbein) |
| Standort | --paper |
| Footer | --navy-brand → --navy-night |

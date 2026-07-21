# IMAGE-USAGE — Bild-zu-Sektion-Plan

Reihenfolge = Seitenstruktur. Jedes Bild genau einmal.

| # | Sektion | Bild(er) | Crop Desktop | Crop Mobil |
|---|---|---|---|---|
| 3 | Hero | P1360101 | volle Breite, Fokus Schriftzug+Eingang, Himmel beschnitten | Hochkant-Ausschnitt Mitte: Schriftzug, Tür, Schirme |
| 4 | Einordnung heute | — (reine Typografie) | — | — |
| 5 | Geschichte | P1360191 | Vollbild vertikal neben Text | 4:5 Maschinenkopf+Kessel |
| 6 | Chronologie | — (Typografie + Wirbelsäule) | — | — |
| 7 | Pâtisserie | P1360096 (dominant) + P1360370 (Detail) | 96: 4:5 groß · 370: kleines 4:5 | 96 groß 4:5, 370 klein daneben/darunter |
| 8 | Backstube & Menschen | P1360272 (Leitbild) + P1360346 (Detail) | 272 Vollbild vertikal · 346 kleiner | 272 4:5 · 346 quadratisch |
| 9 | Redaktionelle Galerie | P1360329, P1360218, P1360326, P1360788, P1360109 (optional), P1360381* | 3 vertikale Spuren, versetzte Starts | 6 Bilder, kontrollierte Paare, unterschiedliche Höhen |
| 10 | Catering | P1360381* (Zutaten) | quer angeschnittenes Band oder 4:5 | 4:5 kompakt |
| 11 | Samstagsfenster | Claudia.jpg = Claudia Fourmont, belegt (groß vertikal) + P1360057 (ergänzend) | Claudia 55–60 % oberer Bildteil · 057 fast Vollbild | Claudia enger 4:5, Kopf komplett · 057 4:5 |
| 12 | Standort | — (Typografie) | — | — |
| 13 | Footer | Logo | natürliche Proportion ≤ 140 px | ≤ 110 px |

\* P1360381 entweder Galerie ODER Catering — nicht beides. Empfehlung:
Catering (dort fehlt sonst ein Bild); Galerie erhält dann P1360109.

## Galerie-Dramaturgie (Reihenfolge erzählt: Ort → Geschichte → Menschen → Handwerk → Produkt → Samstag)

Desktop, 3 Spuren (Startversatz v. l. n. r.: 0 / +80 px / +160 px):

- Spur 1: P1360329 (Kupfer, hoch) → P1360788 (Lächeln)
- Spur 2: P1360218 (Mandeln, kürzer) → P1360326 (Spritzbeutel, hoch)
- Spur 3: P1360109 (Fenster außen) → kleine Caption-Fläche/Weißraum

Mobil (6 Bilder, Paare):

1. P1360329 (groß, 4:5)
2. Paar: P1360218 (klein) + P1360326 (hoch)
3. Paar: P1360109 (hoch) + P1360788 (klein)

Captions (2–5 Wörter, nicht überall):

- P1360329: „Kupferkessel, seit Jahrzehnten"
- P1360218: „Mandeln für die Kante"
- P1360788: „Samstags am Fenster"
- P1360326/P1360109: ohne Caption

## Export-Pipeline (GATE 2)

- Zielordner: `03-webbilder/` (Originale bleiben unberührt)
- Formate: WebP (q≈78) + JPG-Fallback
- Breiten: 480 / 800 / 1200 / 1600 (Hero zusätzlich 2000)
- Hero: eigene Desktop- (quer) und Mobil-Datei (hochkant beschnitten)
- Claudia + P1360788: beschnittene Master-Crops als eigene Dateien
  (Rückendominanz bzw. Spiegelung dürfen nie ins Web gelangen)

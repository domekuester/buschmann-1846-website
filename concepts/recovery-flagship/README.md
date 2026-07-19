# Konzepte — Recovery Flagship (GATE 1)

**Status: Freigabefähiges Konzept. NICHT die produktive Website.**

- `flagship-concept.html` — vollständiges, responsives Konzeptboard aller
  13 Sektionen mit echten Buschmann-Fotos, offiziellem Logo und finalen
  Texten (COPY-INVENTORY.md). Lokal zu öffnen über einen HTTP-Server im
  Projektstamm, z. B.: `python3 -m http.server` →
  `http://localhost:8000/concepts/recovery-flagship/flagship-concept.html`
- `img/` — optimierte Konzept-Bildkopien inkl. verbindlicher Crops
  (Claudia-Crop, Hero-Mobil, Fensterteam ohne Spiegelung).
  Originale in `01-originalfotos/` bleiben unberührt.
- `screenshots/` — gerenderte Konzepte:
  Desktop (1440 px): 01 Header/Hero … 09 Gesamtübersicht
  Mobil (390 px): 01 Header/Hero + offenes Menü … 08 Gesamtübersicht

Geprüft: kein horizontales Scrollen bei 320/360/375/393/430/768/1024/
1280/1366/1680/1920 px; Jahreszahlen auf Mobil sichtbar; Claudia auf
Desktop und Mobil Hauptmotiv des Samstagsbereichs; Logo ohne sichtbares
Rechteck (bereinigte Kopie in `04-logo/`).

Hinweis: Das Konzept lädt Schriften von Google Fonts (nur für die lokale
Konzeptansicht). Die produktive Website bindet WOFF2 lokal ein.

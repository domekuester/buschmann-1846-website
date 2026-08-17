# Visual QA

Geprüft wurden `/` und `/en/` sowie die vier Legal-Routen bei 320×568, 360×800, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1280×800, 1440×1000 und 1920×1080. Die temporären Browser-Screenshots des einmaligen Audits wurden vor dem Commit entfernt.

## Ergebnis

Keine P0/P1-Befunde. Mobile, Tablet und Desktop zeigen eine eigenständige, konsistente Komposition; Hero-Crops, Typografie, Navy/Champagne-Führung und optische Achsen wirken hochwertig. Der Wechsel zwischen 768 und 820 px ist stabil.

### P3 — Claudia bleibt der schwächste Personenframe

Severity: P3
Page: `/`, `/en/`
Viewport: alle
Element: Claudia-Foto
Observed: Das vorhandene Original ist weicher und farblich schwieriger als Gregor/Tyll.
Expected: Gleiche Ausgangsqualität wie die übrigen Personenleitbilder.
Evidence: `01-originalfotos/Claudia.jpg`; bestehende Dokumentation in `content/IMAGE-INVENTORY.md`.
Recommended fix: Bei Gelegenheit neues freigegebenes Original aufnehmen; nicht synthetisch rekonstruieren.

P3 wurde gemäß Auftrag nicht automatisch geändert.

# SEO & Accessibility

Alle sechs HTML-Seiten enthalten genau einen Title, eine Meta Description, eine Canonical-Angabe und eine H1. DE/EN-hreflang ist vorhanden; Startseiten enthalten JSON-LD. `robots.txt` und `sitemap.xml` liefern lokal HTTP 200.

### P2 — Domainumschaltung bleibt bewusst offen

Severity: P2
Page: alle
Viewport: n/a
Element: Canonical, hreflang, OG und Sitemap
Observed: Vorschau-URLs zeigen auf GitHub Pages; Legal-Copy nennt bereits `buschmann1846.de`.
Expected: Nach finaler Umschaltung konsistente Produktionsdomain.
Evidence: HTML-Metadaten und `sitemap.xml`.
Recommended fix: Erst unmittelbar vor dem bestätigten IONOS-Livegang koordiniert umstellen und live erneut testen.

Semantische Landmarks, Skip-Link, Menübuttonzustände, Focus-Regeln und Reduced-Motion-Regeln sind im vorhandenen Code angelegt. Vollständige assistive-Technik-Validierung und 200%-Zoom bleiben Teil des Live-Abnahmetests; es wurde keine überflüssige ARIA ergänzt.

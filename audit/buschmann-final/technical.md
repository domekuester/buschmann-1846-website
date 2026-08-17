# Technical Audit

Baseline: Branch `rebuild/flagship-recovery`, HEAD `96a3cfd`. Die bereits vorhandene interne Dokumentation `content/PRIVACY-TECH-AUDIT.md` wurde als commitfähig eingestuft. Unreferenzierte lokale Paketdateien (`package.json`, `package-lock.json`, `node_modules/`) wurden beim Setup-Cleanup als nicht benötigte temporäre Abhängigkeiten entfernt.

Lokale Antworten: alle sechs Seiten, `robots.txt` und `sitemap.xml` HTTP 200. Keine leeren `href`, `href="#"` oder `javascript:`-Links. Projektcode enthält keine Aufrufe von Cookies, localStorage, sessionStorage, IndexedDB, Service Worker, fetch, XHR, WebSocket, sendBeacon, gtag, dataLayer oder fbq; keine externen Fonts, iframes oder Social Embeds. CSS/JS zusammen rund 75 KB unkomprimiert. Bilder sind lokal und responsive Derivate sind vorhanden.

Die In-App-Browsersteuerung war wegen fehlender verwalteter Sandbox-Metadaten nicht verwendbar; Fallback war lokaler headless Chrome. Dessen GPU-Mailbox-Warnungen stammen vom Headless-Prozess, nicht vom Website-JavaScript.

### P2 — Lighthouse/axe nicht lokal verfügbar

Severity: P2
Page: alle
Viewport: n/a
Element: Audittooling
Observed: Keine lokal lauffähige Lighthouse-/axe-CLI erkannt.
Expected: Optional reproduzierbare Messung vor Livegang.
Evidence: Versionsprüfung lieferte keine installierte CLI.
Recommended fix: Bei finaler Live-Abnahme kuratiertes temporäres Tooling verwenden; keine Runtime-Abhängigkeit ergänzen.

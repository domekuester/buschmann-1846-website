# Buschmann 1846 — Control Tower

## Projekt und Ziel

Premium-Flagship-Präsenz der Buschmann 1846 Patisserie Catering in Düsseldorf. Statische bilinguale Website: Deutsch `/`, Englisch `/en/`; Rechtstexte: `/impressum/`, `/datenschutz/`, `/en/legal-notice/`, `/en/privacy/`.

## Gestaltung

Deep Navy, Brand Blue, Porcelain/Ivory, Champagne und Chocolate. Instrument Sans strukturiert; Newsreader setzt redaktionelle/historische Akzente. Hochwertig, warm, menschlich, editorial, präzise, Düsseldorfer Patisserie-Handwerk seit 1846. Keine Gradients, Glows, Glassmorphism, Blur-/Nebeleffekte, generischen Card-Grids, Startup-SaaS-Optik, sterile oder kitschige KI-Anmutung.

## Verbindliche Fakten

- Adresse: Akademiestraße 8, 40213 Düsseldorf.
- Samstag 12–17 Uhr. Verbindlich: „Samstags ist das Fenster offen.“ Niemals „die Tür offen“.
- Samstags: Kaffee, Kuchen, Servicefenster, Tische und Stühle draußen; kein Indoor-Café.
- Gregor August Buschmann nur bei der ersten ausführlichen Einführung; danach Gregor Buschmann oder Gregor. Claudia Fourmont danach Claudia. Immer Tyll Schulte/Tyll, niemals Till.
- DE: „Zitronen-Cheesecake mit Zitronenglasur“. EN: “Lemon cheesecake with lemon glaze”. Niemals Karamell erfinden.
- Instagram: https://www.instagram.com/buschmann1846/ — Facebook: https://www.facebook.com/Buschmannduesseldorf — nur Follow-Links; nie Bestellung, Buchung oder Cateringanfrage über Social Media behaupten.

## Technik und Sicherheit

Statische HTML/CSS/JS-Website, lokale Fonts und Bilder. Kein Tracking, Cookies, externe Embeds/Fonts, Analytics, Pixel, Kontaktformular oder Newsletter. Originalfotos nie überschreiben/löschen; keine Unternehmensdaten erfinden oder Steuernummer veröffentlichen. Während Audits: keine Commits, Pushes, Deploys oder Merges nach `main`; keine Hosting-, DNS-, Domain- oder GitHub-Pages-Konfiguration ändern. Bestehende `.claude/`- und Claude-Regeln erhalten; Faktenquellen unter `content/` beachten.

## Definition of Done

Nach visuellen Änderungen Desktop, Tablet und Mobile sowie DE/EN, alle Rechtstextseiten, Browserkonsole, Network, horizontales Overflow, Tastaturnavigation und Reduced Motion prüfen. Reviewer analysieren zuerst; `ui_fixer` arbeitet erst aus bestätigten Befunden. Abschluss mit `buschmann-release-check`, `git status`, `git diff --stat` und `git diff --check`; niemals automatisch veröffentlichen.

## Projekt-Skills

Unter `.agents/skills/` liegen die projektspezifischen Workflows für Visual QA, Responsive, Brand, Content/i18n, SEO/A11y und Release Check. Die Read-only-Reviewer unter `.codex/agents/` verwenden diese Skills; `ui_fixer` setzt ausschließlich bestätigte Befunde minimal um.

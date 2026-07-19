# RECOVERY-AUDIT — Buschmann 1846 Flagship-Rebuild

Stand: 19.07.2026 · Branch: `rebuild/flagship-recovery` · Erstellt in GATE 1, Phase 1

## 1. Tatsächliche Projektstruktur

```
buschmann-1846-rebuild/
├── .gitignore              (neu angelegt, Phase 0)
├── 01-originalfotos/       18 JPG-Fotos + Buschmann-Logo.png  (~160 MB)
├── 02-auswahl/             leer
├── 03-webbilder/           leer
├── 04-logo/                leer
├── content/                leer (wird in GATE 1 befüllt)
└── (concepts/              wird in GATE 1 angelegt)
```

## 2. Vorhandener Website-Code

**Keiner.** Es existieren keine `index.html`, `styles.css`, `script.js`,
`package.json`, `src/`, `public/`, `README.md`, `CLAUDE.md`, `AGENTS.md`,
keine Schriftdateien, keine alten Konzepte oder Screenshots.
Der frühere Projektordner ist vollständig verloren; nur die Fotos wurden
von Hand wieder eingefügt.

## 3. Verwendbare Dateien

- 18 Originalfotos (Lumix-Serie `P13xxxxx.jpg` + `Claudia.jpg`), Details in
  `IMAGE-INVENTORY.md`
- `Buschmann-Logo.png`: offizielles Logo, runde Navy-Marke mit weißer
  Linienzeichnung (Brezel, Torte, Kanne, Kochmütze), Schriftzug
  „Buschmann 1846 · Pâtisserie Catering", PNG mit Alphakanal

## 4. Fehlende Bestandteile

- kompletter Website-Code (HTML/CSS/JS)
- Schriftdateien (Newsreader, Instrument Sans — müssen als WOFF2 beschafft werden)
- optimierte Webbilder (03-webbilder ist leer)
- Logo in hoher Auflösung (vorhanden: nur 374 × 346 px)
- Favicon / Social-Preview-Bild
- alle Inhaltstexte

## 5. Vorhandene Bilder und Logos

19 Dateien in `01-originalfotos/`. 17 Hochformat-Fotos, 1 Querformat
(Fassade P1360101), 1 Logo. Vollständige Analyse: `IMAGE-INVENTORY.md`.

## 6. Git- und GitHub-Status

- Ordner war zu Beginn **kein** Git-Repository; kein übergeordnetes Repo.
- Nachbarordner `~/Desktop/buschmann-1846-website/` ist ein **leerer Klon**
  (0 Commits) mit Remote `https://github.com/domekuester/buschmann-1846-website.git`.
- Das GitHub-Repo `domekuester/buschmann-1846-website` existiert und ist
  **komplett leer** (keine Refs).
- Gewählte sicherste Lösung: `git init` direkt im Rebuild-Ordner (hier liegen
  die Assets), Remote auf dasselbe GitHub-Repo gesetzt, Branch
  `rebuild/flagship-recovery` angelegt, Sicherungs-Commit
  `chore: recover Buschmann source assets` erstellt und gepusht.
  Der leere Nachbarklon wurde nicht angetastet.
- `gh` ist als `domekuester` angemeldet (Scopes: repo, workflow).
- `main` existiert bisher weder lokal mit Inhalt noch auf GitHub —
  kein Merge ohne Freigabe.

## 7. Technische Risiken

1. **Logo-Auflösung** 374 px: für Header ok (~120–160 px Darstellung),
   für große Flächen/Retina zu klein. Kein Upscaling erzwingen.
2. **Repo-Größe**: ~160 MB Originalfotos im Git. Für dieses Projekt akzeptabel
   (alle Dateien < 100 MB GitHub-Limit); Webbilder kommen als optimierte
   Kopien dazu.
3. **Starke Farbtönung** einiger Fotos (Teal-Himmel Fassade, sehr warme
   Backstubenbilder). Zu respektieren, nicht zusätzlich tonen.
4. **Zwei sehr dunkle/abstrakte Fotos** sind nicht verwendbar (siehe
   IMAGE-REJECTIONS.md) — der Bildpool ist kleiner als die Dateizahl.
5. **Personenzuordnung** nur bei Claudia eindeutig (Dateiname). Louis, Till,
   Gregor: nicht durch Dateinamen belegt → Namen nur nach Bestätigung.

## 8. Mögliche Pfadprobleme

- GitHub Pages läuft unter `/buschmann-1846-website/` → ausschließlich
  relative Pfade (`assets/...`), keine root-absoluten `/assets/...`.
- Leerzeichen/Umlaute in Dateinamen vermeiden (aktuell keine vorhanden).
- `.DS_Store` liegt in mehreren Ordnern → per .gitignore ausgeschlossen.

## 9. Empfohlene Rekonstruktionsstrategie

1. Statische Ein-Seiten-Website (HTML + CSS + wenig JS), keine Frameworks —
   es gibt keine Altarchitektur, die weitergeführt werden könnte.
2. Struktur: `index.html`, `assets/css/`, `assets/js/`, `assets/img/`
   (optimierte Kopien aus 01-originalfotos), `assets/fonts/` (WOFF2 lokal).
3. Bilder als WebP in mehreren Breiten + JPG-Fallback, Crops pro Breakpoint
   über `<picture>` bzw. `object-position`.
4. Designsystem per CSS-Custom-Properties (siehe FINAL-DESIGN-SPEC.md).
5. Arbeit ausschließlich auf `rebuild/flagship-recovery`, Etappen-Commits,
   Merge nach main erst nach ausdrücklicher Freigabe.

## 10. Vollständig neu zu bauen

Alles außer Fotos und Logo: Markup, Styles, Skripte, Texte, optimierte
Bilder, Schriften, Meta/SEO, GitHub-Pages-Setup.

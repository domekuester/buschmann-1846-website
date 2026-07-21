# Buschmann 1846 — Website

Statische, zweisprachige Flagship-Website für Buschmann 1846,
Pâtisserie und Catering, Akademiestraße 8, 40213 Düsseldorf.

## Sprachfassungen

| Sprache | Datei | Veröffentlicht |
|---|---|---|
| Deutsch (Standard) | `index.html` | https://domekuester.github.io/buschmann-1846-website/ |
| Englisch | `en/index.html` | https://domekuester.github.io/buschmann-1846-website/en/ |

Zwei echte HTML-Seiten mit gemeinsamen Assets. Aus `en/` wird über
`../assets/…` referenziert — keine root-absoluten Pfade, damit der
GitHub-Pages-Unterpfad funktioniert. Beide Seiten sind ohne JavaScript
vollständig lesbar.

## Aufbau

```
index.html            deutsche Fassung
en/index.html         englische Fassung
assets/css/main.css   ein Stylesheet für beide Sprachen
assets/js/main.js     Mobilmenü, Bild-Reveal, Sprachanker
assets/img/           WebP + JPG, mehrere Breiten
assets/fonts/         Instrument Sans + Newsreader (lokal, variabel, OFL)
01-originalfotos/     Originale — nie überschreiben
03-webbilder/         build-images.py erzeugt assets/img/ reproduzierbar
content/              Fakten, Copy, Bildregie, QA-Berichte
sitemap.xml           beide Sprachfassungen mit hreflang
```

## Bilder neu erzeugen

```bash
python3 03-webbilder/build-images.py
```

Alle Ausschnitte stehen als Crop-Box im Skript, die Originale bleiben
unangetastet. Nach Änderungen an CSS oder JS die `?v=`-Nummer in **beiden**
HTML-Dateien hochzählen.

## Verbindliche Regeln

Fakten in `content/FACTS.md`, englische Begriffe und Tonalität in
`content/TRANSLATION-GUIDE.md`, Bildregie in `content/IMAGE-INVENTORY.md`.
Kurz:

- Öffnungszeit ist ausschließlich **Samstag 12–17 Uhr**; kein Innengastraum.
- **Zitronen-Cheesecake mit Zitronenglasur** — niemals Karamell.
- Instagram und Facebook nur zum Folgen, nie als Anfrage- oder Bestellweg.
- Gregor August Buschmann nur bei der Erstvorstellung, danach Gregor
  Buschmann. Tyll Schulte immer mit Y.

## Branch

Arbeitsstand: `rebuild/flagship-recovery` (zugleich GitHub-Pages-Quelle).

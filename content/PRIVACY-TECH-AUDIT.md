# Technischer Datenschutz-Audit – Buschmann 1846

**Stand:** 23.07.2026
**Branch:** rebuild/flagship-recovery
**Geprüft:** vollständige statische Codeanalyse aller ausgelieferten Dateien
plus tatsächliche Browser-Netzwerkprüfung (deutsche und englische Startseite,
Desktop 1440 px, kalter Cache).

> Hinweis: Dies ist eine **technische** Bestandsaufnahme des Websitecodes,
> keine Rechtsberatung. Sie beschreibt, was der Code tut und lädt. Die
> rechtliche Bewertung und die Formulierung von Datenschutzerklärung und
> Impressum bleiben dem Auftraggeber bzw. einer fachkundigen Person
> vorbehalten. **Es wurde nichts an der Website verändert.**

---

## Kurzfazit

Die Website ist eine **rein statische HTML/CSS/JS-Seite ohne jede externe
Ressource, die beim Seitenaufruf automatisch geladen würde.** Die
Browserprüfung mit kaltem Cache ergab auf beiden Sprachfassungen
ausschließlich Verbindungen zum eigenen Server (22 Requests deutsch, 21
englisch, alle Status 200, kein Fremd-Host).

Konkret wurden gefunden:

- **Kein** Tracking, **keine** Analyse, **kein** Werbe- oder Marketing-Skript.
- **Keine** Cookies, **kein** localStorage, **kein** sessionStorage, **kein**
  Service Worker.
- **Keine** Formulare, keine Kontakt-, Newsletter- oder Bestellfunktion.
- **Keine** Google Fonts, kein CDN — beide Schriften liegen lokal im Projekt.
- **Keine** Instagram-/Facebook-Einbettung, kein Meta-SDK, kein Social-Pixel.
- **Keine** Karte, kein YouTube/Vimeo, kein iframe, keine externe API.
- Instagram und Facebook sind **ausschließlich normale Hyperlinks**, die erst
  nach einem Klick aufgerufen werden.

Aus rein technischer Sicht überträgt die Seite beim bloßen Aufruf **keine
personenbezogenen Daten an Dritte** und legt **keine zustimmungspflichtigen
Speichertechniken** an. Die einzige Datenverarbeitung, die zwangsläufig
stattfindet, sind die **Server-Logfiles des Hosters** (z. B. IP-Adresse beim
Abruf) — die aber nicht aus dem Websitecode hervorgeht und vom endgültigen
Hostinganbieter abhängt.

**Ein technischer Nebenbefund** (kein Website-Fehler, aber für den Launch
relevant): Im Repository liegt unter `concepts/recovery-flagship/`
`flagship-concept.html` — eine **interne Konzeptdatei aus GATE 1, die
Google Fonts extern nachlädt.** Sie ist aus der Website nirgends verlinkt,
würde aber über GitHub Pages theoretisch unter ihrer Pfad-URL erreichbar sein.
Details unten unter „Technische offene Punkte vor dem Launch".

---

## Automatisch kontaktierte externe Domains

**Ergebnis der Browserprüfung (kalter Cache, beide Sprachen):**

| Seite | Requests gesamt | davon an fremde Domains |
|---|---|---|
| Deutsch (`/`) | 22 | **0** |
| Englisch (`/en/`) | 21 | **0** |

Jeder einzelne Request ging an den eigenen Server (im Test `localhost`, im
Betrieb die eigene Domain): HTML, `main.css`, `main.js`, zwei WOFF2-Schriften,
das Logo und die WebP-Bilder. Alle Status 200, kein fehlgeschlagener Request.

**Es wird beim Seitenaufruf keine einzige externe Domain automatisch
kontaktiert.**

---

## Normale externe Hyperlinks

Diese Links führen zu externen Seiten, werden aber **erst nach einem
Nutzerklick** aufgerufen. Beim bloßen Laden der Seite entsteht dadurch **keine**
Verbindung.

| Ziel | Fundstelle | Zeilen | Art |
|---|---|---|---|
| `https://www.instagram.com/buschmann1846/` | index.html · en/index.html | DE 481 / EN 482 | Hyperlink im „Folgen"-Block (Standort), `target="_blank" rel="noopener noreferrer"` |
| `https://www.facebook.com/Buschmannduesseldorf` | index.html · en/index.html | DE 494 / EN 495 | Hyperlink im „Folgen"-Block (Standort), `target="_blank" rel="noopener noreferrer"` |

Dieselben beiden URLs stehen zusätzlich als reine **Metadaten** im JSON-LD
(`sameAs`, index.html Zeile 57–58) — das ist ein Textwert im strukturierten
Datensatz, **keine** ladende Ressource.

Reine Referenz-URLs ohne Netzwerkwirkung (Namensräume/Kanonisierung, keine
abgerufene Ressource):

- `https://schema.org` — Vokabular-Bezeichner im JSON-LD (kein Abruf).
- `http://www.sitemaps.org/...` und `http://www.w3.org/1999/xhtml` — XML-
  Namensräume in `sitemap.xml` (kein Abruf).
- `https://domekuester.github.io/buschmann-1846-website/...` — die eigene
  veröffentlichte Adresse in Canonical, hreflang, OG-Tags, Sitemap, robots.txt.

---

## Tracking und Analyse

Gezielt gesucht und **nicht gefunden** (0 Treffer in index.html, en/index.html,
main.css, main.js):

Google Analytics · Google Tag Manager · `gtag` · `ga()` · `dataLayer` ·
Meta/Facebook Pixel · `fbq` · `connect.facebook` · Matomo/Piwik · Plausible ·
Fathom · Hotjar · Microsoft Clarity · TikTok Pixel · Pinterest Tag ·
LinkedIn Insight · Segment · Mixpanel · Amplitude · Sentry · DoubleClick ·
Google Ads/AdSense · Criteo.

**Ergebnis: kein Tracking und keine Analyse vorhanden.**

---

## Cookies und Browserspeicher

Gezielt gesucht und **nicht gefunden**:
`document.cookie` · Cookies · `localStorage` · `sessionStorage` · `indexedDB` ·
Cache Storage · Service Worker · `navigator.storage`.

Die Browserprüfung bestätigte das nach vollständigem Laden beider Seiten:
`document.cookie` leer, 0 Einträge in localStorage, 0 in sessionStorage.

**Keine Cookies und kein Browser-Speicher im Websitecode gefunden.**

Hinweis: Das kleine Inline-Skript `document.documentElement.classList.add('js')`
(index.html Zeile 31) setzt nur eine CSS-Klasse für das Reveal — es speichert
nichts. `main.js` verwaltet ausschließlich das Menü, den Sprachanker, den
kompakten Header beim Scrollen und das einmalige Bild-Reveal; es liest oder
schreibt keinerlei Speicher.

---

## Formulare und Datenübermittlung

Gezielt gesucht und **nicht gefunden**:
`<form>` · `<input>` · `<textarea>` · `<select>` · `action=` · Datei-Upload ·
Login · Zahlungsfunktion · `mailto:` · `tel:` · WhatsApp-Link ·
Formspree · Netlify Forms · Mailchimp · Brevo/Sendinblue · Getform · Basin ·
Web3Forms.

Ebenfalls **nicht gefunden** (JavaScript-Netzwerkfunktionen):
`fetch(` · `XMLHttpRequest` · `WebSocket` · `EventSource` · `sendBeacon` ·
dynamisch erzeugte `<script>`- oder `<img>`-Tags · `import()`.

**Die Seite übermittelt keine Daten. Es gibt keinen Kanal, über den ein
Besucher Daten eingeben oder absenden könnte.** Es gibt auch keinen
`mailto:`- oder `tel:`-Link.

---

## Instagram und Facebook

Beide sind **ausschließlich als normale Hyperlinks** eingebunden (siehe oben),
mit korrekten Zieladressen:

- Instagram: `https://www.instagram.com/buschmann1846/`
- Facebook: `https://www.facebook.com/Buschmannduesseldorf`

Geprüft und **nicht vorhanden**: keine Instagram-Einbettung, kein Instagram-
Feed, kein Facebook-Feed, kein Meta-SDK, kein Social-Pixel, keine
`platform.instagram`/`platform.twitter`-Widgets, keine automatische
Meta-Verbindung beim Seitenaufruf.

Qualität der Links: `target="_blank"` und `rel="noopener noreferrer"` gesetzt,
zugängliche Linknamen über `aria-label` (deutsch „…, öffnet in neuem Tab" /
englisch „…, opens in a new tab").

---

## Schriftarten

Beide Schriften werden **vollständig lokal** aus dem Projekt geladen. Es gibt
**keine** Verbindung zu Google Fonts, Adobe Fonts oder einem anderen externen
Anbieter.

`@font-face` in `assets/css/main.css`:

| Schrift | Quelle | Datei |
|---|---|---|
| Newsreader | lokal (Zeile 22) | `assets/fonts/newsreader-normal-latin.woff2` |
| Instrument Sans | lokal (Zeile 29) | `assets/fonts/instrument-sans-normal-latin.woff2` |

Beide Dateien liegen im Projekt vor (nebst je einem kursiven Schnitt, der
laut Kommentar bewusst nicht per `@font-face` deklariert ist, um ihn nicht
nachzuladen). Die einzigen `url()`-Angaben im gesamten CSS zeigen auf genau
diese zwei lokalen Dateien. Die beiden `<link rel="preload" … crossorigin>`
im `<head>` laden ebenfalls nur diese lokalen WOFF2-Dateien; `crossorigin` ist
bei Fonts technisch notwendig und hat hier keine Datenschutzwirkung, da die
Quelle die eigene Domain ist.

**Schriften vollständig lokal — keine externe Font-Verbindung.**

---

## Bilder und Medien

- **Alle** Websitebilder liegen lokal unter `assets/img/` (WebP + JPG-
  Fallback). In der Browserprüfung wurde jedes Bild vom eigenen Server geladen.
- **Keine** externen Bilder, **keine** `srcset`-Einträge mit absoluter URL.
- **Keine** Videos, **keine** Audiodateien, **kein** `<video>`/`<audio>`.
- **Keine** iframes, kein `<embed>`, kein `<object>`.
- Das Open-Graph-Bild (`og:image`) ist **nur ein Metadatum** für Vorschauen in
  sozialen Netzwerken; es wird beim normalen Seitenaufruf nicht geladen und
  zeigt auf die eigene Domain.

---

## Hosting und Server-Logfiles

**Aktuelle Vorschau:** GitHub Pages
**Veröffentlichte Vorschauadresse:** `https://domekuester.github.io/buschmann-1846-website/`

Aus dem Websitecode selbst geht **keine** serverseitige Datenverarbeitung
hervor (kein Backend, keine Datenbank, keine API). Wie jeder Webserver
verarbeitet der Hoster jedoch beim Abruf technisch notwendige Daten in
**Server-Logfiles** (typischerweise IP-Adresse, Zeitpunkt, angeforderte Datei,
User-Agent). Diese Verarbeitung liegt beim Hoster, nicht im Code.

**Wichtig — noch offen und nicht aus dem Code ermittelbar:**

> Die endgültige Kundendomain und der endgültige Hostinganbieter müssen noch
> bestätigt werden.

Aus dem Websitecode **nicht** ermittelbar und deshalb hier bewusst **nicht**
angegeben: finaler Hoster, Serverstandort, Logfile-Speicherdauer, ob ein
Auftragsverarbeitungsvertrag besteht, Unterauftragnehmer. Solange die Vorschau
auf GitHub Pages läuft, ist GitHub (GitHub, Inc. / Microsoft) der Betreiber
und dessen Datenschutzbedingungen gelten — das sollte beim Wechsel auf die
endgültige Domain überprüft und ersetzt werden.

---

## Technisches SEO

Ohne Änderung geprüft:

| Merkmal | Deutsch | Englisch | Befund |
|---|---|---|---|
| `<title>` | vorhanden | vorhanden | ok |
| `meta description` | vorhanden | vorhanden | ok |
| `lang`-Attribut | `de` | `en` | ok |
| Canonical | gesetzt | gesetzt | ok |
| hreflang (de/en/x-default) | vorhanden | vorhanden | ok |
| Open Graph | vorhanden | vorhanden | ok |
| Twitter Card | `summary_large_image` | vorhanden | ok |
| JSON-LD (`Bakery`) | vorhanden | vorhanden | Adresse + Öffnungszeit korrekt |
| Adresse | Akademiestraße 8, 40213 Düsseldorf | dito | ok |
| Öffnungszeit | Samstag 12–17 Uhr | dito | ok |
| `sitemap.xml` | vorhanden | — | listet DE + EN |
| `robots.txt` | `Allow: /`, verweist auf Sitemap | — | ok |
| **Impressumslink** | **fehlt** | **fehlt** | rechtlich vor Launch nötig |
| **Datenschutzlink** | **fehlt** | **fehlt** | rechtlich vor Launch nötig |
| localhost / lokale Mac-Pfade | keine | keine | ok |
| tote Links | keine gefunden | keine gefunden | ok |

**URLs, die beim Anschluss der endgültigen Domain angepasst werden müssen**
(überall ist aktuell `https://domekuester.github.io/buschmann-1846-website/`
fest eingetragen):

- `index.html` / `en/index.html`: Canonical, hreflang (3×), `og:url`,
  `og:image`, Twitter-Image, JSON-LD `url` und `image`.
- `sitemap.xml`: alle `<loc>`-Einträge und die hreflang-Alternates.
- `robots.txt`: die `Sitemap:`-Zeile.

---

## Cookie-Banner-Einschätzung

**Einschätzung: A — Es wurden keine zustimmungspflichtigen Tracking-,
Marketing- oder Fremddienste gefunden.**

Technische Begründung:

1. Beim Seitenaufruf wird **keine externe Domain** kontaktiert (durch
   Browser-Netzwerkprüfung mit kaltem Cache belegt: 0 Fremd-Requests).
2. Es werden **keine Cookies** gesetzt und **kein** localStorage/sessionStorage
   verwendet (im Code nicht vorhanden, im Browser nach dem Laden leer).
3. Es gibt **kein** Tracking-, Analyse- oder Marketing-Skript.
4. Schriften und Bilder liegen **lokal**; es entsteht keine Drittserver-
   Verbindung (wie sie z. B. Google Fonts oder ein CDN auslösen würde).

Ein **Cookie-Banner ist technisch mit hoher Wahrscheinlichkeit nicht
erforderlich**, weil weder Cookies noch andere einwilligungspflichtige
Speicher- oder Trackingtechniken zum Einsatz kommen. Diese Aussage ist
**technisch** begründet und **keine** verbindliche Rechtsberatung.

Unabhängig davon gehören einige Angaben **trotzdem** in eine
Datenschutzerklärung (siehe nächster Abschnitt) — vor allem die
serverseitige Logfile-Verarbeitung des Hosters und die externen Social-Links.

---

## Angaben, die noch vom Kunden benötigt werden

Diese Angaben lassen sich **nicht** aus dem Code ermitteln und müssen vom
Auftraggeber kommen (für Impressum und Datenschutzerklärung):

- Vollständiger Firmen-/Inhabername und ladungsfähige Anschrift für das
  Impressum.
- Kontakt (E-Mail/Telefon) für das Impressum.
- ggf. Umsatzsteuer-ID / Registereintrag, falls vorhanden.
- Verantwortliche Person im Sinne des Datenschutzes.
- Bestätigung, dass Instagram/Facebook nur als Link (nicht als Kanal für
  Anfragen) genannt werden sollen — deckt sich mit dem aktuellen Code.
- Ob künftig ein Kontaktweg (Formular/E-Mail) ergänzt werden soll — aktuell
  gibt es keinen; käme einer hinzu, wäre der Audit zu wiederholen.

---

## Angaben, die noch vom endgültigen Hostinganbieter benötigt werden

Ebenfalls **nicht** aus dem Code ermittelbar:

- Name und Anschrift des endgültigen Hosters.
- Serverstandort.
- Inhalt und **Speicherdauer der Server-Logfiles** (insb. IP-Adressen).
- Ob ein **Auftragsverarbeitungsvertrag (AVV)** vorliegt/nötig ist.
- Etwaige Unterauftragnehmer (z. B. CDN des Hosters).
- Bei Verbleib auf GitHub Pages: Verweis auf GitHub als Betreiber und dessen
  Datenschutzbedingungen (US-Anbieter).

---

## Empfohlener Inhalt der Datenschutzerklärung

Auf Basis des **tatsächlich gefundenen** Codes sollte eine
Datenschutzerklärung mindestens abdecken (Formulierung durch fachkundige
Person):

- **Verantwortlicher** (Name/Anschrift/Kontakt — vom Kunden).
- **Server-Logfiles / Hosting**: welche Daten der Hoster beim Abruf verarbeitet,
  Rechtsgrundlage, Speicherdauer (vom Hoster).
- **Keine Cookies / kein Tracking**: kann ausdrücklich klargestellt werden, weil
  technisch belegt.
- **Lokale Schriftarten**: Hinweis, dass keine externen Fonts (z. B. Google
  Fonts) geladen werden — häufiger Abmahnpunkt, hier bereits sauber gelöst.
- **Social-Media-Links**: Hinweis, dass Instagram/Facebook nur verlinkt sind
  und erst beim Klick eine Verbindung zu Meta entsteht; ggf. kurzer Verweis auf
  deren Datenschutz.
- **Betroffenenrechte** (Auskunft, Löschung usw.) — Standardteil.

Nicht aufzunehmen (weil nicht vorhanden): Kontaktformular, Newsletter, Analyse,
Cookies, Karten, eingebettete Videos, Zahlungsdienste.

---

## Technische offene Punkte vor dem Launch

1. **Konzeptdatei mit Google Fonts entfernen oder vom Deployment ausschließen.**
   `concepts/recovery-flagship/flagship-concept.html` (interne GATE-1-Datei,
   nicht produktiv) lädt in Zeile 7–9 Google Fonts extern
   (`fonts.googleapis.com`, `fonts.gstatic.com`). Sie ist aus der Website
   **nicht** verlinkt und wird beim normalen Seitenaufruf nie geladen — über
   GitHub Pages wäre sie aber unter ihrer Pfad-URL erreichbar und würde dann
   externe Fonts nachladen. Vor dem Livegang aus dem veröffentlichten Stand
   herausnehmen (oder Pages so konfigurieren, dass `concepts/` nicht mit
   ausgeliefert wird). *(Keine Änderung im Rahmen dieses Audits vorgenommen.)*
2. **Impressum und Datenschutzerklärung** anlegen und im Footer verlinken
   (aktuell bewusst kein toter Link — siehe `content/TODO.md`).
3. **Absolute URLs** auf die endgültige Domain umstellen (Liste im Abschnitt
   „Technisches SEO").
4. Nach Domainwechsel `og:image`-URL prüfen (bereits in `content/TODO.md`
   vermerkt).
5. Falls später ein Kontaktweg (Formular, E-Mail, Karte, Einbettung) ergänzt
   wird: diesen Audit wiederholen — die aktuelle „kein Banner nötig"-Lage gilt
   nur für den heutigen, dienstefreien Stand.

---

## Übersichtstabelle

| Funktion | Vorhanden | Datenschutzrelevant | Maßnahme |
|---|---|---|---|
| Google Analytics | Nein | — | keine |
| Google Tag Manager / gtag | Nein | — | keine |
| Meta / Facebook Pixel (fbq) | Nein | — | keine |
| Sonstiges Tracking (Matomo, Plausible, Hotjar, Clarity, TikTok, LinkedIn …) | Nein | — | keine |
| Cookies | Nein | — | keine |
| localStorage / sessionStorage | Nein | — | keine |
| Service Worker / Cache Storage | Nein | — | keine |
| Externe Schriften (Google/Adobe Fonts) | Nein (lokal) | Nein | in DS-Erklärung positiv erwähnen |
| Instagram-Feed / -Einbettung | Nein | — | keine |
| Facebook-Feed / Meta-SDK | Nein | — | keine |
| Normale Social-Links (IG/FB) | Ja | gering (erst bei Klick) | in DS-Erklärung erwähnen |
| Kontaktformular | Nein | — | keine |
| Newsletter | Nein | — | keine |
| Google Maps / Karte | Nein | — | keine |
| YouTube / Vimeo / Video | Nein | — | keine |
| iframe / Embed / Widget | Nein | — | keine |
| Externe API / fetch / Beacon | Nein | — | keine |
| mailto: / tel: | Nein | — | keine |
| Server-Logfiles (Hoster) | Ja (extern) | Ja | Angaben vom Hoster, in DS-Erklärung |
| Zweisprachige Website (DE/EN) | Ja | Nein | beide Fassungen datenschutz-identisch |
| Impressum / Datenschutz-Link | Nein | Ja (rechtlich) | vor Launch ergänzen |
| Konzeptdatei mit Google Fonts (`concepts/`) | Ja (nicht verlinkt) | potenziell | vor Launch vom Deployment ausschließen |

---

*Geprüft am 23.07.2026 auf Branch rebuild/flagship-recovery. Methodik:
statische Mustersuche über alle ausgelieferten HTML/CSS/JS/Text-Dateien +
Browser-Netzwerkprüfung beider Sprachfassungen mit kaltem Cache. Es wurde
ausschließlich gelesen und gemessen; keine Datei der Website wurde verändert.*

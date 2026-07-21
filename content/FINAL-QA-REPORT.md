# FINAL-QA-REPORT — Flagship-Detaildurchgang

Stand: 19./20.07.2026 · Branch `rebuild/flagship-recovery`
Geprüft im Browser (Chromium über Playwright) unter `http://localhost:8765/`.
Alle Zahlen sind gemessen, nicht geschätzt.

---

## 1 · Headerlinien — der gemeldete Versatz

### Ausgangszustand

Der gemeldete Eindruck war ein vertikaler Versatz der rechten Linie. Die
Messung zeigt: **die beiden Linien lagen vertikal exakt gleich** — beide
Pseudo-Elemente hatten `top: 41.5px`. Die Ursache war eine andere, und zwar
eine doppelte:

**a) Horizontale Asymmetrie von 81 px.** Beide Navigationsgruppen trugen
`background: var(--navy-brand)` und verdeckten damit die Linie. Die linke
Gruppe ist 284 px breit (zwei Einträge), die rechte 365 px (drei Einträge).
Dadurch endete das sichtbare linke Liniensegment 336 px von der Mitte
entfernt, das rechte begann erst 417 px von der Mitte entfernt:

| | links | rechts | Differenz |
|---|---|---|---|
| sichtbare Länge | 336 px | 255 px | 81 px |
| Innenende ab Mitte | 336 px | 417 px | 81 px |

**b) Beide Farbverläufe endeten im Verdeckten.** Die Linien liefen
`transparent → champagne` bzw. gespiegelt; das helle Ende lag jeweils hinter
der Navigation. Sichtbar blieben nur die beiden ausgeblichenen Enden — an
unterschiedlichen Punkten des Verlaufs, also mit unterschiedlicher Helligkeit.

**c) Zusätzlich lag die Linie 6,6 px über der Medaillonmitte.** Das Logo war
96 px hoch in einem 84 px hohen Header, lief also unten über und war gar nicht
mittig. Die Unterkante des Headers schnitt durch das überstehende Logo.

### Änderung

Die Logodatei wurde vermessen: die Scheibe ist ein Kreis von **299 × 300 px**,
ihr Mittelpunkt liegt bei **50,14 % der Bildhöhe**. Daraus ist die gesamte
Headergeometrie neu abgeleitet:

```
--head-logo-w      84px            Logobreite = Ausgangswert
--head-logo-ratio  .92513          346/374 der Logodatei
--head-logo-h      w × ratio       Logohöhe
--head-medallion   .5014           Scheibenmitte in der Logodatei
--head-pad-y       9px
--head-bar-h       logo-h + 2·pad  Headerhöhe folgt dem Logo
--head-rule-y      pad + logo-h × medallion
--head-rule-len    clamp(1.5rem, 2.6vw, 2.75rem)
--head-rule-inset  10px
--head-logo-gap    rule-len + 2·inset
```

Beide Linien haben jetzt **dieselbe `width` und gespiegelte Anker**
(`right:` bzw. `left: calc(50% + logo-half + inset)`). Sie sind dadurch
symmetrisch per Konstruktion, nicht per Zahlenwert. Die Luft neben dem Logo
leitet sich aus der Linienlänge ab, nicht umgekehrt — dadurch hat die Linie
immer ihre gestaltete Länge und beidseitig exakt 10 px Abstand.

Die Navigation trägt keinen Navy-Hintergrund mehr; die Linien leben
ausschließlich in der Luft zwischen Logo und Navigation und können die
Navigation gar nicht mehr durchstreichen.

### Browserergebnis

| Breite | Länge L | Länge R | Δ Länge | Δ Spiegelung | Δ Medaillon | Abstand Nav L/R |
|---|---|---|---|---|---|---|
| 1024 | 26,62 | 26,62 | 0 | 0 | 0,51 px | 10 / 10 |
| 1152 | 29,94 | 29,94 | 0 | 0 | 0,51 px | 10 / 10 |
| 1280 | 33,27 | 33,27 | 0 | 0 | 0,51 px | 10 / 10 |
| 1366 | 35,52 | 35,52 | 0 | 0 | 0,51 px | 10 / 10 |
| 1440 | 37,60 | 37,60 | 0 | 0 | 0,51 px | 10 / 10 |
| 1680 | 43,68 | 43,68 | 0 | 0 | 0,51 px | 10 / 10 |
| 1920 | 44,00 | 44,00 | 0 | 0 | 0,51 px | 10 / 10 |

Der Restwert von 0,51 px zur Medaillonmitte ist die Rundung von `--head-medallion`
(0,5014) und liegt unter einem Gerätepixel.

Das Logo passt jetzt bei jeder geprüften Breite vollständig in den Header
(`logoFits: true`), die Headerunterkante schneidet es nicht mehr.

### Zoom

Echter Browserzoom wurde **nicht** über `body { zoom }` geprüft — dabei liefern
`getComputedStyle` (unskaliert) und `getBoundingClientRect` (skaliert)
gemischte Bezugssysteme und damit unbrauchbare Zahlen. Stattdessen wurde der
Zoom über die proportional verkleinerte CSS-Viewport-Breite simuliert, was dem
entspricht, was echter Zoom tatsächlich verändert:

- 125 % von 1440 → 1152 px: symmetrisch, Δ 0, keine Überläufe
- 150 % von 1440 → 960 px: unter dem Breakpoint, Header schaltet auf mobil,
  Linien sind ausgeblendet — sie können dort nicht asymmetrisch werden

### Mobil

Die Linien sind unter 1024 px abgeschaltet. Eine an der Navigation
abgeschnittene halbe Linie wäre schlechter als gar keine. Logo (62 px) und
Menübutton stehen sauber auf der Seitenachse, Menübutton 44 px hoch.

---

## 2 · Galerie — Rhythmus und Kuratierung

### Ausgangszustand

Die Spur mit dem Personenbild war die **schmalste** Spalte (266 px) und
endete mit **31,5 % Leerraum** darunter — der wichtigste menschliche Moment
der Sequenz war das schwächste Element:

| Spur | Start | Ende | Leerraum |
|---|---|---|---|
| 1 copper | 0 | 944 | 266 px = 22,0 % |
| 2 almonds+cherries | 104 | 1210 | 0 |
| 3 team | 296 | 829 | **381 px = 31,5 %** |
| 4 piping | 480 | 1094 | 116 px = 9,6 % |

### Änderung

Spaltenbreiten folgen jetzt der redaktionellen Gewichtung
(`.80fr .95fr 1.05fr 1.20fr`), das Kirschdetail ist von Spur 2 nach Spur 3
gewandert, damit die Begegnung die breitere Spalte bekommt und ihre Spur
trägt. Die Einsatzhöhen sind bewusst nicht monoton von links nach rechts —
eine gleichmäßige Treppe läse sich wieder als Raster.

### Browserergebnis (1440)

| Spur | Breite | Start | Ende | Leerraum |
|---|---|---|---|---|
| 1 copper | 232 | 0 | 930 | 7,8 % |
| 2 almonds | 276 | 176 | 866 | 14,2 % |
| 3 team + cherries | 305 | 88 | 1009 | 0 % |
| 4 piping | 349 | 328 | 938 | 7,0 % |

Boardhöhe von 1210 auf 1009 px verdichtet, größter Leerraum von 31,5 % auf
14,2 % reduziert.

### Crops

| Bild | Änderung | Grund |
|---|---|---|
| `window-team` | Quellcrop `(527,750,1674,2470)` → `(629,950,1571,2470)` | Tote Fläche über den Köpfen weg, Gesichter von 48 % auf 45 % Höhe, Leuchtpfeil nur noch Kontext statt Hauptmotiv |
| `piping` | Quellcrop neu `(321,0,2538,3600)` | Leere Kachelwand links und dunkler Boden weg; Kopf, Hände und Kanne bleiben zusammen lesbar |
| `g-copper` | `--ratio 2/5 → 1/4`, `--fx 55%` | Langes, schmales Materialband als Auftakt |
| `g-almonds` | `--ratio 1/2 → 2/5` | Schlankes Zwischenmotiv statt Produktfoto |
| `g-team` | `--ratio 1/2 → 5/8`, breitere Spalte | Begegnung trägt die Spur |
| `g-cherries` | `--ratio 2/3 → 3/4`, `--fy 45%` | Schließt Spur 3 ab |
| `sam-claudia` | `--ratio 2/3 → 3/5` | Schneidet gleichzeitig Lederrücken links und tote weiße Wand rechts an, Claudia füllt mehr Fläche |

### Bildrahmen

Die Champagnerkante lag auf **7 von 13 Bildern** — das war wieder ein
Rahmensystem, keine Ausnahme. Sie liegt jetzt auf **genau einem** Bild: unter
dem Kupferband, das die Bildstrecke eröffnet. Der Hero trägt seine eigene
Kante als Kante zur Navy-Fläche. Sonst: `figuresWithBorder: 0`,
`captionsPresent: 0`.

---

## 3 · Samstagsbereich

Das Kaffeedetail hing auf einem freien Rechtsversatz (`margin-left: auto`) und
ließ die Spalte unten in leeres Navy auslaufen. Es sitzt jetzt auf **derselben
linken Achse wie der Text** (beide 106 px), die Restfläche liest sich als
Bundsteg. Claudia ist von 519 × 778 auf 519 × 865 gewachsen; der
Höhenunterschied der beiden Spalten liegt bei 110 px.

---

## 4 · Linkprüfung

Alle Links wurden tatsächlich navigiert, nicht nur auf `href` geprüft.

### Interne Anker — 7 von 7 in Ordnung

`#main`, `#top`, `#geschichte`, `#patisserie`, `#catering`, `#samstag`,
`#standort`. Jeder Abschnitt landet auf `scroll-margin-top` (111,4 px mobil /
136,7 px Desktop), **jede Zielüberschrift steht frei unter dem Sticky-Header**
(`headingClearsHeader: true` in allen 7 Fällen).

Zwischenbefund: Ein Testlauf zeigte die Standort-Headline bei −120 px. Das war
ein Artefakt der Testreihenfolge (Navigation von einer externen Seite,
manipuliertes `scrollBehavior`). Auf einem echten Seitenaufruf mit sofort
ausgelöstem Anker landet sie korrekt bei 216 px. Zusätzlich mit
PerformanceObserver gegengemessen: **CLS = 0, null Layout-Shifts**, keine
Sektion ändert ihre Höhe beim Nachladen, alle Bilder reservieren ihren Platz.

### Instagram

`https://www.instagram.com/buschmann1846/` → **HTTP 200**, im Browser geöffnet:
Titel „Buschmann1846 (@buschmann1846) • Instagram-Fotos und -Videos". Korrekt.

### Facebook

`https://www.facebook.com/Buschmannduesseldorf` → curl meldet **HTTP 400**.
Gegenprobe: `facebook.com/facebook` liefert demselben Client **ebenfalls 400**.
Facebook blockt also den Nicht-Browser-Client unabhängig davon, ob die Seite
existiert — der Statuscode sagt nichts über unsere URL aus.

Im echten Browser geöffnet: Titel **„Buschmann 1846 | Facebook"**. Die Seite
existiert, der Link ist korrekt. **An der Website wurde deshalb nichts
geändert.**

### Social-Attribute

Beide Links: echte `<a>`, `target="_blank"`, `rel="noopener noreferrer"`,
aussagekräftiges `aria-label`, Icon und Text im selben Anchor, SVG
`aria-hidden`, Trefferfläche 176 × 44 bzw. 211 × 44 px. Projektweit **genau
zwei** Social-Anker. Kein JavaScript, kein `preventDefault`, keine SDKs.

### Impressum / Datenschutz

Existieren nicht und sind bewusst **nicht** verlinkt — keine toten Links.
Offen in `content/TODO.md`.

---

## 5 · Mobilmenü

Vollständig durchgespielt: öffnet zuverlässig, `aria-expanded` wechselt
true/false, `aria-controls="mmenu"`, Fokus springt auf den Schließen-Button,
**Fokusfalle greift in beide Richtungen** (Tab vom letzten Element springt auf
das erste, Shift+Tab vom ersten auf das letzte, Fokus bleibt im Menü), Escape
schließt und gibt den Fokus an den Menübutton zurück, Klick auf einen
Navigationspunkt schließt und navigiert, `body`-Scroll wird gesperrt und
wieder freigegeben. Menülinks 44 px hoch.

---

## 6 · Geprüfte Viewports

**Desktop:** 1024 × 768, 1152 × 720, 1280 × 800, 1366 × 768, 1440 × 900,
1680 × 1050, 1920 × 1080
**Tablet:** 768 × 1024, 820 × 1180
**Mobil:** 320 × 568, 360 × 800, 375 × 667, 390 × 844, 393 × 852, 430 × 932
**Zoomäquivalent:** 960 × 600

Kein horizontales Scrollen bei irgendeiner Breite, keine Elemente über der
Viewportkante, „Akademiestraße 8." bei 820 px vollständig lesbar.

---

## 7 · Accessibility

- Überschriftenfolge H1 → H2 → H3 → H4, genau ein H1
- Keine doppelten IDs, kein Bild ohne Alt-Text
- Skip-Link vorhanden, Fokuszustände sichtbar (2 px Champagner-Outline)
- Reduced-Motion-Block deaktiviert Reveals, Hover-Versatz und Smooth-Scroll
- Keine Trefferfläche unter 24 px (Footerlinks bekamen `display:inline-block`
  plus Polsterung), Social-Links 44 px

### Kontraste (WCAG AA, gerechnet)

| Kombination | Ratio |
|---|---|
| Kicker `--champagne-ink` auf Porzellan | 5,56 |
| Kicker `--champagne-ink` auf Elfenbein | 5,01 |
| Fließtext auf Porzellan | 10,84 |
| Champagner-hell auf Buschmann-Navy | 9,19 |
| Champagner-hell auf Markenblau | 6,15 |
| Fließtext hell (82 %) auf Markenblau | 6,84 |
| Footer-Grundzeile (58 %) auf Nacht-Navy | 5,82 |

`--champagne-dark` (#9A6E30) bleibt als Markenfarbe erhalten, erreicht aber als
11-px-Versalie nur 3,87:1 auf Elfenbein. Für Text wird deshalb die Abtönung
`--champagne-ink` (#855D26) verwendet.

---

## 8 · Performance

- 16 Bilder, **0 defekt**, **0 fehlgeschlagene Requests**, **0 Konsolenmeldungen**
- Nur zwei Bilder laden `eager`: Header-Signet und Hero (`fetchpriority="high"`),
  alle übrigen `lazy`
- Alle Bilder mit `width`/`height`, `srcset` und `sizes`; keine Doppel-Downloads
- **CLS = 0**
- Ein einziges Skript (`main.js`), keine externen Requests

**Gefundener Fehler:** `instrument-sans-italic-latin.woff2` (31,8 kB) wurde bei
jedem Aufruf geladen, obwohl die Seite **nirgends** kursiv setzt (0 kursive
Elemente, 0 kursive Pseudo-Elemente). Ursache: die dekorativen
Abschnittsmarken waren `<i class="k-mark">`, und `<i>` ist im
Browser-Standard kursiv. Behoben in zwei Schritten:

1. `<i class="k-mark">` → `<span class="k-mark">` (eine dekorative Form ist
   ohnehin kein idiomatischer Text)
2. Die ungenutzten kursiven `@font-face`-Deklarationen entfernt

Schriftlast damit von 190 kB auf **158 kB** gesenkt (−17 %). Die Dateien
bleiben unter `assets/fonts/` liegen; wird Kursivsatz je gebraucht, hier
wieder deklarieren (Newsreader italic wiegt 147 kB).

---

## 9 · Verbleibende begründete Einschränkungen

1. **Impressum und Datenschutz fehlen.** Rechtstexte werden nicht erfunden;
   vor Veröffentlichung zwingend nötig. Siehe `content/TODO.md`.
2. **`og:image` zeigt auf `domekuester.github.io`.** Erst nach einer
   Pages-Aktivierung gültig — diese wurde auftragsgemäß nicht vorgenommen.
3. **Personennamen an Fotos** bleiben unbelegt außer „Claudia"; Alt-Texte
   bleiben deshalb generisch („Bäcker", „Mitarbeiterin").
4. **Zoom** wurde über proportionale Viewport-Breiten geprüft, nicht über die
   Zoomstufe des Browserfensters (siehe Begründung in Abschnitt 1).
5. **Bildrechte** für die Originalfotos sind nicht dokumentiert.
6. Geprüft wurde ausschließlich in Chromium. Safari und Firefox wurden in
   dieser Umgebung nicht getestet.

---

# NACHTRAG — Mobile-Editorial-Masterpass

Stand: 20./21.07.2026 · Branch `rebuild/flagship-recovery`
Geprüft im Browser (Chromium über Playwright) unter `http://localhost:8899/`.
Alle Zahlen sind gemessen, nicht geschätzt.

## A · Ausgangsproblem der Mobilversion

Bei 390 × 844 gemessen — sechs Motive belegten mehr als die Hälfte des
Bildschirms, die Seite las sich als Fotostream statt als Komposition:

| Motiv | Breite | Höhe | Anteil Viewport |
|---|---|---|---|
| Claudia (Samstag) | 100 % | 570 px | **68 svh** |
| Ortsbild (Standort) | 100 % | 513 px | **61 svh** |
| Fassade (Hero) | 100 % | 478 px | 57 svh |
| Anschlagmaschine | 100 % | 456 px | 54 svh |
| Butter (Catering) | 100 % | 456 px | 54 svh |
| Cheesecake | 100 % | 428 px | 51 svh |
| Kupferkessel (Galerie) | 48 % | 409 px | 49 svh |

Nur zwei Bilder standen je nebeneinander (Backstube). Gesamthöhe 11 401 px.

## B · Neues mobiles Bildsystem

Grundlage ist ein **12-Spalten-Raster** ab 1023 px abwärts. Es erlaubt echte
42/58- und 58/42-Teilungen, statt zwei gleich breite Kacheln zu erzeugen.

**Vertikale Bildpaare (bei 390 und 430 messtechnisch als gleichzeitig
sichtbar bestätigt — vertikale Überlappung > 60 px):**

| Abschnitt | linke Spalte | rechte Spalte | Muster |
|---|---|---|---|
| Backstube | Handgriff, 5/12, tiefer | Guss mit Gesicht, 7/12 | B (Mensch führt) |
| Galerie 1 | Mandelblättchen, 5/12 | Kupferkessel, 7/12, tiefer | A |
| Galerie 3 | Kirschfüllung, 7/12 | Spritzbeutel, 5/12, tiefer | B (gegenläufig) |
| Samstag | Claudia, 7/12 | Kaffeemoment, 5/12, tiefer | C (Leitbild + Detail) |

**Einzelbilder als Fenster mit wechselnder Kante** — kein Bild läuft mehr
über die volle Spaltenbreite:

| Motiv | Breite | Kante | Höhe bei 390 |
|---|---|---|---|
| Anschlagmaschine | 66 % | links | 36 svh |
| Cheesecake | 68 % | rechts | 34 svh |
| Butter | 58 % | links | 31 svh |
| Ortsbild | 62 % | rechts | 38 svh |
| Fensterteam (Galerie-Leitbild) | 76 % | rechts | 38 svh |

**Galerie-Dramaturgie mobil:** Duo → Leitbild → gegenläufiges Duo.

## C · Individuell gerechnete Mobilcrops

Zwei Motive ließen sich mit `object-position` **nicht** retten: ist das
Anzeigefenster schmaler als die Quelle, beschneidet `object-fit` nur seitlich
und lässt die volle Bildhöhe stehen — genau die toten Zonen, die mobil weg
sollten. Beide bekamen daher einen echten Ausschnitt in der Bildpipeline
(`03-webbilder/build-images.py`), die Originale blieben unangetastet:

- **`claudia-m`** (Crop 1450,780→2060,1800 · 610 × 1020 · 3:5)
  Gesicht auf 39 % Höhe. Der Lederrücken des Gastes bleibt nur als schmaler
  Kontextstreifen links, der helle Pfeiler schließt rechts ab; Fensterbank
  und Hose des Gastes fallen weg. Erfüllt die Bildregel „Vollbild nie
  verwenden" aus IMAGE-REJECTIONS.md.
- **`barista-m`** (Crop 100,336→1336,2400 · 1236 × 2064 · 3:5)
  Kopf, Schulter, Hand mit Kanne und die linke Maschinenhälfte bleiben
  zusammen. Der dunkle Boden und die leere rechte Gerätefläche sind raus —
  keine „unverständliche dunkle Maschinenfläche" mehr.

Beide greifen nur bis 1023 px (`<source media>`); Desktop lädt weiterhin die
Originalausschnitte — im Browser verifiziert.

Weitere Crop-Korrektur: **Kupferkessel und Mandelblättchen wurden getauscht.**
Bei 136 px zerfielen Stäbe, Kesselwand und geschlagene Masse zu einer Textur
ohne Motiv; die Mandelblättchen sind reine Wiederholung und bleiben auch
schmal lesbar.

## D · Typografie

Mobil ist keine verkleinerte Desktopskala mehr, sondern eigene Werte:

| Rolle | 320 px | 390 px | 430 px | Zielkorridor |
|---|---|---|---|---|
| Hero-H1 | 41,6 px | 44,5 px | 49,0 px | 42–58 ✓ |
| Section-H2 | 32,0 px | 32,0 px | 35,3 px | 31–44 ✓ |
| Body Large | — | 19,5 px | 21,5 px | 19–23 ✓ |
| Body | 17 px | 17 px | 17 px | 16–18 ✓ |

Weiter: Kicker-Laufweite mobil von .2em auf .15em (bei 11 px las sich .2em
als Lücke), `text-wrap: pretty` auf Fließtexten, Zeilenlänge im Body durch
Viewport auf ~38 Zeichen begrenzt.

**Abschnittsnummern 01–07 entfernt.** Durchnummerierte Kicker über *jedem*
Abschnitt sind Gerüst, keine Aussage; die Marke trägt der Medaillon-Ring.
Der Kicker im Samstagsabschnitt entfiel ganz — dort ist die H2 die Aussage.

## E · Farbe und Champagner

- **Neu `--linen: #EBE0C9`** für die Geschichte. Vorher folgten mit Porzellan
  (#FCF9F3) und Elfenbein (#F3EDDF) zwei fast gleiche Beigeflächen
  aufeinander; jetzt ist der Schritt sichtbar.
- **Standort auf `--blue-bright: #17527F`** — die hellste Blaustufe der
  Palette, klarer Kontrapunkt zwischen Schokolade und Navy-Footer.
- **`--champagne-ink` von #855D26 auf #7E5722.** Auf dem neuen, dunkleren
  Leinen erreichte der alte Wert als 11-px-Versalie nur **4,47:1** und fiel
  damit unter die Grenze. Neu: Leinen 4,90 · Elfenbein 5,50 · Porzellan 6,10.
- **Samstags-Akzent:** Die Öffnungszeit trägt jetzt die einzige volle
  Champagnerlinie der Seite plus die Medaillon-Marke aus dem Kicker-System.
- **Zitat ohne Seitenstreifen:** Der 2-px-Balken links wich einer kurzen
  Champagnerlinie darüber — dieselbe Liniensprache wie Header und Timeline.

Farbfolge gemessen: Navy → Porzellan → Leinen → Navy-Night → Porzellan →
Markenblau → Porzellan → Schokolade → Navy → Hellblau → Navy-Night.
Keine zwei benachbarten Flächen mehr nah beieinander.

## F · Gefundene und behobene Fehler

1. **Reveal koppelte Sichtbarkeit an JavaScript.** `.reveal { opacity: 0 }`
   galt unbedingt — bei JS-Fehler, in Suchmaschinen-Renderern oder in
   Screenshot-Tools wäre die halbe Bildstrecke dauerhaft leer geblieben.
   Der Ausgangszustand ist jetzt sichtbar; erst eine `.js`-Klasse, die vor
   dem ersten Pixel gesetzt wird, aktiviert das Ausblenden.
2. **Tablet-Bildhöhen liefen aus dem Ruder.** Prozentbreiten wachsen mit dem
   Viewport, die Bildschirmhöhe nicht: bei 768 px maß der Hero **87 svh**,
   Kupferkessel und Claudia je 66 svh. Eigener Tablet-Block (640–1023 px)
   mit Deckelung der Duo-Container auf 35rem und Hero im Querformat 16:10 →
   höchstes Fenster jetzt **52 svh**.
3. **Quellenzeile am Zitat brach nach zwei Wörtern um** — die `max-width` des
   Zitats schnürte auch die `cite` ein. Entfernt, `cite` ist einzeilig.
4. **Zwei Touchflächen unter 44 px:** „Zum Standort" (29 px) und die
   Footer-Links (42 px). Beide auf `min-height: 44px` gesetzt.

## G · Geprüfte Viewports

| Viewport | Overflow | höchstes Bild | Ergebnis |
|---|---|---|---|
| 320 × 568 | 0 px | — | H1 41,6 px, kein Element breiter als Viewport |
| 390 × 844 | 0 px | 53 svh (Hero) | 4 Bildpaare, alle übrigen ≤ 38 svh |
| 430 × 932 | 0 px | 53 svh (Hero) | 4 Bildpaare bestätigt |
| 768 × 1024 | 0 px | 52 svh | nach Tablet-Deckelung |
| 1440 × 900 | 0 px | — | 4 Galerie-Spuren, 4 eigene Breiten/Startpunkte |

## H · Funktion, Accessibility, Konsole, Netzwerk

- **Mobilmenü:** `aria-expanded` schaltet false→true→false, Fokus wandert auf
  „Schliessen", Escape schließt und gibt den Fokus an den Button zurück,
  `body`-Scroll wird gesperrt und wieder freigegeben. ✓
- **Links:** keine toten internen Anker, keine doppelten IDs. Instagram und
  Facebook je genau einmal, mit `target="_blank"`, `rel="noopener noreferrer"`
  und zugänglichem Namen. ✓
- **Struktur:** genau eine H1, Reihenfolge `1222222233322333444` ohne
  Ebenensprung, 16 Bilder mit nicht-leerem Alt-Text, alle mit `width`/`height`
  (kein Layoutsprung), 14 davon `loading="lazy"`. ✓
- **Touchflächen:** nach Korrektur kein interaktives Element unter 44 × 44 px. ✓
- **Konsole:** 0 Fehler. Zwei Warnungen zum Font-Preload — **vorbestehend**
  (auch in den Logs vom 19.07.) und **gegenstandslos**: beide Schriften werden
  je genau einmal geladen (`initiatorType: link`) und sind aktiv
  (`document.fonts.check` = true). Es ist eine Chrome-Timing-Heuristik, kein
  doppelter Download.
- **Netzwerk:** alle 76 referenzierten Assets antworten mit 200, keine
  fehlgeschlagenen Requests, keine doppelten Bilddownloads.

## I · Performance

Alle `sizes`-Attribute wurden auf die tatsächlichen neuen Spaltenbreiten
korrigiert (statt pauschal 92vw). Mit kaltem Cache verifiziert: die Auswahl
greift korrekt — z. B. Fensterteam und Ortsbild laden die 600er statt der
1200er Variante.

> Zwischenzeitlich zeigten diese beiden Bilder im Test die 1200er Variante.
> Ursache war Cache-Wiederverwendung aus dem vorangegangenen Desktop-Durchlauf,
> nicht die Seite; mit eindeutigen URLs erzwungen wählte der Browser beide Male
> die 600er Variante.

| | Bilder | gesamt |
|---|---|---|
| Mobile Seitenlast (390 px) | 979 kB | **1 205 kB** |
| mit den alten Claudia-/Barista-Varianten | 1 099 kB | 1 325 kB |

Die eigenen Mobilcrops **sparen 119 kB** und verbessern gleichzeitig die
Bildaussage.

Gesamthöhe der Mobilseite: **11 401 → 10 575 px (−7,2 %)** — und das trotz
durchgehend größerer Schrift.

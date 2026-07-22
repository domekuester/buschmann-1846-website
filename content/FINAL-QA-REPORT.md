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

---

# NACHTRAG — Responsive Flagship-Masterpass (Personen-Crops)

Stand: 21.07.2026 · Branch `rebuild/flagship-recovery`
Geprüft im Browser (Chromium über Playwright) unter `http://localhost:8899/`.

## A · Ursache des abgeschnittenen Tyll-Gesichts

Die Seitenverhältnisse standen als `style="--ratio: …"` am `<figure>`. Eine
**Inline-Custom-Property gewinnt gegen jede Media Query** — der mobile
Ausschnitt griff deshalb nie. Gemessen bei 390 px:

| | Soll | Ist |
|---|---|---|
| Anzeigefenster | 3:4 = 0,750 | **2:3 = 0,667** |
| beschnittene Breite | 0 % | **10 %** |
| Fokus | zentriert | `--fx: 46%` schob zusätzlich nach links |

Zusammen drückte das sein Profil an die linke Kante. Dieselbe Falle traf das
Kaffeedetail (`.sam-side`): gerendert im 1:2 statt im vorgesehenen 3:5, also
17 % Breitenverlust. Die Galerie hatte das Problem mit vier `!important`
übertüncht.

**Behoben strukturell**, nicht per Feinjustierung: Alle zwölf Inline-Ratios
sind raus, jedes Bildfenster hat eine Klasse und seine Werte stehen regulär
in der Kaskade (`.gesch-photo`, `.bs-pour`, `.g-copper`, …). Tyll und Claudia
nutzen benannte Tokens (`--tyll-ratio`, `--tyll-focus-x`, `--claudia-ratio`,
…). Die `!important`-Hacks konnten entfallen — im Stylesheet steht noch genau
eines, in einer fremden Regel.

## B · Neue Crops

Gemessen am Original `Tyll-final.jpg` (2672 × 4000): Haaransatz y≈280,
Kinn y≈1500, Nasenspitze x≈300, Schürzenlatz ab y≈2100. Er blickt nach links,
also beginnen **beide** Ausschnitte bei x=0 — nur so steht die Luft vor dem
Gesicht statt dahinter.

- **Desktop `tyll`**: (0, 100, 2200, 3400) = 2200 × 3300, 2:3 → 210 × 315 px
- **Mobil `tyll-m`**: (0, 150, 1960, 2600) = 1960 × 2450, 4:5 → 192 × 239 px (28 svh)

`Claudia.jpg` (2664 × 3988): Kopf y 880–1150, Gesicht x≈1620, Fensterpfosten
x 1900–2050.

- **Mobil `claudia-m`**: (1120, 690, 2110, 1928) = 990 × 1238, 4:5 → 224 × 280 px (33 svh).
  Vorher 610 × 1020 im Verhältnis 0,598 — eine enge Gesichtsaufnahme.

## C · Mobile Komposition

**Tyll-Block gestapelt statt nebeneinander.** Nebeneinander blieben bei 390 px
nur 200 px für den Absatz — rund 24 Zeichen pro Zeile. Gestapelt bekommt der
Text die volle Achse (342 px, ~40 Zeichen, 4 statt 7 Zeilen) und das Bild darf
ein richtiges Hochformat sein. Ab 640 px (Tablet) steht das Duo wieder
nebeneinander, dort hat der Text 447 px.

**Galerie-Abfolge nach Gattung sortiert.** Vorher standen Mandelblättchen und
Kupferkessel als zwei braun-orange Texturen nebeneinander. Jetzt:

| Reihe | links | rechts | Muster |
|---|---|---|---|
| 1 | Kupferkessel (Material) 58 % | Kirschfüllung (Produkt) 42 %, tiefer | B |
| 2 | Fensterteam (Menschen), rechts angeschlagen, 76 % | — | Leitbild |
| 3 | Spritzbeutel (Handwerk) 42 % | Mandelblättchen (Material) 58 %, tiefer | A |

Vier Bildpaare geometrisch bestätigt (seitlich nebeneinander, vertikale
Überlappung 199–228 px): Backstube, Galerie 1, Galerie 3, Samstag.

**Hero auf kurzen Geräten gedeckelt.** Das feste 6:7 rechnet nur aus der
Breite; bei 320 × 568 ergab das 64 svh. `max-height: 57svh` greift nur dort,
der Schriftzug bleibt über die 40-%-Achse im Ausschnitt.

## D · Geprüfte Viewports

| Viewport | Overflow | höchstes Bild | Anmerkung |
|---|---|---|---|
| 320 × 568 | 0 | 57 svh (Hero) | vorher 64 svh |
| 360 × 800 | 0 | 51 svh | |
| 375 × 667 | 0 | 57 svh | |
| 390 × 844 | 0 | 53 svh | 4 Bildpaare, alle übrigen ≤ 38 svh |
| 430 × 932 | 0 | 53 svh | 4 Bildpaare bestätigt |
| 768 × 1024 | 0 | 52 svh | Crew-Duo 220 px Bild + 447 px Text |
| 1440 × 900 | 0 | — | 4 Galeriespuren, 4 eigene Breiten und Startpunkte |

## E · Accessibility, Konsole, Netzwerk, Performance

- Eine H1, keine Ebenensprünge, keine doppelten IDs, keine toten Anker.
- 17 Bilder, alle mit Alt-Text; **kein Personenname in einem Alt-Text** —
  die Namen stehen semantisch im Fließtext daneben.
- Keine Touchfläche unter 44 × 44 px. Mobilmenü: `aria-expanded` schaltet,
  Escape schließt und gibt den Fokus zurück.
- Instagram und Facebook je einmal, `rel="noopener noreferrer"`.
- 28/28 Reveals feuern; der Ausgangszustand bleibt ohne JavaScript sichtbar.
- Konsole: **0 Fehler, 0 Warnungen.**
- Alle **84** referenzierten Assets antworten mit 200.
- Mobile Seitenlast bei 390 px: 995 kB Bilder + 235 kB übrige = **1 230 kB**.

## F · Begründete Abweichung

Auf Mobil steht Tylls Bild **über** dem Text statt daneben, obwohl der Auftrag
für breitere Mobilgeräte ein Duo vorsah. Bei 430 px hätte der Absatz in der
Nebenspalte nur rund 28 Zeichen pro Zeile — genau der eingequetschte Textblock,
den derselbe Auftrag ausschließt. Lesbarkeit hat hier Vorrang bekommen; ab
640 px steht das Duo wieder nebeneinander.

---

# NACHTRAG — Zweisprachige Fassung (DE / EN)

Stand: 21.07.2026 · Branch `rebuild/flagship-recovery`

## A · Spracharchitektur

Zwei eigenständige HTML-Seiten mit gemeinsamen Assets — keine
JavaScript-Umschaltung, keine doppelten Sprachtexte im selben DOM.

| | Datei | URL | `lang` | Canonical |
|---|---|---|---|---|
| Deutsch | `index.html` | `…/buschmann-1846-website/` | `de` | eigene |
| Englisch | `en/index.html` | `…/buschmann-1846-website/en/` | `en` | eigene |

Aus `en/` laufen alle Referenzen über `../assets/…`. Geprüft: **0** root-
relative und **0** root-absolute Assetpfade in `en/index.html`; die drei
`og-image`-Nennungen sind absolute URLs.

`hreflang` de/en/x-default auf beiden Seiten, `og:locale` de_DE bzw. en_GB
mit `og:locale:alternate`, `og:url` je Seite, strukturierte Daten um `url`,
`inLanguage` und `image` ergänzt. `sitemap.xml` (valides XML, beide Seiten
mit xhtml:link) und `robots.txt` neu.

## B · Sprachwahl

`DE · EN` im Navy-Header, keine Flaggen, keine Pille, kein Dropdown.
Desktop **absolut positioniert** am rechten Rand — sie belegt damit keine
Rasterspalte, das Logo bleibt exakt mittig (gemessen: Logomitte 720 px bei
1440 px Viewport, Abstand zur Navigation 181 px). Mobil steht sie im Fluss
zwischen Logo und Menübutton (Logo · Luft · DE/EN · Menü), Headerhöhe
unverändert 73 px, bei 320 px bleiben 51 px Luft.

Aktive Sprache: volle Textfarbe **und** ein Champagnerpunkt darunter — der
Zustand hängt nicht allein an der Farbe. Dazu `aria-current="page"`,
`hreflang`, `lang` und zugängliche Namen („Deutsche Version" / „English
version"). Touchflächen 44 × 44 px auf allen Breiten.

Die Sprachlinks (`en/` bzw. `../`) funktionieren ohne JavaScript. Mit JS
hängt `SECTION_MAP` in `main.js` den passenden Zielanker an — im Browser
verifiziert: `/#samstag` → `/en/#saturday` → zurück `/#samstag`.

## C · Englische Fassung

Keine Satz-für-Satz-Übersetzung. Bewusste Abweichungen und die verbindliche
Begriffsliste stehen in `content/TRANSLATION-GUIDE.md`. Kernentscheidungen:

- Hero: „Düsseldorf patisserie. / Since 1846."
- Geschichte: „It all began in Akademiestraße in 1846."
- Samstag: „On Saturdays, the window opens." — die Bewegung des deutschen
  Originals bleibt erhalten, „the window is open" wäre statisch.
- Claudia: „…one of the familiar faces **serving guests**" statt „at the
  window", weil „window" sonst direkt nach der Headline stünde. Sichtbare
  „window"-Nennungen auf der EN-Seite: **1**.
- Tyll: „…he gets the cakes, tarts and patisserie **ready to go**" —
  „ready for delivery" klingt nach Logistik statt nach Backstube.
- „Gastronomie" wird kontextabhängig zu „cafés and restaurants", nie zu
  „gastronomy".

91 Textersetzungen plus 28 übersetzte Redaktionskommentare, damit die
EN-Datei eigenständig wartbar bleibt. Kein deutscher UI-Text verblieben.

## D · Inhaltliche Hard Stops (EN, gerendert geprüft)

| Prüfung | Ergebnis |
|---|---|
| „lemon cheesecake with lemon glaze" vorhanden | ✅ |
| „caramel" nirgends | ✅ |
| „doors are open" / „come inside" / „indoor seating" / „dine in" | ✅ keine |
| „Tyll Schulte" korrekt, „Till" nirgends sichtbar | ✅ |
| „Together with Gregor Buschmann" im Tyll-Text | ✅ |
| „Gregor August Buschmann" genau 1× (Erstvorstellung) | ✅ |
| Social nur zum Folgen, kein Anfrageweg | ✅ |

Der Zitronen-Cheesecake bleibt vollständig erhalten — Bild, Abschnitt und
Bezeichnung unverändert. Der spätere Fototausch ist in `content/TODO.md`
vermerkt und erscheint nicht öffentlich.

## E · Geprüfte Viewports

Beide Sprachen: 320 × 568, 390 × 844, 1440 × 900 vollständig; Sprachwahl
zusätzlich bei 320 und 390 vermessen. Auf allen Breiten **0 px** horizontaler
Overflow, höchstes Bild 53 svh, 28/28 Reveals, keine defekten Bilder.

## F · Funktion, Accessibility, Konsole, Netzwerk

- Keine toten Anker, keine doppelten IDs, keine leeren Links — auf **beiden**
  Seiten geprüft. Je 17 Bilder, alle mit Alt-Text, keiner mit Personennamen.
- Mobilmenü auf der EN-Seite: `aria-expanded` schaltet, Fokus wandert auf
  „Close", Escape schließt und gibt den Fokus zurück.
- Keine Touchfläche unter 44 × 44 px.
- Konsole: **0 Fehler, 0 Warnungen** auf beiden Seiten.
- Kaltstart: je **86** Referenzen geprüft, alle 200. `sitemap.xml`,
  `robots.txt` und `/en/` liefern 200.

## G · Performance

Die englische Seite lädt dieselben Bilder, Fonts, CSS und JS wie die
deutsche — keine zusätzlichen Assets, kein zweiter Font-Satz, keine
Übersetzungsbibliothek. Zusätzliches Gewicht der EN-Fassung: die HTML-Datei
selbst.

---

# NACHTRAG — Mobiler Flagship-Header

Stand: 21.07.2026 · Branch `rebuild/flagship-recovery`

## A · Ausgangsprobleme (gemessen bei 390 × 844)

| Befund | Wert |
|---|---|
| Logo **nicht zentriert** | Logomitte 51 px bei Viewportmitte 195 px — es klebte am linken Rand |
| Medaillonlinie | `display: none` — die Desktop-Signatur fehlte mobil vollständig |
| Öffnungszeit | eigener Streifen über dem Header, las sich als technisches Band |
| Zustände | keine — konstant 99 px, kein Scrollverhalten |
| Safe Area | nicht behandelt |
| Sprungmarken | `scroll-margin-top` 111 px aus den Desktop-Tokens, passte nicht zur echten Mobilhöhe |

Drei unabhängig positionierte Teile statt einer Markenfläche.

## B · Neue Architektur

Eine durchgehende Navy-Fläche, drei gleich gewichtete Zonen in einem
`1fr auto 1fr`-Raster — dadurch steht das Signet exakt auf der Mittelachse
wie auf dem Desktop:

```
DE · EN        [Signet]        MENÜ ═
      ── ◉ SAMSTAGS 12–17 UHR ──
```

Alle drei Zonen liegen ausdrücklich in `grid-row: 1`. Ohne das legt die
Auto-Platzierung eine zweite Rasterzeile an, weil `.lang` im DOM hinter dem
Logo steht, aber Spalte 1 beansprucht — der Header brach dabei um.

**Position `fixed` statt `sticky`** mit `body { padding-top: var(--head-h) }`.
Ein schrumpfender sticky Header hätte den Inhalt darunter beim Zustandswechsel
um die Höhendifferenz nach oben gerissen; fixed entkoppelt ihn vom Fluss.

## C · Zustände

| | Höhe | Logo | Markenzeile |
|---|---|---|---|
| A — oben | **87 px** | 54 px | sichtbar (26 px) |
| B — gescrollt | **61 px** | 40 px | eingeklappt |

Die Bedienzeile behält ihre Höhe; es bewegen sich nur Markenzeile und Logo.
Zwei Bewegungen statt drei lesen sich ruhiger, und der Header bleibt klar
über der Grenze, ab der Menübutton und Sprachwahl gedrängt wirken. Übergang
220 ms, `cubic-bezier(.22,.61,.36,1)`. Nach dem Zurückscrollen exakt wieder
87 px — keine Drift.

Umschaltung über eine Klasse aus `main.js`: passiver Listener, Rechnung im
`requestAnimationFrame`, Hysterese 32 px rein / 12 px raus gegen Flackern an
der Schwelle. Kein Layout-Lesen pro Scrollereignis.

## D · Details (drei, alle mit Funktion)

1. **Medaillonlinie** — Champagner-Haarlinien laufen symmetrisch links und
   rechts vom Medaillonpunkt aus (gemessen 72 px / 72 px bei 320 px und
   393 px), durchschneiden keinen Text und enden nicht an den Displaykanten.
2. **Samstagsmarke** — der Champagnerpunkt vor der Öffnungsangabe greift die
   Logo-Scheibe auf; die Angabe ist mobil ihre einzige Nennung im Header.
3. **Menümarke** — zwei präzise Linien statt drei Hamburgerbalken, die untere
   kürzer. Dieselben zwei Linien kreuzen sich im Overlay zum Schliessen-
   Zeichen: gleiche Geometrie, andere Aufgabe.

## E · Safe Area und Sprungmarken

```css
--safe-top: env(safe-area-inset-top, 0px);
--head-h:    calc(var(--safe-top) + 60px + 26px);
--head-h-sm: calc(var(--safe-top) + 60px);
```

Wirbelsäule und `scroll-margin-top` hängen an der kompakten Höhe. Alle fünf
Sprungziele landen mit exakt **13 px** unter dem Header, keine Überschrift
wird verdeckt.

## F · Overlay

Navy-Fläche mit Schliessen-Marke, kleinem Buschmann-Signet, fünf großen
Navigationszeilen mit Champagner-Medaillonring und Haarlinien, darunter
Adresse, Öffnungszeit und der DE/EN-Wechsel.

Zwei Fehler gefunden und behoben: `.m-lang` durfte unter die Breite seiner
beiden 44-px-Flächen schrumpfen und brach zweizeilig um (`flex: none`), und
der Selektor `.m-menu nav a` griff auch auf den Sprachschalter, weil `.m-lang`
ebenfalls ein `<nav>` ist — er erbte dadurch 56 px Mindesthöhe, Rahmen und
Displaygröße. Jetzt `.m-menu > nav a`.

Auf eine bewusst weggelassene Idee sei hingewiesen: Der Header-Button
verwandelt sich **nicht** selbst in das Schliessen-Zeichen. Das hätte den
geprüften Fokus-Trap umbauen müssen; Header- und Overlay-Marke teilen
stattdessen dieselbe Liniengeometrie.

## G · Interaktion und Accessibility

`aria-expanded` schaltet, `aria-controls` zeigt auf das Overlay, das
`aria-label` wechselt lokalisiert zwischen „Menü öffnen/schliessen" bzw.
„Open/Close menu" — die Texte stehen als `data`-Attribute im HTML, damit im
gemeinsamen JavaScript keine deutschen Strings hart kodiert sind.

Fokus springt ins Menü, Fokusfalle greift **in beide Richtungen**, Escape
schliesst mit Fokusrückgabe, Body-Scroll wird gesperrt und wieder
freigegeben, Navigationsklick schliesst. Aktive Sprache mit `aria-current`
**und** Champagnerpunkt — nicht allein farblich. Keine Touchfläche unter
44 × 44 px, weder im Header noch im Overlay. Reduced Motion deaktiviert
Header-, Logo-, Markenzeilen-, Menülinien- und Medaillonübergänge.

## H · Geprüfte Viewports

320 × 568 · 360 × 800 · 375 × 667 · 390 × 844 · 393 × 852 · 430 × 932 ·
768 × 1024 — Logo auf allen Breiten exakt zentriert, keine Kollision
zwischen Sprachwahl, Logo und Menübutton, Markenzeile einzeilig, kein
horizontaler Overflow.

Desktop 1440 × 900 gegengeprüft: `position: sticky` unverändert, Header
125 px, Logo zentriert, beide Medaillonlinien exakt 37,44 px auf gleicher
Höhe, Markenzeile ausgeblendet, Infobar sichtbar, `body`-Padding 0.

## I · Konsole, Netzwerk, Performance

0 Fehler und 0 Warnungen auf beiden Sprachseiten. Je 24 Referenzen mit
Status 200. Keine neue Bibliothek, kein zusätzliches Bild — das Logo ist
dasselbe `logo-mark.png` wie bisher. `main.js` liegt bei 4,5 kB.

---

# NACHTRAG — Kaffeemaschinen-Detail in der Bildstrecke

Stand: 21.07.2026 · Branch `rebuild/flagship-recovery`

## A · Datei und Ausgangslage

`01-originalfotos/Kaffemaschine.jpg` — 1401 × 2101, nativ bereits 2:3. Es ist
die einzige Datei im Projekt mit passendem Namensbestandteil. (Der Dateiname
trägt einen Tippfehler, „Kaffemaschine" statt „Kaffeemaschine"; ich habe ihn
nicht angetastet, um die Dokumentverweise nicht erneut zu drehen.)

Die freie Fläche im Desktop-Layout war exakt vermessen: **x 891–1240,
y 0–328** — die obere rechte Ecke über dem Spritzbeutel-Bild.

## B · Desktop

Das Detail sitzt jetzt als erstes Bild in Spur 4, über dem Spritzbeutel.

| | Wert |
|---|---|
| Crop | (60, 180, 1341, 2101) = 1281 × 1921, **2:3** |
| Anzeige bei 1440 px | 244 × 366 px = **20 %** der Boardbreite |
| Position im Board | x 996–1240, y 32–398 |
| Achse | rechtsbündig, teilt die rechte Kante mit dem Bild darunter |
| Einsatzhöhe | y 32 — eigener Startpunkt neben 0 / 88 / 176 |

Es ist schmaler als seine Spur (70 %) und rechtsbündig: dadurch steht es
nicht mittig wie ein Poster, sondern bildet mit dem Spritzbeutel darunter
eine gemeinsame vertikale Achse. Das Board wächst nur von 1009 auf 1034 px;
der Spritzbeutel endet 25 px tiefer als die Kirschfüllung, die Unterkanten
bleiben also gestaffelt.

Gegengeprüft bei 1024 (20 %), 1920 (19 %) — Anteil und Achse konstant.

## C · Mobil

Reihe 2 der Bildstrecke war bisher ein alleinstehendes Leitbild. Jetzt ist
sie ein Paar nach Muster C: das Fensterteam trägt die Reihe, das
Kaffeedetail steht schmal daneben und setzt tiefer ein.

| | Wert |
|---|---|
| Crop | (300, 500, 1100, 2101) = 800 × 1601, **1:2** |
| Spalten | 1–5 von 12 (Detail) neben 5–12 (Leitbild) |
| Anzeige 390 px | 106 × 212 px (25 svh) |
| Anzeige 320 px | 83 × 165 px · 430 px: 119 × 239 px · 768 px: 179 × 357 px |

Der Mobil-Crop ist **nicht** der verkleinerte Desktop-Ausschnitt: er rückt
enger an Brühgruppe und Dampflanze, damit das Chrom auch in einer 106-px-
Spalte trägt. Typenschild und Abtropfgitter bleiben erkennbar.

## D · Rhythmus

Die mobile Bildstrecke hat jetzt drei Paare statt Duo · Leitbild · Duo,
und jede Reihe mischt zwei Gattungen:

| Reihe | links | rechts |
|---|---|---|
| 1 | Kupferkessel (Material) | Kirschfüllung (Produkt), höher |
| 2 | **Kaffeemaschine (Technik)**, tiefer | Fensterteam (Menschen) |
| 3 | Spritzbeutel (Handwerk) | Mandelblättchen (Material), tiefer |

Das Detail bringt den einzigen technisch-metallischen Ton in eine sonst
warm-braune Bildfolge. Die beiden Kaffeemotive stehen weit auseinander:
P1360057 (Maschine mit Person) im Samstagsabschnitt, das Materialdetail in
der Bildstrecke — unterschiedliche Motivgewichte, keine Dopplung nebeneinander.

## E · Geprüfte Viewports

320 × 568 · 390 × 844 · 430 × 932 · 768 × 1024 · 1024 × 768 · 1440 × 900 ·
1920 × 1080, beide Sprachfassungen. Überall: kein horizontaler Overflow,
keine Kollision mit Nachbarbildern, Anteil an der Boardbreite 19–20 %,
mobile Höhe 165–239 px.

## F · Technik und Performance

Vier neue Derivate (WebP + JPG in je zwei Breiten). Bei 390 px lädt mit
kaltem Cache `coffee-m-300.webp` mit **26,6 kB** — im selben Durchlauf
gegengeprüft, dass auch das Fensterteam nach der Spaltenänderung korrekt die
600er statt der 1200er Variante wählt. Beide Seiten: je 94 Referenzen mit
Status 200, **0 Konsolenfehler**, HTML valide, keine Bildunterschrift, kein
Rahmen, `loading="lazy"`, `width`/`height` gesetzt.

Alt-Text Deutsch: „Detail der Kaffeemaschine in der Backstube: Brühgruppe,
Dampflanze und Abtropfgitter aus Chrom" · Englisch: „Detail of the coffee
machine in the bakery: chrome group head, steam arm and drip tray".

---

# Nachtrag 22.07.2026 — die drei Schlussfassungen

`palette.jpg`, `Gregor-final.jpg` und `Tyll-final2.jpg` ersetzen `hands`
(P1360346), `pour` (P1360272) und `tyll` (Tyll-final.jpg). Alle Zahlen
gemessen unter `http://localhost:8765/`, beide Sprachfassungen.

## A · Serie statt Einzelbilder

Alle drei Master: 2672 × 4000, sRGB IEC61966-2.1 — identisches
Ausgangsformat. Gegenüber den alten Derivaten ist der Grünstich weg, der
Kontrast zurückgenommen, das Korn gleichmäßig. Die Zusammengehörigkeit
steckt damit in den Dateien; **es liegt bewusst kein CSS-Farbfilter auf den
Bildern**, weil jeder Filter auf einem der drei Motive die gemeinsame
Gradation wieder auseinandertreiben würde.

## B · Crops — jeder einzeln vermessen, keiner zentriert

| | Desktop | Mobil |
|---|---|---|
| palette | (0,0,2672,3340) 4:5 | (0,200,2100,2825) 4:5 |
| gregor | (0,0,2666,3999) 2:3 | (0,0,2670,3560) 3:4 |
| tyll | (0,0,1900,2850) 2:3 | (0,0,2000,2500) 4:5 |

Zwei harte Randbedingungen aus der Vermessung: Über Gregors Mütze stehen nur
**55 px**, über Tylls Haaransatz **90 px** — beide Motive müssen zwingend bei
y=0 einsteigen, sonst wird angeschnitten. Tyll blickt nach links und hat vor
der Nase 235 px; beide Tyll-Ausschnitte beginnen deshalb bei x=0 und enden
früh (1900 bzw. 2000 statt 2672), damit der Anteil des Freiraums **vor** dem
Gesicht wächst statt hinter dem Kopf tote Wand mitzulaufen.

Jedes Anzeigefenster übernimmt exakt das Verhältnis seines Derivats —
`object-fit` beschneidet nichts nach, die `--*-focus-*`-Tokens stehen auf
50 % und sind reine Reserve.

## C · Komposition

Abschnittshöhe bei 1440 px: **981 px → 738 px**. Die tote Navy-Fläche neben
und unter Tylls Absatz (rund 600 px breit) ist ersatzlos verschwunden, ohne
dass ein einziger Inhalt hinzugekommen ist — die Menschen-Zone sitzt jetzt in
der linken Spalte, die Bildspur läuft über beide Rasterzeilen durch.

Zwei Bezüge liegen quer über die Spalten und wurden bei 1024 / 1280 / 1366 /
1440 / 1680 / 1920 px gemessen — sie treffen überall auf 0–1 px:

| vw | Textspalte oben | Gregor oben | Palette unten | Tyll unten |
|---|---|---|---|---|
| 1024 | 77 | 77 | 564 | 564 |
| 1280 | 80 | 80 | 630 | 630 |
| 1366 | 77 | 77 | 624 | 624 |
| 1440 | 90 | 90 | 648 | 648 |
| 1680 | 105 | 105 | 696 | 696 |
| 1920 | 108 | 108 | 699 | 699 |

Sie sind über `align-self` an den Satzspiegel gehängt, nicht über feste
Randabstände — ein fester Wert hätte nur bei 1440 px gepasst und sonst um
rund 12 px danebengelegen, was schlechter aussieht als ein klarer Versatz.

Innerhalb des Paares fluchtet nichts: Gregor 333 × 500 px, Palette
235 × 295 px, Unterkanten 54 px auseinander.

## D · Textbreite

Tylls Bildspalte ist `clamp(130px, 13vw, 180px)`. Mit den ursprünglich festen
180 px blieben dem Absatz bei 1024 px nur **233 px = 27 Zeichen** — derselbe
eingequetschte Block, der mobil schon einmal zum Stapeln gezwungen hat.
Gemessene Textbreiten jetzt: 272 px (320) · 312 px (360) · 342 px (390) ·
382 px (430) · 447 px (768) · 494 px (820) · 282 px (1024) · 357 px (1280) ·
365 px (1440+). Nirgends unter 32 Zeichen.

## E · Geprüfte Viewports

320 × 568 · 360 × 800 · 390 × 844 · 430 × 932 · 768 × 1024 · 820 × 1180 ·
1024 × 768 · 1280 × 800 · 1366 × 768 · 1440 × 900 · 1680 × 1050 ·
1920 × 1080 — Deutsch und Englisch. Überall: **kein horizontaler Overflow**
(`scrollWidth - innerWidth = 0`), korrekte Derivatwahl (mobil greifen
`palette-m` / `gregor-m` / `tyll-m`, ab 1024 die Desktopfassungen), keine
Bildunterschrift, kein Rahmen, keine verzerrte Kachel.

## F · Technik und Performance

Beide Seiten: **je 202 Referenzen mit Status 200, 0 Konsolenfehler,
0 fehlgeschlagene Requests** (kalter Cache, Chromium über Playwright). Alle
drei `<img>` mit `loading="lazy"`, `decoding="async"`, `width`/`height`.

Ausgelieferte Bytes für die drei Motive (WebP):

- Desktop 1440: 26,8 + 57,6 + 29,4 kB = **114 kB** (vorher 124 + 101 + 54 =
  279 kB) — die Derivatbreiten entsprechen jetzt den tatsächlichen
  Anzeigebreiten statt deutlich darüber zu liegen
- Mobil 390: 11,9 + 18,1 + 18,0 kB = **48 kB**

16 überholte Derivate (`hands-*`, `pour-*`, `tyll-600/1200`,
`tyll-m-400/800`) wurden entfernt, nachdem projektweit geprüft war, dass sie
nirgends mehr referenziert sind — sie hätten sonst die alten Fassungen
konserviert. Die alten Originale bleiben als Archiv erhalten.

## G · Nachtrag Tablet (640–1023 px) — Satzspiegel der Bildspur

Die Backstube hatte auf Tablet drei verschiedene rechte Kanten: Bildspur
599 px (gekappt auf 35 rem, gemeinsam mit Galerie und Samstagsraster),
Fließtext 673 px, Menschen-Zone 737 px (ungekappt). Ausgerechnet das
strukturelle Element war das schmalste.

Die Kappung zu entfernen wäre der falsche Schluss gewesen — gemessen:

| | mit 35 rem | ohne Kappung | ab 1024 px |
|---|---|---|---|
| Gregor bei 1023 px | 322 px | **539 px** | 251 px |
| Tylls Absatz bei 1023 px | 681 px (≈90 Zeichen) | 681 px | 282 px |

Ohne Kappung hätte Gregor über die Breakpoint-Grenze auf das Doppelte
gesprungen. Die Kappung bleibt deshalb, wird auf **40 rem** geöffnet und gilt
jetzt für Bildspur **und** Menschen-Zone gemeinsam. 40 rem ist der Wert des
Fließtextes: dessen 56ch messen hier rund 634 px.

Gemessene rechte Kanten (Bildspur / Menschen-Zone / Fließtext):

| vw | Bildspur | Tyll-Block | Fließtext | Gregor | Overflow |
|---|---|---|---|---|---|
| 639 | 613 | 613 | 613 | 333 px | 0 |
| 640 | 614 | 614 | 614 | 334 px | 0 |
| 767 | 679 | 679 | 673 | 368 px | 0 |
| 768 | 679 | 679 | 673 | 368 px | 0 |
| 820 | 681 | 681 | 675 | 368 px | 0 |
| 821 | 681 | 681 | 675 | 368 px | 0 |
| 1023 | 689 | 689 | 683 | 368 px | 0 |
| 1024 | 983 | 492 | 492 | 251 px | 0 |

Bildspur und Menschen-Zone liegen über die gesamte Spanne exakt aufeinander,
der Fließtext 6 px daneben. Galerie und Samstagsraster behalten ihre 35 rem
(560 px) — sie haben keinen nebenstehenden Text, auf den sie sich beziehen.
Desktop ab 1024 px und Mobil unter 640 px sind unverändert; die
`sizes`-Angaben für den Tablet-Bereich wurden auf die neuen Anzeigebreiten
nachgezogen (226→260 px, 322→368 px). Beide Sprachfassungen geprüft, je 202
Referenzen mit Status 200, 0 Konsolenfehler.

## H · Alt-Texte

| | Deutsch | Englisch |
|---|---|---|
| palette | Hand streicht Teig mit einer Winkelpalette in eine Backform | A hand spreading dough into a baking tin with a palette knife |
| gregor | Gregor Buschmann gießt helle Masse aus einem Kessel in eine große Schüssel | Gregor Buschmann pouring a pale mixture from a pot into a large bowl |
| tyll | Tyll Schulte in Schürze bei der Arbeit in der Backstube | Tyll Schulte in an apron at work in the bakery |

Öffentliche Schreibweise durchgehend **Tyll Schulte** (0 Treffer für „Till
Schulte" in beiden Fassungen), obwohl eine ältere interne Datei `Till.jpg`
heißt.

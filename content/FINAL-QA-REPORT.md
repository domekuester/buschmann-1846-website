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

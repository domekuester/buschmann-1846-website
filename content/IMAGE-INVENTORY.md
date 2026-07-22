# IMAGE-INVENTORY — Vollständige Bildanalyse

Quelle: `01-originalfotos/` · 21 Fotos + 1 Logo · analysiert am 19.07.2026,
ergänzt am 22.07.2026 um die drei Schlussfassungen.
Bildrechte: für ALLE Bilder noch zu prüfen (siehe TODO.md).
Personennamen: Claudia, Tyll und Gregor per Dateiname belegt; alles andere
unbestätigt.

Legende Rolle: **L** = Leitbild · **E** = Erzählbild · **D** = Detailbild

---

## Buschmann-Logo.png
- Format: PNG mit Alphakanal, 374 × 346 px (klein!)
- Motiv: runde Navy-Marke, weiße Linienzeichnung (Brezel, Torte, Kanne,
  Kochmütze), Schriftzug „Buschmann", „1846", „PÂTISSERIE CATERING"
- Qualität: sauber, aber geringe Auflösung → Darstellung ≤ ~170 px Breite
- Verwendung: Header, Footer, Favicon-Basis

## Die drei Schlussfassungen (22.07.2026) — VERWENDET

`palette.jpg`, `Gregor-final.jpg` und `Tyll-final2.jpg` sind vom Auftraggeber
neu entwickelte Fassungen bereits vorhandener Aufnahmen. Sie ersetzen die
bisherigen Web-Derivate vollständig. Alle drei: **2672 × 4000, Hochformat,
sRGB IEC61966-2.1, JPEG** — also ein identisches Ausgangsformat.

Sie sind bewusst als **eine Serie** entwickelt: warmes Bernstein, offene
Schatten statt harter Schwarzwerte, feines gleichmäßiges Korn, gedämpfte
Sättigung. Gegenüber den alten Derivaten ist der Grünstich verschwunden und
der Kontrast zurückgenommen. **Deshalb liegt auf diesen Bildern kein
CSS-Farbfilter** — die Zusammengehörigkeit steckt in den Dateien selbst, jeder
zusätzliche `brightness()`/`contrast()`/`sepia()`/`saturate()` würde sie
wieder auseinandertreiben. Unterschieden werden sie allein über Ausschnitt,
Größe, Höhe und Position.

### palette.jpg — D (Backstube, Handwerksdetail) — ersetzt P1360346 (`hands`)
- 2672 × 4000 · 11,5 MB
- Motiv: Hand mit Winkelpalette über einer mit Teig gefüllten Kastenform,
  Backpapier, Holztisch; rechts oben die Schürze des Arbeitenden
- Vermessung: Hand x 0–720 / y 100–1300 · Palettenblatt x 200 → Spitze 2200,
  y 1300–1620 · Teig y 1900–2350 · Formwand y 2350–3300 · Holztisch ab 3400
- Desktop-Crop: **(0, 0, 2672, 3340) = 2672 × 3340, 4:5** — gedrungener als
  Gregors 2:3, damit die beiden nebeneinander kein Rechteckpaar bilden
- Mobil-Crop: **(0, 200, 2100, 2825) = 2100 × 2625, 4:5** — enger auf Hand,
  Blatt und Teig; der Einstieg bei y 200 gibt unten die Formkante frei
- Derivate: `palette-600/1200` · `palette-m-400/800` (WebP + JPG)

### Gregor-final.jpg — L (Backstube, Leitbild) — ersetzt P1360272 (`pour`)
- 2672 × 4000 · 13,7 MB
- Motiv: Gregor Buschmann mit Kappe gießt helle Masse aus einem Kessel in
  eine große Rührschüssel; Blick nach links unten auf den Guss
- Vermessung: Mützenkante y≈55 (!) · Augen y≈750 · Bart y≈1150 · Hand am
  Kessel ab y 330 · Guss x 950–1250 / y 1750–2600 · Schüssel y 2650–3820
- **Über der Mütze stehen nur 55 px** — jeder Ausschnitt muss bei y=0 beginnen,
  sonst wird die Kappe angeschnitten
- Desktop-Crop: **(0, 0, 2666, 3999) = 2:3** — praktisch die volle Aufnahme;
  Gesicht und Tätigkeit bleiben gleichzeitig lesbar, die Schüssel ganz
- Mobil-Crop: **(0, 0, 2670, 3560) = 3:4** — weiter gefasst statt näher heran;
  die Schüssel wird unten angeschnitten, die Kappe behält ihre Luft
- Derivate: `gregor-800/1400` · `gregor-m-500/1000` (WebP + JPG)

### Tyll-final2.jpg — L (Backstube, Menschen-Zone) — ersetzt Tyll-final.jpg
- 2672 × 4000 · 14,0 MB
- Motiv: Tyll Schulte im Profil, schwarze Kochjacke, taupefarbene Schürze,
  Blick nach links unten; Werkzeugwand und Topfgriff als Kontext
- Person: **Tyll Schulte (per Dateiname des Auftraggebers belegt)**
- Vermessung: Haaransatz y≈90 · Ohr x 1180–1330 · Nasenspitze x≈235 / y≈1400 ·
  Kinn y≈1560 · Schürzenlatz y 2150–3400 · Topfgriff ab y 3550
- Er blickt nach links; vor der Nase stehen 235 px, hinter dem Kopf liegt ab
  x≈1900 nur dunkle Wand. Beide Ausschnitte beginnen deshalb bei x=0 und enden
  früh — so wächst der Anteil des Freiraums **vor** dem Gesicht
- Desktop-Crop: **(0, 0, 1900, 2850) = 2:3** — Kopf, Schulter, oberer Latz
- Mobil-Crop: **(0, 0, 2000, 2500) = 4:5** — vollständiger Kopf mit Luft über
  dem Haar und vor dem Profil; bewusst kein engerer Gesichtsausschnitt
- Derivate: `tyll-500/1000` · `tyll-m-450/900` (WebP + JPG)
- Keine Bildunterschrift: Der Name steht als `<strong>` im Text daneben

---

## Tyll-final.jpg — ARCHIV (ersetzt durch Tyll-final2.jpg)
- 2672 × 4000, Hochformat
- Motiv: Tyll Schulte in Schürze, Profil, Blick auf die Arbeit gerichtet;
  im Hintergrund die Werkzeugwand der Backstube
- Person: **Tyll Schulte (eindeutig per Dateiname)**
- Qualität: scharf, warmes Licht, vollständiger Kopf mit Luft darüber
- Desktop-Crop: (150, 60, 2350, 3360) = 2200 × 3300, 2:3 — dasselbe
  Hochformat wie die übrigen Bildfenster; die Blickrichtung nach links
  bleibt frei, die Schürze ankert unten
- Mobil-Crop: (330, 130, 2200, 2650) = 1870 × 2520, ca. 3:4 — enger auf Kopf
  und Schultern, weil die Spalte dort nur rund 130 px breit ist
- Anzeige: 210 × 315 px Desktop, 130 × 195 px mobil (23 svh) — bewusst klein,
  es ist ein Bild-Text-Paar, kein Porträt-Aufmacher
- Keine Bildunterschrift: Der Name steht als `<strong>` im Text daneben

## Tyll-kessel.jpg — Reserve (nicht verwendet)
- 2672 × 4000, Hochformat
- Motiv: Tyll Schulte lachend über einem großen Edelstahlkessel, gibt etwas
  hinein; Werkzeugwand und Waage als Kontext
- Person: **Tyll Schulte (eindeutig per Dateiname)**
- Qualität: scharf, warm, klar lesbare Tätigkeit, sehr sympathischer Ausdruck
- Warum Reserve: Für die schmale Spalte der Menschen-Zone ist die Szene zu
  breit — der Kessel dominiert jeden vertikalen Ausschnitt. Als größeres
  Bild (Galerie oder Backstuben-Paar) wäre es ein starker Kandidat.

## Claudia.jpg — L (Samstagsfenster)
- 2664 × 3988, Hochformat
- Motiv: Claudia lacht hinter dem geöffneten Verkaufsfenster; davor Gast mit
  rosa Haaren, Lederjacke und Glitzerhose, Rücken zur Kamera
- Person: **Claudia Fourmont (eindeutig per Dateiname)**; Gast unbekannt.
  Der Name darf im Fließtext genannt werden — eine sichtbare Bildunterschrift
  ist dafür nicht nötig und bleibt bewusst weg (Auftraggeber-Vorgabe: keine
  Captions).
- Tätigkeit: Gespräch über die Theke, Verkaufssituation
- Qualität: scharf auf Claudia, gute Belichtung im Fensterausschnitt, starker
  Hell-dunkel-Kontrast; Rücken des Gastes dominiert im Vollbild
- Rolle: emotionales Leitbild Samstagsfenster
- Desktop-Crop: vertikal, oberes Drittel — Claudias Gesicht/Lachen im Fokus,
  Schulter des Gastes als schmaler Anschnitt links, Fensterrahmen sichtbar
  (ca. oberes 55–60 % des Bildes, leichter Links-Anschnitt)
- Mobil-Crop: enger 4:5-Ausschnitt um Fenster-Oberteil, Claudia mittig,
  Kopf vollständig, Gast nur als Randanschnitt
- Duplikate: keine
- Probleme: Vollbild ungeeignet (Rückendominanz) → nur als Crop einsetzen

## P1360057.jpg — E (Kaffee/Samstag, „Louis"-Kandidat)
- 2672 × 4000, Hochformat
- Motiv: Person mit dunklem Kopftuch, Karohemd und Schürze an der
  Zweigruppen-Espressomaschine; Tassen auf der Maschine, Fliesenwand,
  „SAMSTAGS…"-Schild am Fensterrand, Blick auf die Gasse
- Person: unbestätigt (laut Briefing vermutlich Louis — NICHT beschriften,
  bis bestätigt)
- Tätigkeit: Kaffeezubereitung, klar erkennbar; Person UND Maschine im Bild ✓
- Qualität: scharf, warm, viel verständlicher Kontext
- Rolle: Arbeitsmoment Samstagsbereich
- Desktop-Crop: nahezu Vollbild, leichter Beschnitt oben (Waage)
- Mobil-Crop: 4:5 um Person + Maschinenkopf + Tassen
- Probleme: keine

## P1360096.jpg — L (Pâtisserie)
- 2566 × 3849, Hochformat
- Motiv: Zitronen-Cheesecake mit Zitronenglasur und Mandelkante auf
  historischem grün-goldenem Porzellanteller; Stapel Zwiebelmuster-Teller
  im Hintergrund, dunkle Steinplatte
  (Korrektur 20.07.2026: zuvor fälschlich als „Karamelldecke" beschrieben)
- Tätigkeit: — (Stillleben)
- Qualität: sehr scharf, stimmungsvoll dunkel-warm, klare Komposition
- Rolle: dominantes Produktbild Pâtisserie; historisches Porzellan ✓
- Desktop-Crop: Vollbild oder 4:5 um Teller
- Mobil-Crop: 4:5, Teller bildfüllend, Tellerrand komplett
- Probleme: keine

## P1360101.jpg — L (HERO — einziges Querformat)
- 3990 × 2665, Querformat
- Motiv: historische Fassade Akademiestraße mit Relief-Schriftzug
  „BÄCKEREI von AUG. BUSCHMANN", Kronen-Ornamente, Schirme, Gäste an
  Tischen, Nachbarhäuser (Backstein), Laterne
- Tätigkeit: Samstagsbetrieb vor dem Haus
- Qualität: scharf, ausgewogen; Himmel kräftig teal getönt (Look des Fotos,
  nicht zusätzlich verstärken)
- Rolle: Hero-Leitbild — einziges Fassadenfoto, einziges Querformat
- Desktop-Crop: volle Breite, Fokus Mitte (Schriftzug + Eingang), Himmel
  oben moderat beschneiden
- Mobil-Crop: Hochformat-Ausschnitt Mitte: Schriftzug, Eingang, Schirme;
  Nachbarhäuser fallen weg
- Duplikate: keine (gut — keine doppelten Fassaden möglich)
- Probleme: keine

## P1360109.jpg — E (Reserve, Samstag von außen)
- 2650 × 3967, Hochformat
- Motiv: Frau von hinten vor dem Verkaufsfenster, Kreidetafel „KAFFEE" mit
  Getränkeliste, Schirm, Morelli-Kühlschrank im Innenraum
- Person: unbekannt, von hinten
- Tätigkeit: Bestellen am Fenster — Situation verständlich
- Qualität: scharf, warmes Licht
- Rolle: Reserve/Galerie (Rückansicht, aber verständliche Situation)
- Desktop-Crop: Vollbild
- Mobil-Crop: 4:5 um Fenster + Tafel
- Probleme: Rückansicht — nur einsetzen, wenn die Galerie einen
  Außen-Kontext braucht; nicht als Hauptmotiv

## P1360191.jpg — E (Geschichte)
- 2672 × 4000, Hochformat
- Motiv: historische REGO-Anschlagmaschine (creme-emailliert) mit
  Schneebesen und heller Masse im Kessel; alte Backstube
- Tätigkeit: Produktion (Maschine in Benutzung)
- Qualität: scharf, sehr warm/dunkel getont, starke Patina-Stimmung
- Rolle: Leitmotiv Geschichte („historische Maschine" ✓)
- Desktop-Crop: Vollbild oder leicht oben beschnitten
- Mobil-Crop: 4:5 um Maschinenkopf + Kessel
- Probleme: dunkle Ränder — auf dunklem Seitenhintergrund einfassen

## P1360200.jpg — ABLEHNEN
- 2672 × 4000, Hochformat
- Motiv: stark verschwommene Kannen/Schüsseln, abstrakte Lichtflächen
- Qualität: unscharf, ohne erkennbare Aussage
- Rolle: keine — „unscharfes Füllmotiv" laut Bildregie

## P1360218.jpg — D (Zutaten)
- 2672 × 4000, Hochformat
- Motiv: Mandelblättchen in Nahaufnahme, goldwarm
- Qualität: scharf im Zentrum, starke Textur
- Rolle: Detailbild Zutaten (Pâtisserie/Galerie)
- Desktop-Crop: frei (Textur), auch quer als Bandmotiv möglich
- Mobil-Crop: quadratisch/4:5 Zentrum
- Probleme: monochrome Wirkung — sparsam einsetzen

## Till.jpg — ABLEHNEN
- 2672 × 4000, Hochformat
- Motiv: Mann (schwarzes Polo, Schürze) hinter Rührkessel-Bügel; im
  Vordergrund Küchenrolle, Topf, viel Gerät
- Person: **Tyll Schulte (eindeutig per Dateiname)** — Datei zuletzt
  `Till.jpg` (vorher `Tyll.jpg`, ursprünglich `P1360233.jpg`), alle drei
  byte-identisch (SHA b9fd7bbd…). Der Dateiname trägt die Variante „Till“;
  öffentlich heißt er immer **Tyll Schulte**.
- Verwendung: **nein, technisch nicht möglich.** Geprüft am 2026-07-21 in
  den tatsächlichen Anzeigegrößen (230 px Desktop, 150 px mobil) auf
  Markenblau, dazu drei Crop-Varianten in Vollauflösung:
  1. **Der Scheitel ist bereits im Original angeschnitten** — die Pixel
     existieren nicht, kein Crop kann das beheben. Verstößt gegen die
     Bildregel „kein abgeschnittener Kopf“.
  2. Der Blick wirkt erschrocken/abgelenkt, nicht herzlich.
  3. Die Tätigkeit ist unlesbar: Die Hände liegen hinter einer unscharfen
     Kesselkante, die das untere Drittel beherrscht.
  4. Starkes Rauschen, weiche Zeichnung (Available Light, unterbelichtet).
  Ein Crop, der den Anschnitt vermeidet, zeigt nur noch dunkle Schürze und
  Hintergrund — dann ist Tyll nicht mehr erkennbar. Beides zusammen ist
  nicht lösbar. Sobald eine brauchbare Aufnahme vorliegt, kann sie ohne
  Layoutänderung in die Menschen-Zone der Backstube einziehen.
- Qualität: Blick irritiert an der Kamera vorbei, Vordergrund unruhig,
  Bügel schneidet durchs Bild — keine klare Tätigkeit
- Rolle: keine — Bildregie verlangt für Tyll „klare Tätigkeit und sinnvolle
  Bildqualität"

## P1360272.jpg — L (Backstube/Handwerk)
- 2672 × 4000, Hochformat
- Motiv: Bärtiger Mann mit Kappe gießt helle Masse aus Kessel in
  Kupferschüssel; konzentrierter Blick, Fliesenwand
- Person: unbestätigt (mutmaßlich Gregor Buschmann — NICHT beschriften,
  bis bestätigt)
- Tätigkeit: Umfüllen/Anschlagen — klar erkennbar, kraftvoll
- Qualität: scharf, dramatisch warm, beste Personenaufnahme der Serie
- Rolle: Leitbild Backstube und Menschen
- Desktop-Crop: Vollbild
- Mobil-Crop: 4:5 um Gesicht + Kessel + Schüssel
- Probleme: keine

## Kaffemaschine.jpg — L (Bildstrecke, Materialdetail) — VERWENDET
- 1401 × 2101, Hochformat, nativ bereits 2:3
- Motiv: Chrom-Brühgruppe der Espressomaschine mit Dampflanze, Typenschild
  und Abtropfgitter; warmes Streiflicht auf dem Metall
- Person: keine
- Qualität: scharf auf der Brühgruppe, dunkel aber materialstark
- Desktop-Crop: (60, 180, 1341, 2101) = 1281 × 1921, 2:3 — der obere Rand ist
  unscharfes, dunkles Gehäuse und fällt weg; Brühgruppe, Lanze, Typenschild
  und Gitter bleiben vollständig
- Mobil-Crop: (300, 500, 1100, 2101) = 800 × 1601, 1:2 — enger auf Brühgruppe
  und Lanze, damit das Chrom auch in einer 106-px-Spalte trägt
- Anzeige: 244 × 366 px Desktop (20 % der Boardbreite), 106 × 212 px mobil
- Keine Bildunterschrift, kein Rahmen — Einbettung über Position und Achse

> Frühere Einschätzung war „ablehnen: dunkler Chrom-Maschinenausschnitt ohne
> Person, nur Reserve für Mini-Detail". Genau als solches Mini-Detail ist es
> jetzt eingesetzt: klein, in der Bildstrecke, als technischer Kontrapunkt zu
> den warmen Materialbildern. Die Warnung vor „doppelten Kaffeemaschinen"
> bleibt beachtet — P1360057 (Maschine mit Person) steht im Samstagsabschnitt,
> also weit entfernt und mit anderem Motivgewicht.

## P1360326.jpg — E (Backstube, zweite Reihe)
- 2672 × 4000, Hochformat
- Motiv: derselbe bärtige Mann, schwarzes T-Shirt, Schürze, kariertes Tuch
  am Bund, füllt Spritzbeutel mit Masse
- Person: unbestätigt (wie P1360272)
- Tätigkeit: Spritzbeutel füllen — erkennbar
- Qualität: leichte Bewegungsunschärfe/Rauschen, dunkler
- Rolle: Ergänzungsbild Backstube/Galerie (zweite Priorität)
- Desktop-Crop: Vollbild
- Mobil-Crop: 4:5 um Hände + Beutel
- Probleme: nicht neben P1360272 stellen (gleiche Person, gleiche Szene)

## P1360329.jpg — E (Geschichte/Handwerk)
- 2672 × 4000, Hochformat
- Motiv: großer Schneebesen der historischen Maschine im Kupferkessel,
  geschlagene helle Masse, glühend warme Kupferwand
- Tätigkeit: Anschlagen (Maschine in Aktion)
- Qualität: sehr scharf, herausragende Material-Stimmung
- Rolle: Erzählbild Geschichte/Handwerk — Paradebild „Kupfer"
- Desktop-Crop: Vollbild
- Mobil-Crop: 4:5 um Besenkorb + Masse
- Probleme: keine

## P1360346.jpg — D (Handwerk)
- 2672 × 4000, Hochformat
- Motiv: Hände streichen Teig mit Winkelpalette in eine Backform
- Tätigkeit: klar erkennbar, anonym (keine Gesichter)
- Qualität: scharf auf Palette/Teig, ruhige Komposition
- Rolle: Detailbild Handgriffe (Pâtisserie/Galerie)
- Desktop-Crop: Vollbild oder 4:5
- Mobil-Crop: 4:5 um Hand + Form
- Probleme: keine

## P1360370.jpg — D (Produkt/Zutaten)
- 2672 × 4000, Hochformat
- Motiv: Hand über glänzender Kirschfüllung in Tortenrahmen, sattes Rot
- Tätigkeit: Belegen/Prüfen
- Qualität: Fokus auf Kirschen gut, Vordergrund weich (gewollt), sehr
  appetitlich
- Rolle: Detailbild Pâtisserie
- Desktop-Crop: 4:5 um Hand + Kirschen
- Mobil-Crop: quadratisch um Kirschen
- Probleme: unscharfer Papier-Vordergrund — beim Crop reduzieren

## P1360381.jpg — D (Zutaten)
- 2672 × 4000, Hochformat
- Motiv: Butter auf dunklen Schokoladen-Chips in Edelstahlkessel
- Qualität: scharf, klare Aussage „echte Zutaten"
- Rolle: Detailbild Zutaten (Catering/Pâtisserie/Galerie)
- Desktop-Crop: Vollbild oder quer angeschnitten
- Mobil-Crop: 4:5 Zentrum
- Probleme: keine

## P1360445.jpg — ABLEHNEN
- 653 × 980 (!), Hochformat
- Motiv: derselbe bärtige Mann (Brille im Haar) gießt rote Flüssigkeit in Topf
- Qualität: sehr kleine Auflösung, starkes Rauschen, weich
- Rolle: keine — technisch unzureichend für Flagship-Anspruch

## P1360788.jpg — E (Menschen/Samstag)
- 2651 × 3977, Hochformat
- Motiv: zwei lächelnde Frauen (jung, Schürze / dunkelhaarig, Hemd) hinter
  dem Verkaufsfenster, Leucht-Pfeil und Morelli-Schild im Raum
- Personen: unbestätigt — KEINE Namen verwenden
- Tätigkeit: Blick zum Gast, Verkaufsfenster-Situation
- Qualität: scharf, herzlich; in der unteren Fensterscheibe spiegelt sich
  der Fotograf (!)
- Rolle: Erzählbild Menschen/Samstag
- Desktop-Crop: oberes Fensterfeld (obere ~60 %) — Spiegelung fällt weg
- Mobil-Crop: 4:5 um beide Gesichter
- Probleme: untere Scheibe wegen Spiegelung IMMER wegschneiden

---

## Gruppenzuordnung (laut Briefing)

| Gruppe | Bilder |
|---|---|
| Fassade und Akademiestraße | P1360101 |
| Geschichte und historische Räume | P1360191, P1360329 |
| Gregor Buschmann, Backstube (Name belegt) | Gregor-final.jpg (aus P1360272) |
| Backstube, Name noch unbestätigt | P1360326 |
| Claudia am Fenster | Claudia.jpg |
| Louis an der Kaffeemaschine (Name unbestätigt) | P1360057 |
| Tyll Schulte bei der Arbeit (Name belegt) | — (Till.jpg abgelehnt: Qualität) |
| Menschen und Begegnungen | P1360788, (Reserve: P1360109) |
| Pâtisserie und Produkte | P1360096, P1360370 |
| Kaffee und Samstag | P1360057 · Kaffemaschine.jpg (Materialdetail in der Bildstrecke) |
| Werkzeuge, Zutaten und Details | P1360218, palette.jpg (aus P1360346), P1360381 |
| Produktion und Catering | P1360381 |
| Nicht verwenden | P1360200, Till.jpg, P1360445 |

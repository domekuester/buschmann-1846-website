# TRANSLATION-GUIDE — Deutsch / Englisch

Die englische Fassung ist keine Übersetzung, sondern eine zweite
Originalfassung derselben Marke. Beide Sprachen enthalten dieselben Fakten,
sind aber nicht Satz für Satz parallel gebaut.

## Spracharchitektur

| | Datei | URL | `lang` |
|---|---|---|---|
| Deutsch (Standard) | `index.html` | `…/buschmann-1846-website/` | `de` |
| Englisch | `en/index.html` | `…/buschmann-1846-website/en/` | `en` |

Zwei echte HTML-Seiten, gemeinsame Assets. Aus `en/` wird über `../assets/…`
referenziert — keine root-absoluten Pfade, damit der GitHub-Pages-Unterpfad
funktioniert. Die englische Seite ist ohne JavaScript vollständig lesbar.

## Sektions-IDs

| Deutsch | Englisch |
|---|---|
| `#geschichte` | `#history` |
| `#chronologie` | `#timeline` |
| `#backstube` | `#bakery` |
| `#galerie` | `#pictures` |
| `#samstag` | `#saturday` |
| `#standort` | `#location` |
| `#patisserie`, `#catering`, `#intro`, `#top` | unverändert |

Die Sprachlinks (`en/` bzw. `../`) funktionieren ohne JavaScript. Läuft JS,
hängt `assets/js/main.js` über `SECTION_MAP` den passenden Zielanker an,
sodass man nach dem Wechsel im selben Abschnitt bleibt.

## Verbindliche Begriffe

| Deutsch | Englisch | niemals |
|---|---|---|
| Zitronen-Cheesecake mit Zitronenglasur | lemon cheesecake with lemon glaze | caramel, caramel glaze |
| Backstube | bakery / bakery kitchen | bakehouse, manufactory |
| Gastronomie | cafés and restaurants, hospitality businesses | gastronomy |
| Altstadt | Düsseldorf’s Old Town | old city, historic centre |
| Samstagsfenster / Ausgabe | the window, serving guests | counter service, takeaway hatch |
| Pâtisserie (Marke/DE) | patisserie (EN, ohne Akzent) | pâtisserie im englischen Fließtext |

## Namen — in beiden Sprachen identisch

- **August Buschmann** — Gründer 1846, nie mit Gregor verwechseln
- **Gregor August Buschmann** — nur bei der ausführlichen Erstvorstellung
  im Geschichtsabschnitt
- **Gregor Buschmann** — alle späteren Erwähnungen, ausdrücklich auch im
  Tyll-Text
- **Claudia Fourmont** · **Tyll Schulte** (immer mit Y)
- Straßennamen bleiben deutsch: Akademiestraße, Flinger Straße, Maxschule

## Tonalität

Konkret statt werblich. Keine Wörter wie *exquisite, indulgent,
unforgettable, world-class, culinary journey, crafted with passion*. Die
Wärme kommt aus Tätigkeiten, Namen und Orten — nicht aus Adjektiven.

Nicht wörtlich übersetzen. Beispiele für bewusste Abweichungen:

| Deutsch | Englisch | warum |
|---|---|---|
| „Samstags ist das Fenster offen." | „On Saturdays, the window opens." | wörtlich („the window is open") verliert die Bewegung |
| „Vieles davon geht schneller — aber nicht besser." | „Plenty of it could be quicker — but not better." | deutscher Satzbau wäre im Englischen steif |
| „…dass Kuchen, Torten und Pâtisserie fertig und lieferbereit sind." | „…he gets the cakes, tarts and patisserie ready to go." | „ready for delivery" klingt nach Logistik, nicht nach Backstube |
| „Samstags gehört sie meist zu den vertrauten Gesichtern an der Ausgabe." | „On Saturdays, she is often one of the familiar faces serving guests." | „at the window" hätte „window" direkt nach der Headline wiederholt |

## Nicht behaupten

- keine Kontakt- oder Bestellanfragen über Instagram oder Facebook
- keine Innenplätze, kein Café-Gastraum, keine „doors are open"
- keine Anwesenheitsgarantie für Claudia an jedem Samstag
- keine Öffnungszeiten außer Samstag 12–17 Uhr

## Offener Punkt

Das Foto des Zitronen-Cheesecakes wird später durch ein neues Originalfoto
ersetzt. Produktbezeichnung und Abschnitt bleiben bis dahin unverändert.

# Final QA Report – Buschmann 1846

## Ausgangs-Commit

`24a1caa` (`feat: add bilingual privacy policy for IONOS hosting`) auf
`rebuild/flagship-recovery`.

## Geprüfte Seiten

- `/`
- `/en/`
- `/impressum/`
- `/en/legal-notice/`
- `/datenschutz/`
- `/en/privacy/`

## Geprüfte Viewports

320 × 568, 360 × 800, 390 × 844, 430 × 932, 768 × 1024, 820 × 1180,
1024 × 768, 1280 × 800, 1440 × 1000 und 1920 × 1080.

## Behobene Funktionsfehler

- THE-DORF-Quellennachweis in beiden Sprachfassungen mit der offiziellen
  Produktseite von THE MAG No. 5 verknüpft.
- Adresse in Header, Hero und Samstagsbereich durchgehend als
  „Akademiestraße 8“ vereinheitlicht.

## Design-Verbesserungen

Die bestehende Flagship-Art-Direction blieb unverändert. Der Abschlussdurchgang
bestätigt einen stabilen Seitenrhythmus, klare Navy-/Porzellan-Wechsel,
ausgewogene Bild-Text-Kompositionen und vollständige Header und Footer.

## Farb- und Typografie-Verbesserungen

Der neue Quellenlink übernimmt bewusst die bestehende Zitattypografie und
erhält einen klaren Hover- und Fokuszustand. Keine neuen Farben, Fonts,
Verläufe, Schatten- oder Kartensysteme wurden eingeführt.

## Foto- und Crop-Verbesserungen

Alle öffentlich verwendeten Bildvarianten, `picture`-/`srcset`-Angaben,
intrinsischen Maße und responsive Crops wurden geprüft. Die bestehenden
Desktop- und Mobilcrops bleiben erhalten; Originalfotos wurden nicht verändert
oder gelöscht.

## Claudia-Foto-Befund

Es existiert nur ein lokales Claudia-Original. Es ist ausreichend groß, aber
im Vergleich zur Gregor-/Tyll-Serie sichtbar weicher und hatte zu rote
Hauttöne. Die vorhandenen Desktop- und Mobilcrops wurden selektiv kühler und
weniger gesättigt neu entwickelt; künstliches Nachschärfen oder Rekonstruktion
fand nicht statt. Ein neues hochauflösendes Kundenfoto bleibt als Launch-TODO.

## Deutsche Textverbesserungen

- Historienabsatz auf die bestätigten Rollen Koch, Sous-Chef und Pâtissier
  präzisiert.
- Offizielle Schreibweise „Akademiestraße“ vereinheitlicht.
- THE-DORF-Magazinausgabe direkt erreichbar gemacht.

## Englische Textverbesserungen

- Rollenfolge entsprechend der deutschen Faktenbasis auf chef, sous-chef und
  pâtissier präzisiert.
- Eigenname „Akademiestraße“ durchgehend korrekt geschrieben.
- THE-DORF-Magazinausgabe direkt erreichbar gemacht.

## Accessibility

Alle Seiten haben genau eine sichtbare H1, gültige Sprachangaben, sinnvolle
Landmarks, Skip-Link, sichtbare Fokuszustände und keine doppelten IDs.
Mobilmenü, Escape, Fokusfalle, Fokusrückgabe, `aria-expanded` und Scroll-Lock
wurden per Tastatur geprüft. Kein horizontaler Overflow in den Pflichtgrößen.

## Performance

Lokale WOFF2-Schriften, WebP mit JPG-Fallback, responsive Quellen,
intrinsische Bildmaße, priorisiertes Hero-Bild und Lazy Loading unterhalb des
Fold sind vorhanden. Die Claudia-Derivate wurden ohne Qualitätsverlust
kleiner. Keine Abhängigkeit oder externe Ressource wurde ergänzt.

## SEO

Title, Description, Canonical, hreflang DE/EN/x-default, Open Graph,
Twitter Card, JSON-LD, Sitemap und robots.txt sind vollständig. Die einheitliche
GitHub-Pages-Vorschau-Basis bleibt bis zum bestätigten Domainlaunch erhalten;
der spätere Wechsel auf `https://www.buschmann1846.de/` steht im TODO.

## Impressum

Deutsche und englische Seite zeigen die bestätigte Geschäftsbezeichnung,
Inhaber/Geschäftsführer, Anschrift, Telefon, E-Mail und Website vollständig.
Keine normale Steuernummer, erfundene USt-ID oder erfundene Registerangabe ist
veröffentlicht.

## Datenschutz

Der ausgelieferte Stand bleibt statisch: kein Backend, Formular, Tracking,
Cookie, Web Storage, externer Font, Embed oder API-Aufruf. Aussagen zum
vorgesehenen IONOS-Hosting sind als Angaben von IONOS beziehungsweise als vor
Launch zu bestätigende Punkte formuliert.

## Externe Verbindungen

Beim kalten Laden aller sechs Seiten wurde keine fremde Domain kontaktiert.
Instagram, Facebook, THE DORF, IONOS und die Aufsichtsbehörde sind ausschließlich
nutzerausgelöste Links. Der THE-DORF-Verweis führt zur offiziellen Produktseite
von THE MAG No. 5, in der die Buschmann-Geschichte enthalten ist.

## Verbleibende offene Punkte

Siehe `content/TODO.md`: Foto- und Namensfreigaben, neues Claudia-Foto, finale
Kundenfotos, IONOS-Produkt/AVV/WebAnalytics/Logdauer, fachliche
Datenschutzfreigabe, Domain/HTTPS/Weiterleitungen sowie finaler Live-Audit.

## Ergebnis

Die sechs öffentlichen Seiten sind visuell geschlossen, responsiv,
tastaturbedienbar und lokal technisch fehlerfrei für die Kundenausgabe
vorbereitet.
Alle lokal eindeutig lösbaren Probleme wurden direkt behoben. Ausstehend sind
ausschließlich externe Bestätigungen und Schritte des späteren IONOS-Livegangs.

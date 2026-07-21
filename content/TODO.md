# TODO — Interne offene Punkte (NICHT auf der Website anzeigen)

## Vor Veröffentlichung zu klären (durch Auftraggeber)

- [ ] Bildrechte aller 18 Fotos bestätigen (Fotograf, Nutzungsrecht Web)
- [ ] Einverständnis der abgebildeten Personen (Claudia, Team, Gäste) bestätigen
- [ ] Personenzuordnung bestätigen: Wer ist auf P1360057 (Kaffeemaschine),
      P1360272/P1360326/P1360445 (Bart, Kappe),
      P1360788 (zwei Frauen am Fenster)? Namen erst danach verwenden.
- [ ] **Foto von Tyll Schulte fehlt (nicht die Zuordnung).** Die Identität
      ist seit dem Rename `P1360233.jpg` → `Tyll.jpg` belegt, das Bild bleibt
      aber aus Qualitätsgründen abgelehnt (unruhiger Vordergrund, Bügel im
      Bild, keine klare Tätigkeit). Tyll Schulte steht deshalb namentlich im
      Text der Backstube, aber ohne Foto. Bessere Aufnahme nachliefern, dann
      kann die Menschen-Zone ein Bild bekommen.
- [ ] Einverständnis für die **namentliche** Nennung von Claudia Fourmont
      und Tyll Schulte auf der Website bestätigen (bisher war nur die
      Abbildung, nicht die Namensnennung Thema).
- [ ] Logo in höherer Auflösung beschaffen (aktuell nur 374 px PNG)
- [ ] Kontaktweg für Catering-Anfragen festlegen (Telefon? E-Mail? Instagram-DM?)
      — bis dahin verweist die Website nur auf Instagram/Facebook
- [ ] Impressum + Datenschutzerklärung (rechtlich nötig, Inhalte fehlen).
      Bewusst NICHT im Footer verlinkt, solange die Seiten nicht existieren —
      ein toter Link wäre schlechter als kein Link. Beim Anlegen zusätzlich
      im Footer verlinken. Rechtstexte nicht erfinden lassen.
- [ ] GitHub Pages aktivieren (erst nach Freigabe, nach Merge-Entscheidung)
- [ ] Nach Pages-Aktivierung: og:image-URL in index.html prüfen — sie ist auf
      https://domekuester.github.io/buschmann-1846-website/ vorausgesetzt;
      bei anderer Domain/Custom Domain anpassen.

## Technisch (GATE 2) — erledigt am 19.07.2026

- [x] Newsreader + Instrument Sans lokal als variable WOFF2 (latin) inkl.
      OFL-Lizenzen in assets/fonts/
- [x] Webbilder-Pipeline: 03-webbilder/build-images.py → assets/img/
      (WebP q78 + JPG q82, Breiten 600/750/800/1200/1400/2000, Master-Crops
      für Hero-Mobil, Claudia und Fensterteam)
- [x] Favicon (48 px) + Apple-Touch-Icon (180 px) aus bereinigtem Logo
- [x] Social-Preview og-image.jpg (1200×630) aus dem Fassadenfoto
- [x] .nojekyll für GitHub Pages

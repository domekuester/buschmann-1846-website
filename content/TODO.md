# TODO — Interne offene Punkte (NICHT auf der Website anzeigen)

## Vor Veröffentlichung zu klären (durch Auftraggeber)

- [ ] Bildrechte aller 18 Fotos bestätigen (Fotograf, Nutzungsrecht Web)
- [ ] Einverständnis der abgebildeten Personen (Claudia, Team, Gäste) bestätigen
- [ ] Personenzuordnung bestätigen: Wer ist auf P1360057 (Kaffeemaschine),
      P1360326/P1360445 (Bart, Kappe),
      P1360788 (zwei Frauen am Fenster)? Namen erst danach verwenden.
      — P1360272 ist geklärt: Der Auftraggeber hat die neu entwickelte
      Fassung `Gregor-final.jpg` genannt; der Name wird seit 22.07.2026
      im Alt-Text verwendet.
- [ ] Zitronen-Cheesecake-Foto später durch neues Originalfoto ersetzen.
      Produktbezeichnung („Zitronen-Cheesecake mit Zitronenglasur" / „lemon
      cheesecake with lemon glaze") und der Pâtisserie-Abschnitt bleiben bis
      dahin unverändert — nicht entfernen, kein Platzhalter.
      — Zwischenstand 23.07.2026: Das vorhandene Foto wurde neu geschnitten
      (Teller fast randlos statt 55 % dunkler Arbeitsplatte) und aufgehellt;
      der Anteil zulaufender Schatten fiel von 8,69 % auf 0. Es trägt damit
      vorerst, ersetzt aber kein neues Originalfoto.
- [ ] Einverständnis für die **namentliche** Nennung von Claudia Fourmont
      und Tyll Schulte auf der Website bestätigen (bisher war nur die
      Abbildung, nicht die Namensnennung Thema).
- [ ] Logo in höherer Auflösung beschaffen (aktuell nur 374 px PNG)
- [ ] Kontaktweg für Catering-Anfragen festlegen (Telefon? E-Mail? Instagram-DM?)
      — bis dahin verweist die Website nur auf Instagram/Facebook
- [x] Angaben für das Impressum verbindlich geklärt und zweisprachige
      Rechtstextseiten angelegt:
      - genaue rechtliche Geschäftsbezeichnung:
        Buschmann 1846 Patisserie Catering
      - Gregor August Buschmann ist Inhaber und Geschäftsführer
      - keine Umsatzsteuer-Identifikationsnummer vorhanden
      - am 31. Dezember des Vorjahres und zuvor niemals mehr als zehn
        Beschäftigte
- [ ] Existiert eine Wirtschafts-Identifikationsnummer?
- [ ] Existiert irgendein Registereintrag?
- [ ] Vor endgültigem Kundenlaunch vorsorglich bestätigen, dass keine besondere
      gesetzliche oder freiwillig übernommene Verpflichtung zur Teilnahme an
      einem Verbraucherschlichtungsverfahren besteht. Das Unternehmen hatte am
      31. Dezember des Vorjahres höchstens zehn Beschäftigte.
- [x] Vorgesehen: klassisches IONOS Linux-Webhosting bei der IONOS SE.
- [x] Datenschutzentwurf auf IONOS-Webhosting vorbereitet; IONOS
      WebAnalytics berücksichtigt. Beim heutigen technischen Stand ist kein
      Cookie-Banner vorgesehen.
- [ ] Vor dem finalen Launch bestätigen:
      - tatsächlich gebuchtes IONOS-Produkt ist „Webhosting“
      - kein MyWebsite- oder WordPress-Baukasten
      - AV-Vertragsstatus im IONOS-Konto geprüft
      - IONOS WebAnalytics tatsächlich aktiv beziehungsweise Tarifstandard
      - finaler Domainpfad
      - HTTPS aktiv
      - www-/Nicht-www-Weiterleitung
      - Angaben zu Server-Logfiles weiterhin aktuell
      - Speicherdauer weiterhin acht Wochen
      - finale technische Netzwerkprüfung nach Upload
      - sämtliche absoluten URLs auf buschmann1846.de umgestellt
- [ ] Datenschutzerklärung vor Kundenlaunch fachlich final prüfen und freigeben.
- [ ] Bei der finalen Domainumstellung sämtliche absoluten URLs auf
      https://www.buschmann1846.de/ umstellen.
- [ ] Einzelne Kundenfotos später ersetzen, insbesondere das Foto von Claudia.
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

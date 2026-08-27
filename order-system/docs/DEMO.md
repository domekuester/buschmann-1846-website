# Buschmann Demo starten

Diese Seite ist für die Vorführung gedacht — mehr steht nicht drin.
Der Ablauf der Vorführung selbst: **DEMO-WALKTHROUGH.md**.

---

## Starten

1. Terminal öffnen
2. In den Ordner wechseln:

   ```
   cd ~/Desktop/buschmann-1846-rebuild/order-system
   ```

3. Demo starten:

   ```
   npm run demo
   ```

4. Warten, bis im Terminal steht:

   ```
   Ready on http://127.0.0.1:8790
   ```

5. Browser öffnen:

   **http://127.0.0.1:8790**

Der Befehl richtet alles selbst ein: Datenbank, Beispieldaten, Zugänge.
Das dauert wenige Sekunden. Beim allerersten Mal auf einem frischen Rechner
kann es länger dauern, weil der Worker einmal gebaut werden muss.

> **Adresse genau so eingeben.**
> `127.0.0.1:8790` funktioniert, `localhost:8790` nicht — dann lässt sich
> zwar alles ansehen, aber nichts speichern.

---

## Anmeldung Betrieb

| | |
|---|---|
| Kennung | `demo-admin@buschmann.test` |
| Passwort | `Vorfuehrung-Demo-2026` |

Nach der Anmeldung öffnet sich die **Produktion**. Das Dashboard liegt
oben in der Navigation.

---

## Demo-Kunden

Für den Kundenteil abmelden und mit einem dieser Zugänge neu anmelden:

| Kennung | PIN | Was dieser Zugang zeigt |
|---|---|---|
| `CAFEMORGEN` | `10101010` | Preisgruppe **Gastronomie**, Lieferung |
| `PRIVATDEMO` | `30303030` | Preisgruppe **Privatkunden** — dieselben Produkte, höhere Preise |
| `KONDITOREI` | `20202020` | **Noch keine Preisgruppe** — sieht keine Preise und kann nicht bestellen |

Der Vergleich von `CAFEMORGEN` und `PRIVATDEMO` ist die anschaulichste
Stelle der ganzen Demo: gleiches Sortiment, zwei Preiswelten.

---

## Was in der Demo steht

* **9 Produkte** — Käsekuchen, Butterkuchen, Schokoladenkuchen, Croissant,
  Baguette, Streuselschnecke, Obsttorte, Hochzeitstorte, Weihnachtsstollen
* **5 Kunden** — drei davon mit Zugang (siehe oben), zwei weitere bestellen
  nur mit, damit der Tag nach Betrieb aussieht
* **18 Bestellungen**, verteilt auf mehrere Tage

**Der wichtigste Tag ist morgen.** Dashboard und Produktion öffnen ihn von
selbst: acht Bestellungen, alle Bestellstatus, alle Zahlungswege, eine
stornierte.

Alle Daten sind frei erfunden. Es sind keine echten Kunden, keine echten
Preise und keine echten Herstellkosten enthalten.

---

## Demo zurücksetzen

```
npm run demo:reset
```

Setzt den Datenbestand auf den Ausgangsstand zurück. Alles, was während
einer Vorführung angeklickt oder bestellt wurde, ist danach weg.

**Nicht extra nötig vor jeder Vorführung:** `npm run demo` setzt den
Bestand ohnehin bei jedem Start zurück. `demo:reset` ist für den Fall,
dass etwas hakt.

---

## Demo beenden

Im Terminal:

```
Strg + C
```

---

## Wenn etwas nicht geht

**„Demo-Port 8790 ist bereits belegt."**

Die Demo läuft schon — meist in einem anderen Terminal-Fenster.
Entweder dort `Strg + C` drücken, oder:

```
lsof -nP -iTCP:8790 -sTCP:LISTEN
kill <PID>
```

(Die PID steht in der zweiten Zeile der ersten Ausgabe.)

**Anmeldung wird abgelehnt**

Kennung und Passwort genau wie oben eingeben. Wenn es weiterhin nicht
geht: Demo beenden, `npm run demo:reset`, neu starten.

**Seite lädt nicht**

Prüfen, ob im Terminal noch `Ready on http://127.0.0.1:8790` steht. Wenn
der Befehl abgebrochen ist, einfach `npm run demo` erneut ausführen.

---

## Wichtig

* Die Demo läuft **ausschließlich auf diesem Rechner**. Kein Server, keine
  Cloud, keine E-Mails, keine echten Kundendaten.
* Sie benutzt eine **eigene Datenbank**. Der Entwicklungsstand auf Port 8787
  bleibt davon unberührt.
* Die Zugangsdaten auf dieser Seite gelten **nur für die Demo** und dürfen
  in keinem echten Betrieb verwendet werden.

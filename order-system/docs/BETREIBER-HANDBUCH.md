# Buschmann 1846 — Bestellsystem
## Handbuch für den Betrieb

Dieses Heft beschreibt, was Sie im Bestellsystem sehen und tun können.
Es ist nach den Seiten aufgebaut, die oben in der Navigation stehen.

Wenn Sie nur eine Seite lesen: **Kapitel 13, „Ein typischer Arbeitstag"**.

---

## 1 · Anmelden

Sie öffnen die Adresse des Bestellsystems im Browser und geben Ihre Kennung
und Ihr Passwort ein.

Danach sehen Sie die **Produktion** — den Tag, für den als Nächstes gebacken
wird. Oben stehen die übrigen Seiten:

**Dashboard · Produktion · Sortiment & Preise · Kunden · Bestellregeln**

Rechts oben steht Ihre Kennung und daneben **Abmelden**.

Ihre Kunden melden sich an derselben Adresse an — mit ihrer eigenen Kennung
und ihrer eigenen PIN. Sie sehen dann ausschließlich ihre Bestellseite,
niemals Ihre Zahlen.

**Passwort vergessen?** Ein neues Passwort kann nur derjenige einrichten, der
das System für Sie betreut. Es lässt sich nicht per E-Mail zurücksetzen — das
ist Absicht.

---

## 2 · Das Dashboard verstehen

Das Dashboard ist der Überblick über **einen Tag**. Voreingestellt ist
morgen — der Tag, für den Sie gleich backen.

Mit den Schaltern **Heute · Morgen · Woche** wechseln Sie die Ansicht, mit
den Pfeilen daneben gehen Sie tageweise vor und zurück.

### Kennzahlen des Tages

| | |
|---|---|
| **Bestellungen** | Wie viele Bestellungen für diesen Tag vorliegen. Stornierte zählen nicht mit, werden aber daneben genannt. |
| **Umsatz** | Was diese Bestellungen zusammen ausmachen, ohne stornierte. |
| **Offen / in Arbeit** | Was noch nicht abgeschlossen ist. |
| **Noch nicht bezahlt** | Wie viel Geld für diesen Tag noch aussteht. |
| **Kunden** | Wie viele verschiedene Betriebe an diesem Tag bestellt haben. |
| **Einheiten** | Wie viele Stück, Bleche und Torten insgesamt. |

### Handlungsbedarf

Darunter steht, was heute noch jemand anfassen muss: neue Bestellungen, die
noch niemand bestätigt hat, offene Produktion, offene Zahlungen. Jeder Punkt
hat einen Link direkt dorthin.

Steht dort nichts, ist für diesen Tag nichts offen.

### Finanzen

Umsatz, Herstellkosten, Rohertrag und Marge — dazu Kapitel 11.

### Zahlungen und Bestellstatus

Zwei Ringe: Wer hat schon bezahlt, und wie weit ist die Produktion.

### Bestellungen

Ganz unten die Liste des Tages: Bestellnummer, Kunde, Lieferung oder
Abholung, Status, Betrag und Zahlung. Hier tragen Sie auch die Zahlung nach
(Kapitel 5).

---

## 3 · Bestellungen bearbeiten

Eine Bestellung durchläuft vier Zustände:

**Neu → Bestätigt → In Produktion → Abgeschlossen**

* **Neu** — der Kunde hat bestellt, Sie haben sie noch nicht angesehen
* **Bestätigt** — Sie haben sie gesehen und nehmen sie an
* **In Produktion** — sie ist in der Backstube
* **Abgeschlossen** — ausgeliefert oder abgeholt

Der Weg geht **nur vorwärts**. Eine abgeschlossene Bestellung lässt sich
nicht zurückstellen. Das ist so gewollt: Ein Status, den man beliebig hin und
her schieben kann, sagt nach zwei Wochen nichts mehr aus.

**Stornieren** geht aus jedem Zustand außer „Abgeschlossen". Sie werden vorher
gefragt, ob Sie wirklich stornieren wollen. Eine stornierte Bestellung
verschwindet nicht — sie bleibt sichtbar, zählt aber nicht mehr zum Umsatz
und nicht mehr zur Produktion.

**Ändern kann eine Bestellung niemand.** Weder Sie noch der Kunde. Wenn sich
etwas ändert: stornieren und neu bestellen lassen. Auch das ist Absicht — so
steht in einer Bestellung immer das, was tatsächlich bestellt wurde.

---

## 4 · Produktion

Die Seite **Produktion** ist die Arbeitsseite des Tages.

**Oben** stehen die zusammengezählten Mengen: „Käsekuchen 6 Stück,
Butterkuchen 3 Blech, Croissant 6 Stück". Das ist Ihr Backplan.

**Darunter** stehen die einzelnen Bestellungen mit Kunde, Bestellnummer,
Status und Positionen. An jeder Bestellung sind die Schaltflächen, mit denen
Sie den Status weiterschalten.

Stornierte und abgeschlossene Bestellungen stehen hier nicht mehr — die
Seite zeigt, was noch zu tun ist.

Oben rechts führen zwei Links zu den Drucklisten (Kapitel 9 und 10).

---

## 5 · Zahlung nachtragen

Im Dashboard, in der Bestellliste unten, hat jede Bestellung ein
Auswahlfeld für die Zahlung:

**Offen · Bar bezahlt · Karte bezahlt · Überweisung bezahlt · Sonstiges bezahlt**

Auswählen, **Speichern** — fertig. Die Kennzahl „Noch nicht bezahlt" oben
ändert sich sofort mit.

**Bezahlt und fertig sind zwei verschiedene Dinge.** Eine Bestellung kann
abgeschlossen und trotzdem offen sein — der Kuchen ist abgeholt, die Rechnung
wird am Monatsende beglichen. Das System hält beides getrennt, weil es im
Betrieb auch getrennt ist.

Das System ist **keine Kasse**. Es hält fest, *dass* bezahlt wurde und
*womit* — nicht, wie viel im Einzelnen, keine Teilzahlungen, keine
Rückerstattungen, keine Rechnungsnummern.

---

## 6 · Sortiment und Preise

Die Seite **Sortiment & Preise** zeigt Ihr Sortiment in einer Tabelle:
Produkt, Einheit, **Gastronomiepreis**, **Privatpreis**, **Herstellkosten**.

Es gibt vier Arten, wie ein Preis dastehen kann:

| Art | Bedeutung |
|---|---|
| **4,35 €** | Fester Preis. Das Produkt ist online bestellbar. |
| **ab 24,00 €** | Der Preis hängt von der Größe ab. Nicht online bestellbar — der Kunde spricht Sie an. |
| **12,00–18,00 €** | Eine Spanne. Ebenfalls nicht online bestellbar. |
| **Auf Anfrage** | Wird besprochen, zum Beispiel eine Hochzeitstorte. |

Steht in einer Spalte ein Strich (**—**), ist das Produkt für diese
Preisgruppe nicht bepreist — der Kunde sieht dann keinen Preis und kann es
nicht bestellen. Er sieht **niemals 0,00 €**.

> **Preise ändern Sie zurzeit nicht selbst.** Preisänderungen und neue
> Produkte trägt derjenige ein, der das System für Sie betreut. Sagen Sie
> ihm Bescheid — es dauert wenige Minuten.

---

## 7 · Kunden und Preisgruppen

Auf der Seite **Kunden** steht jeder Kunde mit seiner Preisgruppe:

* **Gastronomie** — Ihre gewerblichen Kunden
* **Privatkunden**
* **Nicht zugeordnet**

Die Preisgruppe ändern Sie über das Auswahlfeld in der Zeile und
**Speichern**.

**„Nicht zugeordnet" ist kein Fehler, sondern eine offene Entscheidung.**
Ein neu angelegter Kunde bekommt nicht stillschweigend Gastropreise. Er
sieht so lange keine Preise und kann nichts bestellen, bis Sie sich
entschieden haben. Lieber gar kein Preis als der falsche — ein Privatkunde,
der versehentlich zu Gastropreisen einkauft, ist teurer als ein Anruf.

Oben auf der Seite steht, wie viele Kunden noch keiner Preisgruppe zugeordnet
sind.

Ein Klick auf den Namen führt zur **Kundenübersicht**: Preisgruppe, Status
und die letzten zehn Bestellungen dieses Kunden mit Tag, Betrag und Zahlung.
Gut für die Frage am Telefon: „Was hatten wir letzte Woche?"

> **Neue Kunden und Zugänge** legt ebenfalls derjenige an, der das System
> betreut. Sie brauchen dafür den Namen, die Lieferadresse (falls geliefert
> wird) und die gewünschte Preisgruppe.

---

## 8 · Bestellregeln

Auf der Seite **Bestellregeln** legen Sie fest, wann Sie Bestellungen
annehmen. Ganz oben steht in einem Satz, was gerade gilt.

### Bestelltage

Sieben Kästchen, eines je Wochentag. Nur für angekreuzte Tage können Kunden
bestellen. Ist der Sonntag nicht angekreuzt, bietet die Bestellseite ihn gar
nicht erst an.

### Bestellschluss

Zuerst das Kästchen **Bestellschluss verwenden**. Ohne Haken kann jederzeit
bestellt werden — auch noch am selben Morgen.

Mit Haken stellen Sie zwei Dinge ein:

* **Tage vorher** — wie viele Tage vor dem Backtag Schluss ist.
  `0` heißt: am Backtag selbst, bis zur Uhrzeit.
* **Uhrzeit**

Gezählt werden **Kalendertage**, keine Werktage: Ein Tag vor Montag ist der
Sonntag. Unter dem Feld steht ein Beispiel mit echten Daten, damit Sie sehen,
was Ihre Einstellung bedeutet.

Änderungen gelten **sofort** für alle Kunden. Bereits eingegangene
Bestellungen bleiben davon unberührt.

---

## 9 · Produktionsliste

Auf der Seite **Produktion** oben rechts: **Produktionsliste drucken**.

Eine reine Backliste: der Tag, darunter jedes Produkt mit der Gesamtmenge.
Keine Kunden, keine Preise, keine Navigation — eine Seite, die man in die
Backstube hängen kann.

Die Schaltfläche **Drucken** öffnet den Druckdialog.

---

## 10 · Abholliste

Auf der Seite **Produktion** oben rechts: **Abholliste**.

Dieselben Bestellungen, aber **nach Kunden sortiert**: für jeden Kunden seine
Bestellnummer und was für ihn zusammenzustellen ist.

Das ist die Liste für die Theke — die Produktionsliste sagt, *was* gebacken
wird, die Abholliste sagt, *für wen* es zusammengepackt wird.

Auch diese Seite ist zum Drucken gemacht.

---

## 11 · Herstellkosten und Marge

### Was Herstellkosten hier sind

Ein geschätzter Wert: Was kostet Sie ein Käsekuchen an Material?
**Keine Vollkostenrechnung** — kein Strom, keine Arbeitszeit, keine
Abschreibung. Eine Zahl, die Sie in zehn Sekunden je Produkt eintragen
können, und ein Betrag, der besser ist als gar keiner.

### Eintragen

Auf der Seite **Sortiment & Preise**, rechte Spalte: Betrag in Euro
eintragen, **Speichern**.

Feld leer lassen heißt „nicht hinterlegt". Das ist etwas anderes als `0,00 €`
— null hieße, dass Sie dieses Produkt tatsächlich nichts kostet.

### Was daraus gerechnet wird

Im Dashboard, im Kasten **Finanzen**:

* **Herstellkosten** — was der Tag Sie an Material gekostet hat
* **Rohertrag** — Umsatz minus Herstellkosten
* **Marge** — der Rohertrag als Anteil vom Umsatz

### Wenn etwas fehlt

Fehlt bei auch nur einem bestellten Produkt der Kostenwert, steht dort
**„Kostenbasis unvollständig"** — und Rohertrag und Marge bleiben leer, mit
einem Hinweis, bei wie vielen Bestellungen etwas fehlt.

**Das System rechnet lieber gar nichts als etwas Falsches.** Eine Marge, die
fehlende Kosten als Null behandelt, sähe jedes Mal zu gut aus.

### Herstellkosten sind intern

Ihre Kunden sehen diese Zahlen **nirgends** — nicht auf der Bestellseite,
nicht in der Bestätigung, nirgendwo. Es gibt im ganzen System keine
Kundenansicht, die einen Kostenwert enthält.

---

## 12 · Was tun bei einem Fehler?

### Ein Kunde sagt, er kann nicht bestellen

1. **Kunden** öffnen und nachsehen, ob er eine Preisgruppe hat. Steht dort
   „Nicht zugeordnet", ist das die Ursache — zuordnen, speichern, fertig.
2. **Bestellregeln** öffnen: Ist der gewünschte Tag überhaupt ein Bestelltag?
   Ist der Bestellschluss schon vorbei?
3. Wenn beides passt: an Ihre Betreuung wenden.

### Ein Preis ist falsch

Ändern Sie nichts an der Bestellung — das geht auch nicht. Melden Sie den
Preis Ihrer Betreuung. Danach gilt der neue Preis für alle **neuen**
Bestellungen; die alten bleiben, wie sie waren.

### Ich habe den falschen Status gesetzt

Vorwärts geschaltet ist geschaltet — zurück geht es nicht. Solange die
Bestellung nicht abgeschlossen ist, können Sie sie stornieren und den Kunden
neu bestellen lassen. Ist sie abgeschlossen, notieren Sie es und machen
weiter; der Status ist eine Arbeitshilfe, keine Buchhaltung.

### Ich habe die falsche Zahlung eingetragen

Einfach richtig auswählen und noch einmal speichern. Der Zahlungsstand lässt
sich beliebig oft ändern.

### Die Seite lädt nicht

1. Seite neu laden.
2. Prüfen, ob andere Internetseiten gehen.
3. Wenn es nur diese Seite betrifft: Ihre Betreuung anrufen.

**Es geht dabei nichts verloren.** Alle Bestellungen liegen gespeichert vor,
auch wenn die Seite gerade nicht erreichbar ist.

### Ich bin unsicher, ob ich etwas kaputt machen kann

Sie können auf keiner Seite Daten löschen. Das Schlimmste, was passieren
kann, ist ein falsch gesetzter Status oder eine falsche Preisgruppe — beides
ist ohne Schaden zu korrigieren beziehungsweise zu ergänzen.

---

## 13 · Ein typischer Arbeitstag

### Morgens, vor der Backstube

1. **Dashboard** öffnen. Es steht auf morgen.
2. **Handlungsbedarf** ansehen: Gibt es neue Bestellungen?
3. **Produktion** öffnen und die neuen Bestellungen **bestätigen**.
4. **Produktionsliste drucken** und in die Backstube geben.

### Während der Produktion

5. Bestellungen, die in Arbeit gehen, auf **In Produktion** setzen.
6. Was fertig ist, auf **Abgeschlossen** setzen.

### Bei Auslieferung und Abholung

7. **Abholliste** öffnen — für jeden Kunden steht dort, was zusammengestellt
   werden muss.
8. Wer bar oder mit Karte zahlt: im **Dashboard** die Zahlung nachtragen.

### Zwischendurch

9. Kommt eine neue Bestellung herein, erscheint sie sofort im Dashboard und
   in der Produktion. Es gibt keine Benachrichtigung — ein Blick am Vormittag
   und einer am Nachmittag reichen.

### Wöchentlich, nach Bedarf

* **Kunden** — neue Kunden einer Preisgruppe zuordnen
* **Sortiment & Preise** — Herstellkosten ergänzen, wo noch keine stehen
* **Bestellregeln** — nur, wenn sich etwas an Ihren Backtagen ändert
* **Dashboard → Woche** — der Blick auf die ganze Woche

---

## 14 · Ihre Daten

**Die Preise gehören Ihrem Betrieb.** Sie legen fest, was ein Kunde zahlt,
und Sie legen fest, wer zu welcher Preisgruppe gehört. Es gibt keine
Voreinstellung, die für Sie entscheidet.

**Bestellungen bleiben gespeichert.** Eine Bestellung ist ein Dokument. Sie
verschwindet nicht, wenn sie abgeschlossen ist, und sie verschwindet nicht,
wenn ein Kunde aufhört. Auch stornierte Bestellungen bleiben nachlesbar.

**Historische Preise bleiben historisch.** In jeder Bestellung steht der
Preis, der zum Zeitpunkt der Bestellung galt. Eine Preisänderung heute ändert
nichts an einer Bestellung von letztem Monat — auch der Kundenname und die
Lieferadresse stehen so darin, wie sie damals waren.

**Herstellkosten sind interne Angaben.** Sie dienen Ihrer eigenen Rechnung.
In jeder Bestellung wird der Kostenstand des Bestelltages mitgespeichert:
Wird die Butter teurer und Sie ziehen den Wert nach, sieht eine Bestellung
von vor drei Monaten deshalb nicht rückwirkend schlechter aus.

**Kunden sehen Herstellkosten niemals.**

**Was das System nicht tut:** Es verschickt keine E-Mails, es schreibt keine
Rechnungen, es führt keine Kasse, es gibt nichts an Dritte weiter, und es
wertet nichts über Ihre Kunden aus, was Sie nicht selbst eingetragen haben.

---

*Fragen, die hier nicht beantwortet sind, gehen an die Betreuung des Systems.
Der Ansprechpartner steht in der Übergabe-Checkliste.*

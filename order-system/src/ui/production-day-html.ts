import { escapeHtml } from './format';
import type {
  ProductionDayView,
  ProductionLineView,
  ProductionOrderItemView,
  ProductionOrderView,
  StatusActionView,
} from './production-day-view';

/**
 * Die Bausteine der Produktions-Tagesansicht.
 *
 * KLEINE FUNKTIONEN STATT EINER GROSSEN. Eine renderAdminPage() mit
 * fünfhundert Zeilen wäre nur als Ganzes prüfbar und nur als Ganzes zu
 * ändern; hier hat jede Funktion eine Verantwortung und einen eigenen Test.
 * Ein Komponentensystem mit Zustand und Lebenszyklus wäre für statisches HTML
 * dagegen Aufwand ohne Gegenwert — es bleibt bei reinen Funktionen, die
 * Zeichenketten zurückgeben, wie in order-page-html.ts.
 *
 * JEDER DYNAMISCHE WERT LÄUFT DURCH escapeHtml. Ohne Ausnahme, auch die
 * unverdächtigen: Ein „das ist doch nur eine Konstante" ist genau die Stelle,
 * an der später jemand eine Variable einsetzt. Die Funktion stammt aus
 * format.ts und ist die einzige ihrer Art im System.
 *
 * ES GIBT HIER KEINE PREISE. Nicht, weil sie unterdrückt werden, sondern weil
 * das Ansichtsmodell keine führt. Was nicht da ist, kann nicht versehentlich
 * gerendert werden.
 */

/**
 * Die Backliste — der dominierende Bereich der Seite.
 *
 * EINE TABELLE, weil die Daten eine sind: zwei Spalten, gleichartige Zeilen,
 * eine Kopfzeile, die beide benennt. Eine Liste aus <div> müsste dieselbe
 * Struktur mit ARIA nachbauen und hätte nichts gewonnen. Sie funktioniert
 * auch auf 375px, weil sie nur zwei Spalten hat und die linke umbrechen darf
 * — ein geschrumpfter Desktop-Tabellenkörper mit horizontalem Scrollen wäre
 * das Gegenteil davon.
 *
 * Der Produktname steht in einem <th scope="row">: Er benennt die Zeile,
 * genauso wie „Menge" die Spalte benennt. Ein Screenreader liest damit bei
 * der Zahl mit, worum es geht.
 *
 * MENGE UND EINHEIT STEHEN IN EINER ZELLE. Getrennt gelesen ergäbe das „elf"
 * — Pause — „Stück"; zusammen ist es die Information.
 *
 * Sortiert wird NICHT. Die Reihenfolge kommt aus Phase 3B und steht im
 * Ansichtsmodell bereits fest.
 *
 * DIE ÜBERSCHRIFT HEISST „Zu produzieren" UND NICHT „Produktion". Der Grund
 * kam aus dem Browser und nicht aus dem Entwurf: Die h1 trägt bereits das
 * Wort „Produktion" als Bereichslabel, und beide standen im Abstand von zwei
 * Zeilen wörtlich übereinander. Zweimal dasselbe Wort liest sich wie ein
 * Fehler im Aufbau.
 */
export function renderProductionSummary(view: ProductionDayView): string {
  if (view.isEmpty) {
    return renderEmptyState();
  }

  return `
      <section class="produktion produktion--workmode" aria-labelledby="titel-produktion">
        <div class="produktion__kopf">
          <h2 id="titel-produktion">Zu produzieren</h2>
          <p class="produktion__meta">${view.totalUnits} Einheiten <span aria-hidden="true">·</span> ${view.products.length} ${view.products.length === 1 ? 'Produktart' : 'Produktarten'}</p>
        </div>
        <table class="backliste">
          <caption class="hinweis">Zu produzierende Mengen für ${escapeHtml(view.dayLabel)}</caption>
          <thead>
            <tr>
              <th scope="col">Produkt</th>
              <th scope="col" class="backliste__spalte-menge">Menge</th>
            </tr>
          </thead>
          <tbody>
${view.products.map(produktZeile).join('\n')}
          </tbody>
        </table>
      </section>`;
}

/**
 * Eine Zeile der Backliste.
 *
 * DER UMBENENNUNGSFALL. Kommt dieselbe Produkt-ID an einem Tag mit
 * abweichender Bezeichnung vor, führt Phase 3B sie bewusst nicht zusammen —
 * eine Summe über „8 Blech" und „3 Stück" wäre eine Zahl ohne Bedeutung. Ohne
 * Erklärung sieht das in der Backstube aus wie ein doppelter Eintrag, deshalb
 * steht an der abweichenden Zeile ein Satz, der es benennt.
 *
 * Der Satz ist über aria-describedby an den Produktnamen gebunden, damit ein
 * Screenreader ihn im Zusammenhang liest und nicht als loses Textfragment.
 *
 * DIE ID DES HINWEISES WIRD AUS DEM INDEX GEBILDET und nicht aus der
 * Produkt-ID: Die Produkt-ID hat auf dieser Seite nichts verloren — auch
 * nicht in einem Attribut, wo sie im Quelltext und in jedem Screenshot der
 * Entwicklerwerkzeuge stünde. Der Index ist innerhalb des Dokuments eindeutig
 * und sagt nichts über die Datenbank aus.
 */
function produktZeile(line: ProductionLineView, index: number): string {
  const hinweisId = `abweichung-${index}`;
  const beschrieben = line.renamed ? ` aria-describedby="${hinweisId}"` : '';

  return `            <tr>
              <th scope="row" class="backliste__produkt"${beschrieben}>
                <span class="backliste__name">${escapeHtml(line.name)}</span>${
                  line.renamed
                    ? `
                <span class="backliste__abweichung" id="${hinweisId}">Abweichende Bezeichnung aus einer Bestellung</span>`
                    : ''
                }
              </th>
              <td class="backliste__menge">
                <span class="backliste__zahl">${line.quantity}</span> <span class="backliste__einheit">${escapeHtml(line.unit)}</span>
              </td>
            </tr>`;
}

/**
 * Ein Tag ohne offene Bestellungen.
 *
 * DAS IST EIN NORMALER BETRIEBSZUSTAND UND KEIN FEHLER. Kein Warnzeichen,
 * keine rote Fläche, keine Illustration, keine Animation — ein Montag im
 * Januar sieht eben so aus. Die Datumsnavigation steht darüber und bleibt
 * vollständig bedienbar; sie ist genau jetzt das, was gebraucht wird.
 */
function renderEmptyState(): string {
  return `
      <section class="produktion produktion--leer" aria-labelledby="titel-produktion">
        <h2 id="titel-produktion">Zu produzieren</h2>
        <p class="leer">Für diesen Tag sind keine offenen Bestellungen vorhanden.</p>
      </section>`;
}

/**
 * Die Aufschlüsselung — woraus die Backliste entsteht.
 *
 * SIE IST BEWUSST LEISER ALS DIE SUMME. Der Mitarbeiter soll zuerst
 * beantworten können „wie viele Käsekuchen?" und erst danach „für wen?".
 * Stünden die Bestellkarten gleich laut da, wäre die Reihenfolge der Fragen
 * umgedreht — und damit genau die Arbeit wieder da, die das System abnehmen
 * soll: aus zwölf Karten selbst zu summieren.
 *
 * KARTEN UND KEINE TABELLE. Die Daten sind ungleichartig — ein Name, eine
 * Nummer, zwei Merkmale, n Positionen und eine optionale Notiz aus zwei
 * Sätzen. Eine Notiz sprengt jede Tabellenzelle, und auf einem Telefon
 * bliebe von einer sechsspaltigen Zeile nichts Lesbares übrig.
 *
 * KEINE BESTELLUNGEN, KEIN ABSCHNITT. Eine Überschrift „Bestellungen" über
 * nichts wäre eine Frage ohne Antwort; der leere Tag sagt bereits im
 * Produktionsbereich, was los ist.
 */
export function renderOrderBreakdown(view: ProductionDayView, csrfToken: string): string {
  if (view.orders.length === 0) {
    return '';
  }

  return `
      <section class="bestellungen" aria-labelledby="titel-bestellungen">
        <h2 id="titel-bestellungen">Bestellungen</h2>
${view.orders.map((order) => bestellkarte(order, csrfToken)).join('\n')}
      </section>`;
}

/**
 * Eine Bestellung.
 *
 * DER STATUS STEHT AUSGESCHRIEBEN DA und nicht als Farbpunkt. Farbe allein
 * ist für einen Teil der Nutzenden keine Information — dieselbe Regel, der
 * app.css bereits bei der ausgewählten Produktzeile folgt.
 *
 * SEIT PHASE 4B STEHT UNTER DER KARTE EINE AKTIONSFLÄCHE. Sie steht ZULETZT,
 * und das ist die eigentliche Gestaltungsentscheidung dieser Phase: Die
 * wichtigste Frage der Seite bleibt „wie viele Käsekuchen?" — sie wird oben
 * in der Backliste beantwortet. Die Schaltflächen sind das, was danach kommt,
 * und sie sehen auch so aus. Große Handlungsflächen an dieser Stelle würden
 * eine Produktionsübersicht in eine Klickliste verwandeln.
 *
 * Der Kundenname ist eine <h3> unter der <h2> des Abschnitts — die Hierarchie
 * bleibt lückenlos, und ein Screenreader kann von Bestellung zu Bestellung
 * springen.
 *
 * WAS NICHT AUF DER KARTE STEHT: keine E-Mail, keine Telefonnummer, keine
 * Lieferadresse, keine Bestell-ID, keine Kunden-ID, kein Betrag. Das
 * Lesemodell führt nichts davon; die Karte kann es nicht zeigen.
 */
function bestellkarte(order: ProductionOrderView, csrfToken: string): string {
  return `        <article class="bestellung">
          <h3 class="bestellung__kunde">${escapeHtml(order.customerName)}</h3>
          <p class="bestellung__nummer">${escapeHtml(order.orderNumber)}</p>
          <p class="bestellung__merkmale">
            <span class="marke-status">${escapeHtml(order.statusLabel)}</span>
            <span aria-hidden="true"> · </span>
            <span class="marke-uebergabe">${escapeHtml(order.fulfillmentLabel)}</span>
          </p>
          ${
            order.lastStatusChange === null
              ? ''
              : `<p class="bestellung__status-audit">Zuletzt geändert: ${escapeHtml(
                  order.lastStatusChange.changedAtLabel,
                )} <span aria-hidden="true">·</span> ${escapeHtml(order.lastStatusChange.changedBy)}</p>`
          }
          <ul class="bestellung__positionen">
${order.items.map(position).join('\n')}
          </ul>${order.note === null ? '' : notiz(order.note)}${aktionsflaeche(order, csrfToken)}
        </article>`;
}

/**
 * Die Aktionsfläche einer Bestellung.
 *
 * WELCHE SCHALTFLÄCHEN HIER ERSCHEINEN, ENTSCHEIDET DIESE DATEI NICHT. Sie
 * rendert, was im Ansichtsmodell steht, und dort kommt es aus
 * canTransitionTo(). In dieser Datei gibt es keinen einzigen Statusvergleich
 * und keine Liste erlaubter Übergänge — dieselbe Regel, der auch
 * http/admin-order-api.ts folgt.
 *
 * KEINE AKTION, KEINE FLÄCHE. Eine abgeschlossene oder stornierte Bestellung
 * bekommt keinen leeren Kasten und keine ausgegraute Schaltfläche: Eine
 * deaktivierte Schaltfläche wäre das Angebot einer Handlung, die es nicht
 * gibt, und sie ist für Tastatur und Screenreader zusätzlich ein Hindernis
 * ohne Zweck.
 */
function aktionsflaeche(order: ProductionOrderView, csrfToken: string): string {
  if (order.actions.length === 0) {
    return '';
  }

  return `
          <div class="bestellung__aktionen">
${order.actions.map((aktion) => statusAktion(order, aktion, csrfToken)).join('\n')}
          </div>`;
}

/**
 * EIN FORMULAR JE AKTION — und das ist die Entscheidung, an der die
 * Bedienbarkeit ohne JavaScript hängt.
 *
 * Ein echtes `<form method="post">` mit einem echten `<button type="submit">`.
 * Kein fetch, kein Klick-Handler, kein Auswahlfeld mit „Speichern": Die
 * Backstube arbeitet an einem Tresengerät, und ein Statuswechsel darf nicht
 * daran hängen, ob ein Skript geladen wurde. Die Seite trägt weiterhin
 * KEIN <script>.
 *
 * WARUM NICHT EIN FORMULAR MIT MEHREREN SCHALTFLÄCHEN: Ein `<button
 * name="status" value="…">` täte dasselbe mit weniger Markup — und verlöre
 * den Wert in genau dem Fall, in dem ein Formular per Tastatur mit Enter aus
 * einem Feld heraus abgeschickt wird. Zwei Formulare sind ein paar Zeilen
 * mehr und haben keinen solchen Fall.
 *
 * ZWEI VERSTECKTE FELDER, MEHR NICHT: der Zielstatus und der CSRF-Token. Die
 * Bestellnummer steht in der ROUTE, weil sie die Bestellung benennt. Alles
 * Weitere — Rolle, Kunde, Preis, bisheriger Status — fehlt nicht aus
 * Sparsamkeit, sondern weil der Server es nicht liest: Was aus einem Formular
 * käme, wäre eine Behauptung des Aufrufers.
 *
 * DER ZUGÄNGLICHE NAME NENNT DIE BESTELLUNG. „Bestätigen" gibt es auf einer
 * Seite mit zwölf Karten zwölfmal; wer die Seite mit einer Tastatur oder
 * einem Screenreader durchgeht, braucht den Unterschied. Der sichtbare Text
 * steht dabei VORNE, damit „Klicke Bestätigen" in einer Sprachsteuerung
 * weiter funktioniert (WCAG 2.5.3).
 *
 * Er entsteht über einen Zusatz in der Schaltfläche und NICHT über
 * aria-label. Ein aria-label ersetzt den sichtbaren Text vollständig — und
 * damit auch dann, wenn jemand die Seite übersetzen lässt oder das Attribut
 * eines Tages nicht mitgepflegt wird. `.hinweis` ist dieselbe Klasse, mit der
 * die Backliste ihre Tabellenbeschriftung für Screenreader trägt; eine zweite
 * Utility mit denselben Regeln wäre eine Kopie ohne Gewinn.
 */
function statusAktion(
  order: ProductionOrderView,
  action: StatusActionView,
  csrfToken: string,
): string {
  if (action.destructive) {
    return `            <a class="statustaste statustaste--abbruch" href="/admin/orders/${escapeHtml(
      encodeURIComponent(order.orderNumber),
    )}/cancel">${escapeHtml(action.label)}<span class="hinweis"> — Bestellung ${escapeHtml(
      order.orderNumber,
    )}</span></a>`;
  }

  return `            <form class="statusaktion" method="post" action="/api/admin/orders/${escapeHtml(
    encodeURIComponent(order.orderNumber),
  )}/status">
              <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
              <input type="hidden" name="status" value="${escapeHtml(action.target)}">
              <button type="submit" class="statustaste">${escapeHtml(action.label)}<span class="hinweis"> — Bestellung ${escapeHtml(
                order.orderNumber,
              )}</span></button>
            </form>`;
}

/**
 * Eine Position: „3 × Beispiel Käsekuchen".
 *
 * Menge, Einheit und Name in EINEM Listenpunkt — aus demselben Grund, aus dem
 * sie in der Backliste in einer Zelle stehen: Getrennt gelesen zerfällt die
 * Aussage.
 *
 * Das Malzeichen ist ein echtes × (U+00D7) und kein kleines x. Ein
 * Screenreader liest es als „mal"; ein Buchstabe x wäre an dieser Stelle ein
 * Buchstabe.
 */
function position(item: ProductionOrderItemView): string {
  return `            <li>${item.quantity} ${escapeHtml(item.unit)} × ${escapeHtml(item.name)}</li>`;
}

/**
 * Die Notiz — Kundeneingabe, und damit der Wert, auf den es beim Escapen
 * ankommt.
 *
 * Sie kann Produktionsinformation enthalten („bitte ohne Zucker", „Lieferung
 * an die Rückseite") und steht deshalb sichtbar da und nicht in einem
 * aufklappbaren Element, das niemand öffnet.
 *
 * DIESE FUNKTION WIRD NUR AUFGERUFEN, WENN ES EINE NOTIZ GIBT. Ob es eine
 * gibt, entscheidet das Ansichtsmodell — dort ist auch festgelegt, dass ein
 * Leerzeichen keine ist. Ein leerer Notizblock mit Überschrift wäre
 * sichtbarer Platz für nichts.
 *
 * white-space wird über CSS gesetzt, nicht über <pre>: Die Notiz soll
 * umbrechen dürfen, ihre Zeilenumbrüche aber behalten.
 */
function notiz(text: string): string {
  return `
          <div class="bestellung__notiz">
            <p class="bestellung__notiz-titel">Hinweis</p>
            <p class="bestellung__notiz-text">${escapeHtml(text)}</p>
          </div>`;
}

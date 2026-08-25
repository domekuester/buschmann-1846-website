import { escapeHtml } from './format';
import type { ProductionDayView, ProductionLineView } from './production-day-view';

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
 */
export function renderProductionSummary(view: ProductionDayView): string {
  if (view.isEmpty) {
    return renderEmptyState();
  }

  return `
      <section class="produktion" aria-labelledby="titel-produktion">
        <h2 id="titel-produktion">Produktion</h2>
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
        <h2 id="titel-produktion">Produktion</h2>
        <p class="leer">Für diesen Tag sind keine offenen Bestellungen vorhanden.</p>
      </section>`;
}

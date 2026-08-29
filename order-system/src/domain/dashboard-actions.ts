import type { DashboardDay } from './dashboard-day';

/**
 * HANDLUNGSBEDARF — die Frage vor allen Kennzahlen:
 *
 *   „Was muss ich für diesen Produktionstag noch tun?"
 *
 * DIES IST KEIN BENACHRICHTIGUNGSSYSTEM, und es soll nie eines werden. Es
 * gibt keine Tabelle, keinen Zustand „gelesen", kein „weggeklickt", keinen
 * Hintergrundlauf, keine Zustellung. Eine Aktion ENTSTEHT aus den Daten des
 * Tages und VERSCHWINDET, sobald die Arbeit getan ist — ohne dass jemand sie
 * quittiert. Ein gespeicherter Hinweis wäre eine zweite Wahrheit neben den
 * Bestellungen und könnte ihnen widersprechen; dieser hier kann das nicht.
 *
 * ES WIRD NICHT GEZÄHLT UND NICHT GEFILTERT. Jede der drei Zahlen steht
 * FERTIG in DashboardDay — `statusCounts.new`, `openCount`, `unpaidCount` und
 * `unpaidCents`. Diese Datei setzt sie ausschließlich in eine Reihenfolge und
 * lässt weg, was null ist.
 *
 * Das ist der Kern der Entscheidung: Zählte sie selbst über `day.orders`, gäbe
 * es eine ZWEITE Fassung des Stornofilters und eine zweite Fassung der
 * Produktionsregel — und die Fassung im Handlungsbedarf wäre diejenige, die
 * eines Tages eine stornierte Bestellung zum Backen anmeldet. So kann der
 * Handlungsbedarf den Kennzahlen darüber gar nicht widersprechen: Er zeigt
 * dieselben Zahlen.
 *
 * DESHALB KOSTET ER AUCH KEINE ABFRAGE. Er bekommt den bereits geladenen Tag
 * und liest daraus; es gibt keinen Weg, über diese Datei ein N+1 zu erzeugen.
 *
 * KEINE DRINGLICHKEITSSTUFEN. Kein P0, kein „kritisch", kein rotes Feld. Drei
 * Kategorien in fester Reihenfolge, und wenn nichts offen ist, steht nichts
 * da. Ein Betrieb, der jeden Morgen dieselbe Alarmfarbe sieht, sieht sie nach
 * einer Woche nicht mehr.
 */

/**
 * Die drei Kategorien — und es gibt keine vierte.
 *
 * Was hier NICHT steht, ist ebenso eine Entscheidung: keine Kunden ohne
 * Preisgruppe, keine unverknüpften Produkte, keine Systemmeldungen, keine
 * Hinweise über ANDERE Tage. Jede davon ist eine echte Frage — aber keine,
 * die zum Tagesgeschäft EINES Produktionstags gehört, und dieser Bereich
 * beantwortet ausschließlich die.
 */
export type DashboardActionKey = 'new_orders' | 'open_production' | 'unpaid';

export interface DashboardAction {
  readonly key: DashboardActionKey;
  readonly count: number;
  /**
   * Der offene Betrag in Cent — und `null`, wo es keinen gibt.
   *
   * Nur die Zahlung trägt einen Betrag. Bei „neu" und „offene Produktion"
   * eine 0 zu liefern wäre die Einladung, sie irgendwann anzuzeigen: „3 neue
   * Bestellungen · 0,00 €" wäre falsch, ohne falsch gerechnet zu sein. `null`
   * heißt „es gibt hier keinen Betrag" und nicht „der Betrag ist null".
   */
  readonly amountCents: number | null;
}

/**
 * DIE REIHENFOLGE IST DIE DES ARBEITSTAGS und keine Rangfolge nach Dringlichkeit:
 *
 *   1. NEU            was hereingekommen ist und noch niemand angesehen hat.
 *   2. PRODUKTION     was noch zu tun ist.
 *   3. ZAHLUNG        was danach noch aussteht.
 *
 * Sie ist FEST und sortiert sich nicht nach Anzahl um: Ein Bereich, dessen
 * Zeilen je nach Tag die Plätze tauschen, muss jeden Morgen neu gelesen
 * werden — dieselbe Begründung wie beim Statusring.
 *
 * DIE ERSTEN BEIDEN ÜBERSCHNEIDEN SICH, und das ist beabsichtigt: Eine neue
 * Bestellung ist auch offene Produktion. Es sind zwei verschiedene Fragen —
 * „was ist hereingekommen?" und „wie viel ist insgesamt noch zu tun?" — und
 * die Texte sagen beides so, dass sich die Zahlen nicht widersprechen: „3 neue
 * Bestellungen" und „4 Bestellungen noch nicht abgeschlossen" sind zusammen
 * wahr. Zwei disjunkte Kategorien („1 sonstige offene") wären dagegen eine
 * Zahl, die auf der Seite sonst nirgends vorkommt.
 */
export function dashboardActions(day: DashboardDay): readonly DashboardAction[] {
  const kandidaten: readonly DashboardAction[] = [
    { key: 'new_orders', count: day.statusCounts.new, amountCents: null },
    { key: 'open_production', count: day.openCount, amountCents: null },
    { key: 'unpaid', count: day.unpaidCount, amountCents: day.unpaidCents },
  ];

  /**
   * WAS NULL IST, STEHT NICHT DA. Drei Zeilen mit einer 0 wären ein Bereich,
   * der jeden Tag gleich aussieht und deshalb keinen Blick mehr bekommt — und
   * „0 neue Bestellungen" ist auch keine Handlung. Der ruhige Zustand ist die
   * LEERE Liste; wie er aussieht, entscheidet die Oberfläche.
   */
  return kandidaten.filter((aktion) => aktion.count > 0);
}

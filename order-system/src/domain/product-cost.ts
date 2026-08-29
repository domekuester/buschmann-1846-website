import { InvalidArgumentError } from './errors';
import { Money } from './money';

/**
 * Herstellkosten — der interne Schätzwert je Verkaufseinheit.
 *
 * ES IST EINE SCHÄTZUNG, UND DER NAME SAGT DAS. Nicht „Einkaufspreis" (den
 * kennt dieses System nicht), nicht „Wareneinsatz" (der käme aus einer
 * Rezeptur), nicht „COGS" (das ist Buchhaltung). Ein Betreiber trägt hier
 * ein, was ihn ein Stück ungefähr kostet, und diese Datei tut nichts, was
 * mehr behaupten würde.
 *
 * WAS HIER NICHT STEHT: keine Rezeptur, keine Zutaten, kein Rohstofflager,
 * keine Lieferanten, keine Einkaufsbestellungen, keine Kostenhistorie und
 * keine Marge. Marge und Rohertrag sind eine Auswertung; sie brauchen diese
 * Datei als Grundlage und gehören nicht in sie.
 */

/**
 * 10.000,00 € je Verkaufseinheit.
 *
 * Die Grenze ist nicht technisch — Money trägt weit mehr —, sondern
 * fachlich: Eine einzelne Verkaufseinheit einer Bäckerei, die in der
 * Herstellung mehr als zehntausend Euro kostet, ist ein Tippfehler und keine
 * Torte. Die Grenze weist ihn ab, statt ihn zu speichern und später in einer
 * Auswertung zu erklären.
 */
export const MAX_UNIT_COST_CENTS = 1_000_000;

/**
 * Das Ergebnis einer Kosteneingabe — DREI Zustände und keine nullbare Zahl.
 *
 * `null` allein könnte hier zweierlei heißen: „das Feld war leer, also keine
 * Kosten pflegen" und „die Eingabe war Unsinn". Das erste ist eine gültige
 * Entscheidung des Betreibers und muss gespeichert werden, das zweite eine
 * Ablehnung. Wer beides auf denselben Wert abbildet, löscht bei einem
 * Tippfehler still einen gepflegten Kostenwert.
 */
export type ParsedUnitCost =
  /** Das Feld war leer: „keine Herstellkosten hinterlegt" — die Spalte wird NULL. */
  | { readonly kind: 'cleared' }
  /** Ein lesbarer Betrag in ganzzahligen Cent. 0 ist ausdrücklich erlaubt. */
  | { readonly kind: 'amount'; readonly cents: number }
  /** Unlesbar, negativ oder unplausibel groß. Es wird NICHTS geschrieben. */
  | { readonly kind: 'invalid' };

/**
 * Genau eine erlaubte Schreibweise: bis zu fünf Vorkommastellen, wahlweise
 * ein Komma ODER ein Punkt und danach ein oder zwei Nachkommastellen.
 *
 * WAS ABSICHTLICH NICHT PASST:
 *
 *   '2,105'     drei Nachkommastellen. Sie werden NICHT auf 2,11 gerundet —
 *               eine stille Rundung ist eine Zahl, die niemand eingegeben
 *               hat (§7).
 *   '1.234,56'  Tausenderpunkt UND Dezimalkomma. Der Punkt ist in dieser
 *               Eingabe ein Dezimaltrennzeichen; beide Bedeutungen zugleich
 *               zuzulassen hieße, '1.234' raten zu müssen.
 *   '-2,10'     negative Herstellkosten gibt es nicht.
 *   '2,10 €'    das Eurozeichen steht im Formular neben dem Feld, nicht darin.
 *   '2e2'       sieht nur zufällig wie eine Zahl aus.
 */
const BETRAG = /^([0-9]{1,5})(?:[.,]([0-9]{1,2}))?$/;

/**
 * Liest eine Kosteneingabe aus einem Formular.
 *
 * DIE UMGEBENDEN LEERZEICHEN WERDEN ENTFERNT — und das ist die einzige
 * Normalisierung dieser Funktion. Sie ist begründet und keine Bequemlichkeit:
 * Anders als der Vorlauf (`<input type="number">`) und der Bestellschluss
 * (`<input type="time">`), die der Browser selbst normalisiert, ist dies ein
 * freies Textfeld — ein deutsches Dezimalkomma bekommt man in einem
 * Zahlenfeld nicht zuverlässig eingetippt. ' 2,10 ' aus einer Zwischenablage
 * hat genau eine Lesart; es abzuweisen wäre Strenge ohne Schutzwirkung.
 * Alles Übrige bleibt strikt: Es wird nichts aufgefüllt, nichts umgedeutet
 * und nichts gerundet.
 *
 * DIE NACHKOMMASTELLEN WERDEN AUFGEFÜLLT UND NICHT GERUNDET: '2,1' ist
 * zweifelsfrei 2,10 € und damit 210 Cent. Das ist keine Rundung — es geht
 * keine eingegebene Stelle verloren.
 *
 * ES ENTSTEHT NIRGENDS EINE FLIESSKOMMAZAHL. Vor- und Nachkommateil werden
 * getrennt als ganze Zahlen gelesen und ganzzahlig zusammengesetzt; ein
 * `Number('2.10') * 100` wäre 210.00000000000003 in Wartestellung.
 */
export function parseUnitCost(input: string): ParsedUnitCost {
  const wert = input.trim();
  if (wert === '') {
    return { kind: 'cleared' };
  }

  const treffer = BETRAG.exec(wert);
  if (treffer === null) {
    return { kind: 'invalid' };
  }

  const euro = Number(treffer[1]);
  const nachkomma = treffer[2] ?? '';
  const cent = nachkomma === '' ? 0 : Number(nachkomma.padEnd(2, '0'));

  const gesamt = euro * 100 + cent;
  if (gesamt > MAX_UNIT_COST_CENTS) {
    return { kind: 'invalid' };
  }
  return { kind: 'amount', cents: gesamt };
}

/**
 * Ein gespeicherter Kostenwert als Money — oder null.
 *
 * Die Prüfung wiederholt, was die CHECK-Bedingung aus 0017 bereits garantiert,
 * und zwar aus demselben Grund wie in customer-price-book-repository.ts: Ein
 * CHECK schützt gegen künftige Schreibvorgänge, nicht gegen Daten, die an der
 * Anwendung vorbei eingespielt wurden. Ein kaputter Kostenwert soll laut
 * scheitern und nicht leise in einer Bestellung landen.
 */
export function unitCostFromCents(cents: number | null): Money | null {
  if (cents === null) {
    return null;
  }
  if (!Number.isInteger(cents) || cents < 0) {
    throw new InvalidArgumentError('Der gespeicherte Herstellkostenwert ist ungültig.');
  }
  return Money.fromCents(cents);
}

/**
 * Die Herstellkosten, mit denen für EINE Bestellung gerechnet werden darf.
 *
 * WARUM EIN EIGENES OBJEKT UND NICHT EIN FELD IM CustomerPriceBook: weil das
 * Preisbuch die Bestellseite eines Cafés bepreist. Läge der Kostenwert darin,
 * hätte die kundenseitige Ansicht ihn in der Hand, und die einzige Sicherung
 * gegen seine Anzeige wäre Sorgfalt beim Rendern. So bekommt die Bestellseite
 * dieses Objekt gar nicht erst — sie kann nichts preisgeben, was sie nicht
 * hat (§11).
 *
 * Der Schlüssel ist products.id, NICHT catalog_products.id — dieselbe
 * Entscheidung und derselbe Grund wie beim Preisbuch: Bestellungen, Entwürfe
 * und order_items sprechen ausschließlich in products.id, und eine
 * Übersetzung zwischen beiden Welten wäre eine zweite Stelle, an der sich
 * Kosten und Preis auf verschiedene Artikel beziehen könnten.
 *
 * EIN FEHLENDER EINTRAG IST null UND NICHT 0 €. Das ist §14 in einer Zeile.
 */
export class ProductCostBook {
  private constructor(private readonly costs: ReadonlyMap<number, Money>) {}

  /** Kein einziger gepflegter Kostenwert — der Zustand direkt nach 0017. */
  static empty(): ProductCostBook {
    return new ProductCostBook(new Map());
  }

  /**
   * Die Map wird KOPIERT — dieselbe Überlegung wie bei
   * CustomerPriceBook.forPriceList(): Ein Kostenbuch, dessen Werte sich nach
   * dem Bauen noch ändern lassen, wäre keine Momentaufnahme, und genau eine
   * Momentaufnahme wird gleich in die Bestellung geschrieben.
   */
  static fromCosts(costs: ReadonlyMap<number, Money>): ProductCostBook {
    return new ProductCostBook(new Map(costs));
  }

  /** Die Herstellkosten EINES bestellbaren Produkts — oder null. */
  costFor(productId: number): Money | null {
    return this.costs.get(productId) ?? null;
  }
}

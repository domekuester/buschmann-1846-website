import { OrderItem } from './order-item';

/**
 * Was ein Admin an den Mengen einer Bestellung ändern will — und was davon
 * eine Änderung IST.
 *
 * DIESE DATEI KENNT WEDER HTTP NOCH D1. Sie bekommt den Stand der Positionen
 * und die Wünsche aus einem Formular und sagt, was daraus folgt. Sie schreibt
 * nichts, sie fragt nichts nach und sie entscheidet nicht, ob jemand darf —
 * dieselbe Trennung wie in der übrigen Domäne.
 *
 * WARUM ÜBERHAUPT EINE PLANUNG, WO EIN UPDATE JE ZEILE GENÜGT HÄTTE.
 *
 * Weil ein Formular IMMER alle Mengen mitschickt, auch die unveränderten. Ein
 * Aufrufer, der jede empfangene Zeile schreibt, erzeugte für jede
 * unangetastete Position eine Spur in order_item_changes — und in diesem
 * Rauschen wäre die eine echte Änderung nicht mehr zu finden. Was hier
 * herauskommt, ist deshalb nicht „die Wünsche", sondern die DIFFERENZ.
 *
 * ALLES ODER NICHTS. Eine ungültige Zeile verwirft den ganzen Plan und nicht
 * nur sich selbst. Der Grund ist der Admin vor dem Bildschirm: Ein Formular,
 * von dem drei Zeilen gespeichert werden und die vierte nicht, hinterlässt
 * eine Bestellung in einem Zustand, den niemand angefordert hat — und eine
 * Fehlermeldung, die von einer Änderung erzählt, die teilweise schon
 * geschehen ist.
 */

/**
 * Der Stand EINER Position, soweit die Mengenregel ihn braucht.
 *
 * Bewusst kein OrderItem: Jenes kennt keine Datenbank-ID und keine
 * Stornierung, und es soll beides auch nicht kennen — es ist die Position
 * eines Bestelldokuments und nicht deren Zeile in einer Tabelle. Was hier
 * fehlt, ist ebenso Absicht: kein Preis, kein Name, keine Einheit, keine
 * Kosten. Eine Mengenregel, die einen Preis sehen kann, ist eine Preisregel,
 * die darauf wartet, eine zu werden.
 */
export interface EditableItemState {
  readonly id: number;
  readonly quantity: number;
  readonly cancelled: boolean;
}

/** Eine Position, deren Menge sich tatsächlich ändert. */
export interface PlannedQuantityChange {
  readonly id: number;
  readonly previousQuantity: number;
  readonly newQuantity: number;
}

/** Was ein Formular für eine Position mitbringt — die Menge noch ungeprüft. */
export interface RequestedQuantity {
  readonly id: number;
  readonly quantity: unknown;
}

/**
 * Das Ergebnis der Planung.
 *
 * Ein diskriminierter Verbund und keine Ausnahme — dieselbe Bauart wie
 * ChangeOrderStatusResult: Alle drei Ablehnungen sind normale Betriebsfälle
 * (ein vertippter Wert, ein veralteter Bildschirm) und gehören dorthin, wo
 * der Aufrufer sie nicht übersehen kann.
 *
 * `planned` mit einer LEEREN Liste ist ein gültiges Ergebnis und kein Fehler:
 * Wer das Formular unverändert abschickt, hat nichts falsch gemacht.
 */
export type QuantityEditPlan =
  | { readonly outcome: 'planned'; readonly changes: readonly PlannedQuantityChange[] }
  /** Diese Menge ist keine gültige Menge. */
  | { readonly outcome: 'invalid_quantity'; readonly id: number }
  /** Diese Position gehört nicht zu dieser Bestellung. */
  | { readonly outcome: 'unknown_item'; readonly id: number }
  /** Diese Position ist bereits storniert; sie hat keine Menge mehr. */
  | { readonly outcome: 'cancelled_item'; readonly id: number }
  /**
   * Dieselbe Position kommt zweimal vor.
   *
   * Aus einem Formular kann das nicht entstehen; die HTTP-Schicht bildet ihre
   * Wünsche aus den Positionen der Bestellung. Käme es trotzdem, entstünden
   * zwei Schreibanweisungen für dieselbe Zeile — die zweite fände die alte
   * Menge nicht mehr, und der Vorgang wäre halb geschrieben, obwohl er als
   * Konflikt gemeldet würde. Die Ablehnung ist billiger als der Sonderfall.
   */
  | { readonly outcome: 'duplicate_item'; readonly id: number };

/**
 * Eine Menge aus einem Formular — oder null.
 *
 * ES WIRD NICHTS GERETTET. Kein parseInt, das aus '3 Stück' eine 3 macht,
 * kein Number(), das '' zu 0 werden lässt, keine Komma-Umdeutung und kein
 * Aufrunden. Der Wert ist eine ganze Zahl in Ziffern oder er ist keine Menge
 * — dieselbe Haltung wie bei isOrderStatus() und isPaymentStatus(): Aus einer
 * beliebigen Zeichenkette hier eine Menge zu machen hieße, die Menge der
 * gültigen Eingaben an der Außengrenze zu erweitern.
 *
 * Das strenge Muster schließt außerdem die Schreibweisen aus, die Number()
 * klaglos annähme und die niemand in ein Mengenfeld tippt: '1e3', '0x3',
 * ' 3 ', 'Infinity'.
 *
 * DIE OBERGRENZE IST OrderItem.MAX_QUANTITY und keine zweite Zahl. Was beim
 * Bestellen unplausibel ist, ist es beim Ändern auch; zwei Grenzen wären zwei
 * Meinungen darüber, was ein Café bestellen kann.
 */
function parseQuantity(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) {
    return null;
  }

  const menge = Number(raw);
  if (!Number.isInteger(menge) || menge < 1 || menge > OrderItem.MAX_QUANTITY) {
    return null;
  }

  return menge;
}

export function planQuantityChanges(
  items: readonly EditableItemState[],
  requested: readonly RequestedQuantity[],
): QuantityEditPlan {
  const stand = new Map(items.map((item) => [item.id, item]));
  const gesehen = new Set<number>();
  const changes: PlannedQuantityChange[] = [];

  for (const wunsch of requested) {
    if (gesehen.has(wunsch.id)) {
      return { outcome: 'duplicate_item', id: wunsch.id };
    }
    gesehen.add(wunsch.id);

    const position = stand.get(wunsch.id);
    if (position === undefined) {
      return { outcome: 'unknown_item', id: wunsch.id };
    }
    if (position.cancelled) {
      return { outcome: 'cancelled_item', id: wunsch.id };
    }

    const menge = parseQuantity(wunsch.quantity);
    if (menge === null) {
      return { outcome: 'invalid_quantity', id: wunsch.id };
    }

    // Die Differenz und nicht der Wunsch: Was gleich bleibt, ist keine
    // Änderung und bekommt keine Spur.
    if (menge !== position.quantity) {
      changes.push({ id: position.id, previousQuantity: position.quantity, newQuantity: menge });
    }
  }

  return { outcome: 'planned', changes };
}

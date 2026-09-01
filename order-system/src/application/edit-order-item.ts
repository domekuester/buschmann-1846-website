import { toUtcTimestamp } from '../domain/clock';
import type { EditableOrder } from '../domain/admin-order-edit';
import type { OrderNumber } from '../domain/order-number';
import { canEditOrderItems } from '../domain/order-status';
import {
  planQuantityChanges,
  type EditableItemState,
  type PlannedQuantityChange,
  type RequestedQuantity,
} from '../domain/order-item-edit';
import { findEditableOrder } from '../infrastructure/d1/admin-order-edit-repository';
import { prepareCancelOrderWhenNoActiveItems } from '../infrastructure/d1/order-repository';

/**
 * „Setze die Mengen dieser Bestellung" und „storniere diese Position".
 *
 * Die beiden schreibenden Vorgänge der Positionsbearbeitung.
 *
 * DIESE DATEI ENTSCHEIDET NICHT, OB SIE AUFGERUFEN WERDEN DARF. Rolle,
 * Sitzung, Origin und CSRF-Token stehen in der HTTP-Schicht und ausschließlich
 * dort — dieselbe Trennung wie bei changeOrderStatus und placeCafeOrder. Die
 * Actor-ID ist keine Behauptung aus dem Request, sondern ein Wert aus dem dort
 * bereits geprüften Admin-AuthContext.
 *
 * ES GIBT KEINE ZWEITE MENGENREGEL UND KEINE ZWEITE STATUSREGEL. Was eine
 * gültige Menge ist, entscheidet planQuantityChanges() in der Domäne; ob eine
 * Bestellung bearbeitet werden darf, canEditOrderItems(). In dieser Datei
 * steht kein `if (status === 'confirmed')` und kein `quantity > 0`.
 *
 *
 * ALLES ODER NICHTS — UND WIE DAS OHNE TRANSAKTION GEHT.
 *
 * D1 kennt keine offene Transaktion, in der man lesen, entscheiden und
 * schreiben könnte. Es kennt db.batch(): eine Folge vorbereiteter Anweisungen
 * in einer impliziten Transaktion. Was es NICHT kennt, ist der bedingte
 * Abbruch — eine Anweisung, die keine Zeile trifft, ist kein Fehler und lässt
 * die folgenden trotzdem laufen. Genau daraus entstünde der halb geschriebene
 * Vorgang: eine Spur zu einer Änderung, die nicht stattgefunden hat, oder ein
 * Gesamtbetrag zu Positionen, die noch die alten sind.
 *
 * DIE LÖSUNG IST EINE EINZIGE BEDINGUNG, DIE IN JEDER ANWEISUNG STEHT:
 * `orders.updated_at = <der Stand, den die Seite gezeigt hat>`.
 *
 * Sie trägt, weil JEDER Schreibvorgang an einer Bestellung diesen Zeitstempel
 * fortschreibt — der Statuswechsel seit Phase 4A, der Zahlungseintrag seit
 * 5B und diese Datei. Ist er unverändert, hat sich seit dem Lesen an dieser
 * Bestellung nichts geändert, und ALLE Anweisungen treffen. Ist er es nicht,
 * trifft KEINE — auch die Spur nicht und auch der Gesamtbetrag nicht. Es gibt
 * keinen Zwischenzustand, weil es keine Anweisung ohne diese Bedingung gibt.
 *
 * Die Anweisung, die den Gesamtbetrag setzt, steht deshalb ZULETZT: Sie ist
 * es, die updated_at fortschreibt, und dürfte das erst tun, wenn die
 * Anweisungen davor ihre Bedingung geprüft haben.
 *
 * Das ist optimistische Nebenläufigkeit im selben Geist wie das `AND status =
 * ?` in updateOrderStatus() — kein Lock, kein Durable Object, keine
 * Warteschlange, keine Versionsspalte.
 *
 *
 * DER PREIS WIRD NICHT ANGEFASST.
 *
 * Der neue Positionsbetrag entsteht in SQL als `unit_price_cents * ?` — aus
 * dem Preis DERSELBEN ZEILE. Es gibt in dieser Datei keine Abfrage auf
 * products, keine auf catalog_products und keinen Parameter, über den ein
 * Preis hereinkäme. Eine Bestellung von letzter Woche kann damit nicht zu
 * heutigen Preisen neu bewertet werden, und ein Aufrufer kann keinen Preis
 * unterschieben. Dieselbe Regel wie in 0004, nur eine Schreiboperation
 * später.
 */

/** Der Ausgang beider Vorgänge, soweit er gemeinsam ist. */
interface Geschrieben {
  readonly outcome: 'saved';
  /** Der Gesamtbetrag NACH der Änderung — aus der Datenbank zurückgelesen. */
  readonly newTotalCents: number;
  /** Ob die letzte aktive Position verschwunden und die Bestellung storniert ist. */
  readonly orderCancelled: boolean;
  readonly fulfillmentDate: string;
}

export type ChangeOrderItemQuantitiesResult =
  | Geschrieben
  /** Das Formular fordert nichts, was nicht schon so ist. Kein Fehler. */
  | { readonly outcome: 'unchanged'; readonly fulfillmentDate: string }
  | { readonly outcome: 'unknown_order' }
  /** Diese Bestellung ist nicht (mehr) bearbeitbar — die Domäne sagt das. */
  | { readonly outcome: 'not_editable'; readonly fulfillmentDate: string }
  | { readonly outcome: 'unknown_item'; readonly fulfillmentDate: string }
  | { readonly outcome: 'cancelled_item'; readonly fulfillmentDate: string }
  /** Dieselbe Position kam zweimal — aus einem Formular unmöglich, siehe Domäne. */
  | { readonly outcome: 'duplicate_item'; readonly fulfillmentDate: string }
  | { readonly outcome: 'invalid_quantity'; readonly fulfillmentDate: string }
  /** Jemand anderes war schneller; der gelesene Stand gilt nicht mehr. */
  | { readonly outcome: 'conflict'; readonly fulfillmentDate: string };

export type CancelOrderItemResult =
  | Geschrieben
  /** Diese Position war bereits storniert. Ein zweiter Klick ist folgenlos. */
  | { readonly outcome: 'already_cancelled'; readonly fulfillmentDate: string }
  | { readonly outcome: 'unknown_order' }
  | { readonly outcome: 'not_editable'; readonly fulfillmentDate: string }
  | { readonly outcome: 'unknown_item'; readonly fulfillmentDate: string }
  | { readonly outcome: 'conflict'; readonly fulfillmentDate: string };

interface EditCommand {
  /** Eine bereits GEPRÜFTE Bestellnummer, kein String. */
  readonly orderNumber: OrderNumber;
  /**
   * Der Stand, den die bearbeitete Seite gezeigt hat — orders.updated_at.
   *
   * Er kommt aus einem versteckten Feld des Formulars und ist damit ein Wert
   * aus der Anfrage. Das ist ungefährlich: Er kann nur PRÜFEN, nie
   * BESTIMMEN. Ein geratener Wert trifft keine Zeile, und ein richtiger
   * bestätigt nur, was ohnehin gilt.
   */
  readonly expectedVersion: string;
  readonly now: Date;
  /** Konto-ID aus dem bereits geprüften Admin-AuthContext. */
  readonly actorAccountId: number;
}

export interface ChangeOrderItemQuantitiesCommand extends EditCommand {
  readonly requested: readonly RequestedQuantity[];
}

export interface CancelOrderItemCommand extends EditCommand {
  readonly orderItemId: number;
}

export async function changeOrderItemQuantities(
  db: D1Database,
  command: ChangeOrderItemQuantitiesCommand,
): Promise<ChangeOrderItemQuantitiesResult> {
  const { orderNumber, requested, expectedVersion, now, actorAccountId } = command;

  const order = await findEditableOrder(db, orderNumber.value);
  if (order === null) {
    return { outcome: 'unknown_order' };
  }

  const tag = order.fulfillmentDate;
  if (!canEditOrderItems(order.status)) {
    return { outcome: 'not_editable', fulfillmentDate: tag };
  }

  const plan = planQuantityChanges(order.items.map(zuStand), requested);
  if (plan.outcome !== 'planned') {
    return { outcome: plan.outcome, fulfillmentDate: tag };
  }

  /**
   * Ein Formular, das unverändert abgeschickt wurde, ist kein Fehler und
   * bekommt keinen Schreibvorgang: kein Batch, keine Spur, kein neuer
   * updated_at. Wer nichts geändert hat, soll die Bestellung auch nicht als
   * „zuletzt bearbeitet" markiert haben.
   */
  if (plan.changes.length === 0) {
    return { outcome: 'unchanged', fulfillmentDate: tag };
  }

  const zeitpunkt = toUtcTimestamp(now);
  const anweisungen = plan.changes.flatMap((change) => [
    spurFuerMenge(db, order, change, zeitpunkt, actorAccountId, expectedVersion),
    neueMenge(db, order, change, expectedVersion),
  ]);
  anweisungen.push(neuerGesamtbetrag(db, order, zeitpunkt, expectedVersion));

  const ergebnisse = await db.batch(anweisungen);

  /**
   * KEINE ERFOLGSMELDUNG OHNE GESCHRIEBENE ZEILE — dieselbe Regel wie in
   * changeOrderStatus. Geprüft wird die MENGENANWEISUNG jeder Position (jedes
   * zweite Element); trifft eine davon keine Zeile, war der Stand veraltet,
   * und dann hat aus demselben Grund auch keine andere Anweisung getroffen.
   */
  const alleGeschrieben = plan.changes.every(
    (_, index) => ergebnisse[index * 2 + 1]?.meta.changes === 1,
  );
  if (!alleGeschrieben) {
    return { outcome: 'conflict', fulfillmentDate: tag };
  }

  const danach = await standNachher(db, order.id);
  return {
    outcome: 'saved',
    newTotalCents: danach.totalCents,
    orderCancelled: danach.cancelled,
    fulfillmentDate: tag,
  };
}

export async function cancelOrderItem(
  db: D1Database,
  command: CancelOrderItemCommand,
): Promise<CancelOrderItemResult> {
  const { orderNumber, orderItemId, expectedVersion, now, actorAccountId } = command;

  const order = await findEditableOrder(db, orderNumber.value);
  if (order === null) {
    return { outcome: 'unknown_order' };
  }

  const tag = order.fulfillmentDate;
  if (!canEditOrderItems(order.status)) {
    return { outcome: 'not_editable', fulfillmentDate: tag };
  }

  const position = order.items.find((item) => item.id === orderItemId);
  if (position === undefined) {
    return { outcome: 'unknown_item', fulfillmentDate: tag };
  }

  /**
   * WIEDERHOLTES STORNIEREN IST FOLGENLOS UND KEIN FEHLER. Ein zweiter Klick,
   * ein Zurück im Browser, zwei offene Fenster — der Betrieb soll dafür keine
   * Fehlermeldung sehen. Vor allem entsteht keine zweite Spur: Storniert
   * wurde einmal, und der Zeitpunkt dieser einen Stornierung bleibt stehen.
   */
  if (position.cancelledAt !== null) {
    return { outcome: 'already_cancelled', fulfillmentDate: tag };
  }

  const zeitpunkt = toUtcTimestamp(now);
  const anweisungen = [
    spurFuerStorno(db, order, position.id, zeitpunkt, actorAccountId, expectedVersion),
    stornierePosition(db, order, position.id, zeitpunkt, expectedVersion),
    neuerGesamtbetrag(db, order, zeitpunkt, expectedVersion),
    /**
     * DIE BESTELLUNG FOLGT IHRER LETZTEN POSITION — im selben Batch.
     *
     * Die Anweisung steht IMMER im Batch und entscheidet SELBST, ob sie
     * greift: Ihr `NOT EXISTS` sieht den Stand NACH der Stornierung darüber.
     * Hier vorher zu zählen und die Anweisung nur manchmal anzuhängen wäre
     * eine zweite, frühere Antwort auf dieselbe Frage — und die frühere wäre
     * die, die sich irren kann.
     *
     * Sie ist derselbe Statusweg wie jeder andere: dieselben vier Spalten,
     * dieselben Auditfelder, dieselbe optimistische Bedingung auf den
     * Ausgangsstatus. Es gibt keinen zweiten Stornierungsmechanismus.
     */
    prepareCancelOrderWhenNoActiveItems(db, {
      orderNumber: order.orderNumber,
      orderId: order.id,
      expectedStatus: order.status,
      updatedAt: zeitpunkt,
      actorAccountId,
      statusChangedAt: zeitpunkt,
    }),
  ];

  const ergebnisse = await db.batch(anweisungen);
  if (ergebnisse[1]?.meta.changes !== 1) {
    return { outcome: 'conflict', fulfillmentDate: tag };
  }

  const danach = await standNachher(db, order.id);
  return {
    outcome: 'saved',
    newTotalCents: danach.totalCents,
    orderCancelled: danach.cancelled,
    fulfillmentDate: tag,
  };
}

function zuStand(item: EditableOrder['items'][number]): EditableItemState {
  return { id: item.id, quantity: item.quantity, cancelled: item.cancelledAt !== null };
}

/**
 * Die Spur einer Mengenänderung.
 *
 * SIE LIEST IHRE VORHERIGE MENGE AUS DER ZEILE UND NICHT AUS DEM SPEICHER.
 * `INSERT ... SELECT i.quantity ...` heißt: Was als „vorher" festgehalten
 * wird, ist der Wert, der in diesem Augenblick tatsächlich in der Datenbank
 * steht — nicht der, den der Aufrufer vorhin gelesen hat. Beide sind hier
 * gleich, weil die Bedingungen das erzwingen; würde die Spur ihren Wert
 * mitbringen, wäre sie die eine Zahl, die eine Abweichung nicht bemerken
 * könnte.
 *
 * Sie steht VOR der Mengenanweisung, weil sie den alten Wert braucht.
 */
function spurFuerMenge(
  db: D1Database,
  order: EditableOrder,
  change: PlannedQuantityChange,
  zeitpunkt: string,
  actorAccountId: number,
  expectedVersion: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                       new_quantity, changed_at, changed_by_account_id)
            SELECT i.order_id, i.id, 'quantity_changed', i.quantity, ?, ?, ?
              FROM order_items i
              JOIN orders o ON o.id = i.order_id
             WHERE i.id = ?
               AND i.order_id = ?
               AND i.cancelled_at IS NULL
               AND i.quantity = ?
               AND o.updated_at = ?`,
    )
    .bind(
      change.newQuantity,
      zeitpunkt,
      actorAccountId,
      change.id,
      order.id,
      change.previousQuantity,
      expectedVersion,
    );
}

/**
 * Die neue Menge — und der neue Positionsbetrag aus dem PREIS DERSELBEN ZEILE.
 *
 * `line_total_cents = unit_price_cents * ?` ist die ganze Preisregel dieser
 * Datei: Der Stückpreis wird gelesen, nicht gesetzt, und er kommt aus der
 * Position, die geändert wird. Ein Aufrufer kann keinen Preis übergeben, weil
 * es dafür keinen Platzhalter gibt. Die CHECK-Bedingung aus 0004 rechnet
 * dieselbe Multiplikation ein zweites Mal nach.
 */
function neueMenge(
  db: D1Database,
  order: EditableOrder,
  change: PlannedQuantityChange,
  expectedVersion: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE order_items
          SET quantity = ?,
              line_total_cents = unit_price_cents * ?
        WHERE id = ?
          AND order_id = ?
          AND cancelled_at IS NULL
          AND quantity = ?
          AND EXISTS (SELECT 1 FROM orders o
                       WHERE o.id = order_items.order_id
                         AND o.updated_at = ?)`,
    )
    .bind(
      change.newQuantity,
      change.newQuantity,
      change.id,
      order.id,
      change.previousQuantity,
      expectedVersion,
    );
}

/** Die Spur einer Stornierung — ohne neue Menge, weil es danach keine gibt. */
function spurFuerStorno(
  db: D1Database,
  order: EditableOrder,
  orderItemId: number,
  zeitpunkt: string,
  actorAccountId: number,
  expectedVersion: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                       new_quantity, changed_at, changed_by_account_id)
            SELECT i.order_id, i.id, 'item_cancelled', i.quantity, NULL, ?, ?
              FROM order_items i
              JOIN orders o ON o.id = i.order_id
             WHERE i.id = ?
               AND i.order_id = ?
               AND i.cancelled_at IS NULL
               AND o.updated_at = ?`,
    )
    .bind(zeitpunkt, actorAccountId, orderItemId, order.id, expectedVersion);
}

/**
 * Die Stornierung selbst — EIN UPDATE UND KEIN DELETE.
 *
 * Menge, Stückpreis, Positionsbetrag, Name, Einheit und Kostenschnappschuss
 * bleiben unangetastet stehen. Was sich ändert, ist eine Spalte: ob diese
 * Position noch gilt. Eine gelöschte Zeile könnte nicht mehr beantworten, was
 * das Café ursprünglich bestellt hatte.
 */
function stornierePosition(
  db: D1Database,
  order: EditableOrder,
  orderItemId: number,
  zeitpunkt: string,
  expectedVersion: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE order_items
          SET cancelled_at = ?
        WHERE id = ?
          AND order_id = ?
          AND cancelled_at IS NULL
          AND EXISTS (SELECT 1 FROM orders o
                       WHERE o.id = order_items.order_id
                         AND o.updated_at = ?)`,
    )
    .bind(zeitpunkt, orderItemId, order.id, expectedVersion);
}

/**
 * Der neue Gesamtbetrag — IN SQL AUS DEN POSITIONEN GERECHNET.
 *
 * Der Betrag wird nicht in TypeScript summiert und übergeben, und das ist die
 * Entscheidung dieser Funktion. Eine hier gerechnete Zahl wäre eine zweite
 * Fassung dessen, was die Anweisungen davor tatsächlich geschrieben haben —
 * und die beiden könnten auseinandergehen, ohne dass es jemandem auffiele:
 * Der gespeicherte Gesamtbetrag ist die Zahl, der alle anderen Ansichten
 * glauben.
 *
 * So ist sie definitionsgemäß die Summe der aktiven Positionen, ganz gleich,
 * was die Anweisungen davor bewirkt haben. Die Prüfung in toOrder() —
 * gespeicherter Betrag gegen Summe der Positionen — kann damit nicht mehr
 * anschlagen.
 *
 * SIE STEHT ZULETZT IM BATCH. Sie ist die Anweisung, die updated_at
 * fortschreibt; täte sie das früher, prüften die Anweisungen danach gegen
 * einen Stand, den sie selbst gerade erzeugt hat.
 */
function neuerGesamtbetrag(
  db: D1Database,
  order: EditableOrder,
  zeitpunkt: string,
  expectedVersion: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE orders
          SET total_amount_cents = (SELECT COALESCE(SUM(line_total_cents), 0)
                                      FROM order_items
                                     WHERE order_id = orders.id
                                       AND cancelled_at IS NULL),
              updated_at = ?
        WHERE id = ?
          AND updated_at = ?`,
    )
    .bind(zeitpunkt, order.id, expectedVersion);
}

/**
 * Was nach dem Batch tatsächlich in der Zeile steht.
 *
 * EINE ZUSÄTZLICHE ABFRAGE, UND SIE IST DIE EHRLICHERE ANTWORT. Betrag und
 * Storno-Zustand ließen sich hier ausrechnen; die Rechnung wäre aber eine
 * Behauptung über das, was der Batch getan hat, und die Oberfläche zeigt
 * genau diese Zahl an („Neuer Gesamtbetrag: 66,00 €"). Sie soll aus der
 * Datenbank kommen und nicht aus einer Erwartung.
 *
 * Sie läuft NUR auf dem Erfolgsweg — jede Ablehnung kehrt vorher um.
 */
async function standNachher(
  db: D1Database,
  orderId: number,
): Promise<{ totalCents: number; cancelled: boolean }> {
  const row = await db
    .prepare('SELECT total_amount_cents, status FROM orders WHERE id = ?')
    .bind(orderId)
    .first<{ total_amount_cents: number; status: string }>();

  return {
    totalCents: row?.total_amount_cents ?? 0,
    cancelled: row?.status === 'cancelled',
  };
}

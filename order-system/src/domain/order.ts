import { toUtcTimestamp } from './clock';
import type { Customer } from './customer';
import { DomainError, InvalidArgumentError, ValidationError } from './errors';
import { requiresAddress, type FulfillmentType } from './fulfillment-type';
import { Money } from './money';
import type { FulfillmentDate } from './fulfillment-date';
import { OrderItem } from './order-item';
import type { OrderDraft } from './order-draft';
import type { OrderNumber } from './order-number';
import type { CustomerPriceBook } from './order-pricing';
import type { ProductCostBook } from './product-cost';
import { canTransitionTo, orderStatusLabel, type OrderStatus } from './order-status';
import type { ProductCatalog } from './product-catalog';
import { optionalText } from './text';

/**
 * Die Signatur von place() IST das Sicherheitsmodell: Kunde, Produktkatalog
 * und Preiswelt kommen aus der Datenbank, der Entwurf aus der Anfrage — und
 * der Entwurf enthält nur Produkt-IDs und Mengen. Der Preis kann deshalb
 * nicht aus der Anfrage stammen, weil es dort nichts gibt, aus dem er stammen
 * könnte.
 *
 * SEIT PHASE 5C IST DIE PREISWELT EIN EIGENER PARAMETER — und zwar ein
 * PFLICHTPARAMETER. Optional wäre er der bequemere Weg gewesen und zugleich
 * die Lücke: Ein Aufrufer, der ihn vergisst, hätte eine Bestellung ohne
 * Preisprüfung erzeugt. So bekommt er einen Typfehler.
 *
 * Der ProductCatalog beantwortet weiterhin „gibt es dieses Produkt, und ist
 * es bestellbar?", das CustomerPriceBook „was kostet es DIESEN Kunden?".
 * Zwei Fragen, zwei Objekte — die Vermischung beider wäre der Anfang einer
 * zweiten Preislogik.
 */
export interface PlaceOrderInput {
  customer: Customer;
  catalog: ProductCatalog;
  priceBook: CustomerPriceBook;
  /**
   * Die internen Herstellkosten — SEIT PHASE 7A UND EBENFALLS PFLICHT.
   *
   * Dieselbe Überlegung wie beim Preisbuch: Optional wäre der bequemere Weg
   * und zugleich die Lücke — ein Aufrufer, der ihn vergisst, schriebe
   * lautlos Bestellungen ohne Kostenschnappschuss, und niemand könnte
   * später unterscheiden, ob die Kosten damals fehlten oder ob nur der
   * Parameter fehlte. Ein leeres Kostenbuch ist ein GÜLTIGER Zustand und
   * muss ausdrücklich übergeben werden (ProductCostBook.empty()).
   *
   * Es ist ein eigenes Objekt und kein Feld des Preisbuchs, damit die
   * kundenseitige Bestellseite es gar nicht erst in die Hand bekommt (§11).
   */
  costBook: ProductCostBook;
  draft: OrderDraft;
  orderNumber: OrderNumber;
  now: Date;
}

/**
 * Der Kostenstand einer Bestellung — vollständig, teilweise oder gar nicht
 * bekannt.
 *
 * `complete` ist der wichtigste Wert und steht nicht zufällig neben den
 * beiden Zählern: Eine Bestellung ohne Positionen kann es nicht geben (der
 * Konstruktor lehnt sie ab), also heißt `itemsWithCost === itemCount`
 * tatsächlich „für jede Position ist bekannt, was sie gekostet hat".
 */
export interface OrderCostSummary {
  readonly itemCount: number;
  readonly itemsWithCost: number;
  readonly complete: boolean;
  /** Die Kosten der Positionen, für die ein Snapshot vorliegt. NICHT „die Kosten". */
  readonly knownCost: Money;
}

export interface OrderState {
  orderNumber: OrderNumber;
  customerId: number;
  customerNameSnapshot: string;
  fulfillmentType: FulfillmentType;
  fulfillmentDate: FulfillmentDate;
  deliveryAddressSnapshot: string | null;
  note: string | null;
  status: OrderStatus;
  items: readonly OrderItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Eine Bestellung.
 *
 * Sie ist unveränderlich. Statusänderungen liefern eine neue Instanz. Das
 * schützt die Snapshots vor versehentlicher Bearbeitung.
 *
 * Zeitstempel sind Zeichenketten in ISO-8601-UTC, nicht Date-Objekte: Genau
 * dieser Wert geht nach D1 und kommt von dort zurück. Ein Date-Objekt hier
 * wäre eine zweite Darstellung derselben Sache und damit eine Stelle, an der
 * sich beide unterscheiden könnten.
 */
export class Order {
  readonly orderNumber: OrderNumber;
  readonly customerId: number;
  readonly customerNameSnapshot: string;
  readonly fulfillmentType: FulfillmentType;
  readonly fulfillmentDate: FulfillmentDate;
  readonly deliveryAddressSnapshot: string | null;
  readonly note: string | null;
  readonly status: OrderStatus;
  readonly items: readonly OrderItem[];
  readonly createdAt: string;
  readonly updatedAt: string;

  private constructor(state: OrderState) {
    if (state.items.length === 0) {
      throw new InvalidArgumentError('Eine Bestellung braucht mindestens eine Position.');
    }
    if (!Number.isInteger(state.customerId) || state.customerId <= 0) {
      throw new InvalidArgumentError('Die Kunden-ID der Bestellung ist ungültig.');
    }
    if (state.customerNameSnapshot.trim() === '') {
      throw new InvalidArgumentError('Der Kundenname der Bestellung fehlt.');
    }
    if (
      requiresAddress(state.fulfillmentType) &&
      (state.deliveryAddressSnapshot === null || state.deliveryAddressSnapshot.trim() === '')
    ) {
      throw new InvalidArgumentError('Eine Lieferung braucht eine Lieferadresse.');
    }

    this.orderNumber = state.orderNumber;
    this.customerId = state.customerId;
    this.customerNameSnapshot = state.customerNameSnapshot;
    this.fulfillmentType = state.fulfillmentType;
    this.fulfillmentDate = state.fulfillmentDate;
    this.deliveryAddressSnapshot = state.deliveryAddressSnapshot;
    this.note = optionalText(state.note, 500, 'Die Notiz');
    this.status = state.status;
    this.items = state.items;
    this.createdAt = state.createdAt;
    this.updatedAt = state.updatedAt;
  }

  static place(input: PlaceOrderInput): Order {
    const { customer, catalog, priceBook, costBook, draft, orderNumber, now } = input;
    const errors: Record<string, string> = {};

    if (!customer.isActive) {
      errors['customer'] = 'Für diesen Kunden können derzeit keine Bestellungen angelegt werden.';
    }

    let addressSnapshot: string | null = null;
    if (requiresAddress(draft.fulfillmentType)) {
      if (customer.deliveryAddress === null) {
        errors['fulfillment_type'] = 'Für diesen Kunden ist keine Lieferadresse hinterlegt.';
      } else {
        addressSnapshot = customer.deliveryAddress.toSingleLine();
      }
    }

    const items: OrderItem[] = [];

    /**
     * ZUERST DIE FRAGE AN DEN KUNDEN, DANN DIE AN DIE PRODUKTE.
     *
     * Ob der Kunde überhaupt eine gültige Preiswelt hat, gilt für jede
     * Position gleich. Würde man es je Position prüfen, bekäme ein nicht
     * zugeordneter Kunde zwölf Meldungen „dieses Produkt ist nicht bepreist"
     * — zwölfmal am falschen Ort, und die eigentliche Ursache stünde
     * nirgends.
     */
    if (!priceBook.isResolvable()) {
      errors['price_list'] = priceListMessage();
    } else {
      draft.items.forEach((draftItem, index) => {
        const field = `items.${index}.product_id`;
        const product = catalog.find(draftItem.productId);

        if (product === null) {
          errors[field] = 'Dieses Produkt gibt es nicht.';
          return;
        }
        if (!product.isActive) {
          errors[field] = 'Dieses Produkt ist derzeit nicht bestellbar.';
          return;
        }

        /**
         * Der Preis kommt aus der Preiswelt des Kunden — der einzige Ort, an
         * dem er stehen darf. `price` ist ein discriminated union; nur der
         * Zweig `fixed` trägt überhaupt einen Betrag.
         */
        const price = priceBook.priceFor(product.id);

        if (price.kind === 'product_not_priced') {
          errors[field] = 'Für dieses Produkt ist derzeit kein Preis hinterlegt.';
          return;
        }
        if (price.kind === 'price_not_fixed') {
          errors[field] =
            'Für dieses Produkt ist keine direkte Online-Preisberechnung möglich. ' +
            'Bitte wende dich für dieses Produkt an Buschmann 1846.';
          return;
        }
        if (price.kind !== 'fixed') {
          // Kunde ohne bzw. mit stillgelegter Preisgruppe. Oben bereits
          // abgefangen; der Zweig hält den Union vollständig, damit ein
          // künftiger fünfter Zustand hier einen Typfehler auslöst und nicht
          // stillschweigend zu einer Position wird.
          errors['price_list'] = priceListMessage();
          return;
        }

        /**
         * DIE HERSTELLKOSTEN WERDEN NACHGESCHLAGEN, NICHT GEPRÜFT.
         *
         * Es gibt hier bewusst keinen Fehlerzweig: Fehlende Kosten sind kein
         * Bestellhindernis. Ein Café abzuweisen, weil im Backoffice eine
         * interne Zahl nicht gepflegt ist, wäre ein Betriebsausfall aus
         * Buchhaltungsgründen — und die Zahl geht das Café ohnehin nichts an.
         */
        items.push(
          OrderItem.forProduct(
            product,
            price.unitPrice,
            draftItem.quantity,
            costBook.costFor(product.id),
          ),
        );
      });
    }

    if (items.length === 0 && Object.keys(errors).length === 0) {
      errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError(errors);
    }

    const timestamp = toUtcTimestamp(now);
    return new Order({
      orderNumber,
      customerId: customer.id,
      customerNameSnapshot: customer.name,
      fulfillmentType: draft.fulfillmentType,
      fulfillmentDate: draft.fulfillmentDate,
      deliveryAddressSnapshot: addressSnapshot,
      note: draft.note,
      status: 'new',
      items,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  /**
   * Rekonstruiert eine gespeicherte Bestellung.
   *
   * Getrennt von place(), weil Laden nicht Bestellen ist: Beim Laden gibt es
   * keinen Kunden und keinen Katalog zu prüfen, der Status ist nicht
   * zwingend „new", und der Liefertag darf längst vergangen sein. Würde man
   * beides über denselben Weg führen, wäre entweder das Bestellen zu lasch
   * oder keine historische Bestellung mehr aufrufbar.
   *
   * Die Invarianten des Aggregats gelten trotzdem — sie stecken im
   * Konstruktor und laufen für beide Wege.
   */
  static restore(state: OrderState): Order {
    return new Order(state);
  }

  /** Die Bestellsumme wird berechnet, nie entgegengenommen. */
  total(): Money {
    return this.items.reduce((sum, item) => sum.plus(item.lineTotal), Money.zero());
  }

  /**
   * Was über die Herstellkosten dieser Bestellung GESICHERT bekannt ist —
   * und ausdrücklich auch, was nicht.
   *
   * DAS IST §14 UND KEIN AUSWERTUNGSSYSTEM. Drei Zahlen aus den eigenen
   * Positionen, keine Aggregation über Bestellungen hinweg, keine Marge, kein
   * Rohertrag, keine Kennzahl. Phase 7B rechnet damit; 7A stellt nur sicher,
   * dass 7B die Frage „ist das vollständig?" überhaupt stellen KANN.
   *
   * WARUM ÜBERHAUPT: Eine Bestellung mit drei Positionen, von denen zwei
   * einen Kostenschnappschuss tragen, hat KEINE bekannten Gesamtkosten. Wer
   * die beiden bekannten Positionen aufsummiert und das Ergebnis
   * „Herstellkosten der Bestellung" nennt, veröffentlicht eine zu niedrige
   * Zahl und daraus eine zu hohe Marge. `complete` unterscheidet die beiden
   * Fälle, und `knownCost` trägt deshalb ausdrücklich das Wort „known" im
   * Namen.
   *
   * Der Positionskostenbetrag entsteht HIER und wird nirgends gespeichert —
   * siehe die Begründung gegen line_cost_cents in Migration 0017.
   */
  costSummary(): OrderCostSummary {
    let bekannt = 0;
    let summe = Money.zero();

    for (const item of this.items) {
      const kosten = item.unitCostSnapshot;
      if (kosten === null) {
        continue;
      }
      bekannt += 1;
      summe = summe.plus(kosten.multipliedBy(item.quantity));
    }

    return {
      itemCount: this.items.length,
      itemsWithCost: bekannt,
      complete: bekannt === this.items.length,
      knownCost: summe,
    };
  }

  withStatus(target: OrderStatus, now: Date): Order {
    if (!canTransitionTo(this.status, target)) {
      throw new DomainError(
        `Eine Bestellung im Status „${orderStatusLabel(this.status)}" kann nicht auf ` +
          `„${orderStatusLabel(target)}" gesetzt werden.`,
      );
    }
    return new Order({ ...this.state(), status: target, updatedAt: toUtcTimestamp(now) });
  }

  private state(): OrderState {
    return {
      orderNumber: this.orderNumber,
      customerId: this.customerId,
      customerNameSnapshot: this.customerNameSnapshot,
      fulfillmentType: this.fulfillmentType,
      fulfillmentDate: this.fulfillmentDate,
      deliveryAddressSnapshot: this.deliveryAddressSnapshot,
      note: this.note,
      status: this.status,
      items: this.items,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Die Meldung für einen Kunden, dessen Preiswelt nicht auflösbar ist.
 *
 * Sie unterscheidet NICHT zwischen „keine Preisgruppe" und „Preisgruppe
 * stillgelegt", und das ist Absicht: Für das Café ist beides derselbe
 * Vorgang mit derselben Lösung — jemand bei Buschmann muss etwas eintragen.
 * „Ihre Preisliste ist inaktiv" wäre eine Auskunft über eine interne
 * Verwaltungsentscheidung, mit der niemand am Tresen etwas anfangen kann.
 *
 * Sie nennt keine Preislisten-ID, keinen Preislistencode und keinen internen
 * Zustand.
 */
function priceListMessage(): string {
  return (
    'Für dein Kundenkonto ist noch keine Preisgruppe hinterlegt. ' +
    'Bitte wende dich an Buschmann 1846.'
  );
}

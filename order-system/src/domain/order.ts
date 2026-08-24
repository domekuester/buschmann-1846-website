import { toUtcTimestamp } from './clock';
import type { Customer } from './customer';
import { DomainError, InvalidArgumentError, ValidationError } from './errors';
import { requiresAddress, type FulfillmentType } from './fulfillment-type';
import { Money } from './money';
import type { FulfillmentDate } from './fulfillment-date';
import { OrderItem } from './order-item';
import type { OrderDraft } from './order-draft';
import type { OrderNumber } from './order-number';
import { canTransitionTo, orderStatusLabel, type OrderStatus } from './order-status';
import type { ProductCatalog } from './product-catalog';
import { optionalText } from './text';

/**
 * Die Signatur von place() IST das Sicherheitsmodell: Kunde und Produktkatalog
 * kommen aus der Datenbank, der Entwurf aus der Anfrage — und der Entwurf
 * enthält nur Produkt-IDs und Mengen. Der Preis kann deshalb nicht aus der
 * Anfrage stammen, weil es dort nichts gibt, aus dem er stammen könnte.
 */
export interface PlaceOrderInput {
  customer: Customer;
  catalog: ProductCatalog;
  draft: OrderDraft;
  orderNumber: OrderNumber;
  now: Date;
}

interface OrderState {
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
    const { customer, catalog, draft, orderNumber, now } = input;
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
    draft.items.forEach((draftItem, index) => {
      const product = catalog.find(draftItem.productId);

      if (product === null) {
        errors[`items.${index}.product_id`] = 'Dieses Produkt gibt es nicht.';
        return;
      }
      if (!product.isActive) {
        errors[`items.${index}.product_id`] = 'Dieses Produkt ist derzeit nicht bestellbar.';
        return;
      }

      // Der Preis kommt aus dem Produkt — der einzige Ort, an dem er stehen darf.
      items.push(OrderItem.forProduct(product, draftItem.quantity));
    });

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

  /** Die Bestellsumme wird berechnet, nie entgegengenommen. */
  total(): Money {
    return this.items.reduce((sum, item) => sum.plus(item.lineTotal), Money.zero());
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

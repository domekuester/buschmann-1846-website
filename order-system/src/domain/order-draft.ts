import { ValidationError } from './errors';
import { FulfillmentDate } from './fulfillment-date';
import { isFulfillmentType, type FulfillmentType } from './fulfillment-type';
import { OrderItem } from './order-item';
import { charLength } from './text';

/** Was aus der Anfrage übrig bleibt: eine Produkt-ID und eine Menge. */
export interface DraftItem {
  readonly productId: number;
  readonly quantity: number;
}

/**
 * Der geprüfte Inhalt einer Bestellanfrage.
 *
 * DIESE KLASSE HAT KEIN PREISFELD — und das ist ihr eigentlicher Zweck. Ein
 * mitgesendeter Betrag wird nicht „geprüft und verworfen", er wird gar nicht
 * erst gelesen. Aus der Anfrage kommen ausschließlich fulfillment_type,
 * fulfillment_date, note sowie items mit je product_id und quantity. Alles
 * Weitere fällt weg, egal wie es heißt.
 *
 * Es werden immer ALLE Fehler gesammelt statt beim ersten abzubrechen: Ein
 * Café soll nicht fünfmal absenden müssen, um fünf Hinweise zu bekommen.
 *
 * Menge 0 ist KEIN Fehler, sondern „nicht bestellt". Die Bestellseite sendet
 * jedes Produkt mit; die meisten stehen auf 0. Eine negative oder nicht
 * ganzzahlige Menge ist dagegen sehr wohl ein Fehler.
 */
export class OrderDraft {
  static readonly MAX_ITEMS = 200;

  private constructor(
    readonly fulfillmentType: FulfillmentType,
    readonly fulfillmentDate: FulfillmentDate,
    readonly note: string | null,
    readonly items: readonly DraftItem[],
  ) {}

  static fromInput(input: unknown, now: Date): OrderDraft {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw ValidationError.field('request', 'Die Bestellung konnte nicht gelesen werden.');
    }
    const raw = input as Record<string, unknown>;
    const errors: Record<string, string> = {};

    let type: FulfillmentType | null = null;
    if (isFulfillmentType(raw['fulfillment_type'])) {
      type = raw['fulfillment_type'];
    } else {
      errors['fulfillment_type'] = 'Bitte Lieferung oder Abholung auswählen.';
    }

    let date: FulfillmentDate | null = null;
    const rawDate = raw['fulfillment_date'];
    if (typeof rawDate !== 'string') {
      errors['fulfillment_date'] = 'Bitte einen Liefer- oder Abholtag angeben.';
    } else {
      try {
        date = FulfillmentDate.fromString(rawDate, now);
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        Object.assign(errors, e.errors);
      }
    }

    const note = OrderDraft.readNote(raw['note'], errors);
    const items = OrderDraft.readItems(raw['items'], errors);

    if (Object.keys(errors).length > 0 || type === null || date === null) {
      throw new ValidationError(errors);
    }

    return new OrderDraft(type, date, note, items);
  }

  private static readNote(raw: unknown, errors: Record<string, string>): string | null {
    if (raw === null || raw === undefined) {
      return null;
    }
    if (typeof raw !== 'string') {
      errors['note'] = 'Die Notiz ist ungültig.';
      return null;
    }
    const note = raw.trim();
    if (charLength(note) > 500) {
      errors['note'] = 'Die Notiz ist zu lang (höchstens 500 Zeichen).';
      return null;
    }
    return note === '' ? null : note;
  }

  private static readItems(raw: unknown, errors: Record<string, string>): DraftItem[] {
    if (!Array.isArray(raw)) {
      errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
      return [];
    }
    if (raw.length > OrderDraft.MAX_ITEMS) {
      errors['items'] = 'Die Bestellung enthält zu viele Positionen.';
      return [];
    }

    const items: DraftItem[] = [];
    const seen = new Set<number>();
    let hadItemErrors = false;

    raw.forEach((rawItem: unknown, index: number) => {
      const prefix = `items.${index}.`;

      if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
        errors[`${prefix}product_id`] = 'Die Position ist ungültig.';
        hadItemErrors = true;
        return;
      }
      const item = rawItem as Record<string, unknown>;

      const productId = OrderDraft.readInt(item['product_id']);
      const duplicate = productId !== null && productId > 0 && seen.has(productId);
      if (productId === null || productId <= 0) {
        errors[`${prefix}product_id`] = 'Das Produkt ist ungültig.';
        hadItemErrors = true;
      } else if (duplicate) {
        errors[`${prefix}product_id`] = 'Dieses Produkt kommt mehrfach vor.';
        hadItemErrors = true;
      }

      const quantity = OrderDraft.readInt(item['quantity']);
      if (quantity === null || quantity < 0) {
        errors[`${prefix}quantity`] = 'Die Menge muss eine ganze Zahl ab 0 sein.';
        hadItemErrors = true;
      } else if (quantity > OrderItem.MAX_QUANTITY) {
        errors[`${prefix}quantity`] = 'Die Menge ist unplausibel hoch.';
        hadItemErrors = true;
      }

      if (productId === null || productId <= 0 || quantity === null || quantity < 0 || duplicate) {
        return;
      }

      seen.add(productId);

      // Menge 0 heißt „nicht bestellt" und fällt hier weg.
      if (quantity > 0) {
        items.push({ productId, quantity });
      }
    });

    // Der allgemeine Hinweis nur, wenn nicht ohnehin schon Positionsfehler
    // gemeldet werden — sonst bekäme das Café zwei Meldungen für dasselbe.
    if (items.length === 0 && !hadItemErrors && errors['items'] === undefined) {
      errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
    }

    return items;
  }

  /**
   * Akzeptiert Ganzzahlen und reine Ziffernstrings — Formularwerte kommen als
   * String an. Ausdrücklich NICHT über Number(): `Number('')` ist 0,
   * `Number(true)` ist 1 und `Number([])` ist 0. Genau solche stillen
   * Umwandlungen sollen hier scheitern.
   */
  private static readInt(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? value : null;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value);
    }
    return null;
  }
}

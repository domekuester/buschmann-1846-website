import { InvalidArgumentError } from './errors';
import { optionalText, requireText } from './text';

/** Die Werte, aus denen ein Produkt entsteht — benannt statt positional. */
export interface ProductData {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Ein bestellbares Produkt. Stammdatum: Es wird geladen, existiert also
 * bereits und hat eine ID.
 *
 * Produkte werden nie gelöscht, sondern über isActive deaktiviert — sonst
 * verlören historische Bestellungen ihren Fremdschlüssel. Varianten,
 * Kategorien, SKU und Bilder sind ausdrücklich nicht Teil des Modells.
 *
 * Der Konstruktor nimmt ein benanntes Objekt statt sechs Stellungsparameter:
 * Bei `new Product(1, 'A', null, 'Stück', true, 10)` vertauscht man
 * irgendwann isActive und sortOrder, und beide sind zuweisbar.
 *
 * SEIT PHASE 5C TRÄGT EIN PRODUKT KEINEN PREIS MEHR.
 *
 * Das ist die wichtigste Zeile dieser Datei, und sie besteht darin, dass
 * etwas FEHLT. Bis 5B stand hier ein `unitPrice`, gefüllt aus
 * products.price_cents — ein einziger Preis für alle Kunden. Ein Preis gilt
 * aber nicht für ein Produkt, sondern für ein Produkt IN EINER PREISWELT:
 * Dasselbe Blech kostet einen Gastronomiebetrieb etwas anderes als einen
 * Privatkunden.
 *
 * Der Preis lebt deshalb in CustomerPriceBook (siehe order-pricing.ts) und
 * wird über products.catalog_product_id aufgelöst. Dass das Feld hier nicht
 * mehr existiert, ist der Grund, warum ein Rückfall auf den alten Preis nicht
 * bloß verboten, sondern nicht formulierbar ist: Es gibt in diesem Objekt
 * nichts, worauf man zurückfallen könnte.
 */
export class Product {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly unit: string;
  readonly isActive: boolean;
  readonly sortOrder: number;

  constructor(data: ProductData) {
    if (!Number.isInteger(data.id) || data.id <= 0) {
      throw new InvalidArgumentError('Die Produkt-ID ist ungültig.');
    }
    if (!Number.isInteger(data.sortOrder) || data.sortOrder < 0) {
      throw new InvalidArgumentError('Die Sortierreihenfolge ist ungültig.');
    }

    this.id = data.id;
    this.name = requireText(data.name, 120, 'Der Produktname');
    this.unit = requireText(data.unit, 120, 'Die Einheit');
    this.description = optionalText(data.description, 500, 'Die Beschreibung');
    this.isActive = data.isActive;
    this.sortOrder = data.sortOrder;
  }
}

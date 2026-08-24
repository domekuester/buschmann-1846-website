import { InvalidArgumentError } from './errors';
import type { Money } from './money';
import { optionalText, requireText } from './text';

/** Die Werte, aus denen ein Produkt entsteht — benannt statt positional. */
export interface ProductData {
  id: number;
  name: string;
  description: string | null;
  unitPrice: Money;
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
 * Der Konstruktor nimmt ein benanntes Objekt statt sieben Stellungsparameter:
 * Bei `new Product(1, 'A', null, price, 'Stück', true, 10)` vertauscht man
 * irgendwann isActive und sortOrder, und beide sind zuweisbar.
 */
export class Product {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly unitPrice: Money;
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
    this.unit = requireText(data.unit, 20, 'Die Einheit');
    this.description = optionalText(data.description, 500, 'Die Beschreibung');
    this.unitPrice = data.unitPrice;
    this.isActive = data.isActive;
    this.sortOrder = data.sortOrder;
  }
}

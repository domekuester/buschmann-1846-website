import { InvalidArgumentError } from './errors';
import { Money } from './money';
import type { Product } from './product';
import { requireText } from './text';

/**
 * Die Werte einer Position. Beachtenswert ist, was FEHLT: kein lineTotal,
 * kein Gesamtbetrag, kein Preisfeld, das von außen gesetzt werden könnte.
 */
export interface OrderItemData {
  productId: number;
  productNameSnapshot: string;
  productUnitSnapshot: string;
  unitPrice: Money;
  quantity: number;
}

/**
 * Eine Position einer Bestellung.
 *
 * Der Konstruktor nimmt den Positionsbetrag NICHT entgegen — er berechnet ihn.
 * Es gibt damit im gesamten Code keinen Weg, einen abweichenden Betrag zu
 * setzen; auch nicht versehentlich, auch nicht durch einen späteren
 * Entwickler. Das ist der Unterschied zwischen einer Regel, die man einhalten
 * soll, und einer, die man nicht brechen kann.
 *
 * Name, Einheit und Preis sind Snapshots zum Bestellzeitpunkt. Ändert sich das
 * Produkt später, bleibt diese Position unverändert — eine Bestellung ist ein
 * Dokument, keine Sicht auf den aktuellen Stammdatenbestand.
 *
 * Die Menge ist ganzzahlig: Ein Café bestellt drei Bleche oder zwölf Stück,
 * keine 2,4 Stück. Wird nach Gewicht bestellt, ist das ein eigenes Produkt mit
 * der Einheit „kg".
 */
export class OrderItem {
  static readonly MAX_QUANTITY = 9_999;

  readonly productId: number;
  readonly productNameSnapshot: string;
  readonly productUnitSnapshot: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly lineTotal: Money;

  constructor(data: OrderItemData) {
    if (!Number.isInteger(data.productId) || data.productId <= 0) {
      throw new InvalidArgumentError('Die Produkt-ID der Position ist ungültig.');
    }
    if (!Number.isInteger(data.quantity) || data.quantity < 1) {
      throw new InvalidArgumentError('Die Menge muss eine ganze Zahl größer als 0 sein.');
    }
    if (data.quantity > OrderItem.MAX_QUANTITY) {
      throw new InvalidArgumentError('Die Menge ist unplausibel hoch.');
    }

    this.productId = data.productId;
    this.productNameSnapshot = requireText(data.productNameSnapshot, 120, 'Der Produktname der Position');
    this.productUnitSnapshot = requireText(data.productUnitSnapshot, 20, 'Die Einheit der Position');
    this.unitPrice = data.unitPrice;
    this.quantity = data.quantity;

    // Die einzige Stelle, an der ein Positionsbetrag entsteht.
    this.lineTotal = data.unitPrice.multipliedBy(data.quantity);
  }

  /**
   * Der einzige Weg, der in einer Bestellung tatsächlich benutzt wird.
   *
   * DER PREIS IST EIN EIGENER PARAMETER, KEINE EIGENSCHAFT DES PRODUKTS.
   *
   * Bis Phase 5B stand hier `product.unitPrice` — und das war genau so lange
   * richtig, wie es einen Preis je Produkt gab. Seit 5C gibt es einen Preis
   * je Produkt UND Preiswelt, und die Preiswelt kennt nur der Kunde. Diese
   * Signatur zwingt den Aufrufer deshalb, den aufgelösten Preis mitzubringen;
   * sie kann ihn nicht selbst besorgen, weil ihr dazu der Kunde fehlt.
   *
   * Der Preis MUSS aus CustomerPriceBook.priceFor() stammen. Dass er hier als
   * Money hereinkommt und nicht als Zahl, ist der Rest der Absicherung: Eine
   * Zahl aus einem Anfragekörper ist kein Money, und Money entsteht nur über
   * Money.fromCents mit seinen Grenzen.
   */
  static forProduct(product: Product, unitPrice: Money, quantity: number): OrderItem {
    return new OrderItem({
      productId: product.id,
      productNameSnapshot: product.name,
      productUnitSnapshot: product.unit,
      unitPrice,
      quantity,
    });
  }
}

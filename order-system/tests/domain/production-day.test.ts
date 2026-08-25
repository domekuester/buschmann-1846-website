import { describe, expect, it } from 'vitest';
import {
  aggregateProductionDay,
  type ProductionOrder,
  type ProductionOrderItem,
} from '../../src/domain/production-day';

/**
 * Die Rechenregeln eines Produktionstags — ohne Datenbank, ohne HTTP, ohne
 * Uhr.
 *
 * Dass diese Datei im Vitest-Projekt „domain" läuft, ist nicht nur schneller:
 * Es ist der Beweis, dass die Aggregation von Infrastruktur unabhängig ist.
 * Hinge sie an D1, liefe hier gar nichts.
 *
 * Die Testdaten sind fiktiv. „Testcafé Nord" und „Beispiel Käsekuchen" gibt
 * es nicht; echte Kundendaten haben in einer Testdatei nichts verloren.
 */

const TAG = '2026-08-26';

function position(
  productId: number,
  name: string,
  quantity: number,
  options: { unit?: string; sortOrder?: number } = {},
): ProductionOrderItem {
  return {
    productId,
    productName: name,
    productUnit: options.unit ?? 'Stück',
    sortOrder: options.sortOrder ?? productId * 10,
    quantity,
  };
}

function bestellung(
  orderNumber: string,
  customerName: string,
  items: readonly ProductionOrderItem[],
  options: { status?: ProductionOrder['status']; note?: string | null } = {},
): ProductionOrder {
  return {
    orderNumber,
    customerName,
    status: options.status ?? 'confirmed',
    fulfillmentType: 'delivery',
    note: options.note ?? null,
    items,
  };
}

describe('aggregateProductionDay — eine Bestellung', () => {
  it('reicht den angefragten Tag unverändert durch', () => {
    expect(aggregateProductionDay(TAG, []).date).toBe(TAG);
    expect(aggregateProductionDay('2019-01-01', []).date).toBe('2019-01-01');
  });

  it('bildet eine einzelne Bestellung vollständig ab', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [position(1, 'Beispiel Käsekuchen', 3)], {
        note: 'Bitte vor 10 Uhr',
      }),
    ]);

    expect(tag.orderCount).toBe(1);
    expect(tag.totalUnits).toBe(3);
    expect(tag.products).toEqual([
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 3 },
    ]);
    expect(tag.orders).toHaveLength(1);
    expect(tag.orders[0]?.orderNumber).toBe('BUS-2026-000123');
    expect(tag.orders[0]?.customerName).toBe('Testcafé Nord');
    expect(tag.orders[0]?.note).toBe('Bitte vor 10 Uhr');
  });

  it('summiert mehrere Positionen einer Bestellung', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 3),
        position(2, 'Beispiel Carrot Cake', 2),
        position(3, 'Beispiel Schokoladentarte', 5),
      ]),
    ]);

    expect(tag.orderCount).toBe(1);
    expect(tag.totalUnits).toBe(10);
    expect(tag.products.map((p) => p.quantity)).toEqual([3, 2, 5]);
  });
});

describe('aggregateProductionDay — mehrere Bestellungen', () => {
  /** Das Beispiel aus der Spezifikation: 3 + 8 = 11 und 2 + 6 = 8. */
  it('summiert gleiche Produkte über Bestellungen hinweg', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 3),
        position(2, 'Beispiel Carrot Cake', 2),
      ]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [
        position(1, 'Beispiel Käsekuchen', 8),
        position(2, 'Beispiel Carrot Cake', 6),
      ]),
    ]);

    expect(tag.products).toEqual([
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 11 },
      { productId: 2, productName: 'Beispiel Carrot Cake', productUnit: 'Stück', quantity: 8 },
    ]);
  });

  it('hält verschiedene Produkte getrennt', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [position(1, 'Beispiel Käsekuchen', 3)]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [position(2, 'Beispiel Carrot Cake', 4)]),
    ]);

    expect(tag.products).toHaveLength(2);
    expect(tag.products.map((p) => p.productId)).toEqual([1, 2]);
  });

  it('lässt die Bestellliste in der übergebenen Reihenfolge', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [position(1, 'Beispiel Käsekuchen', 1)]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [position(1, 'Beispiel Käsekuchen', 1)]),
    ]);

    // Die Reihenfolge der Bestellungen kommt aus der Abfrage (ORDER BY) und
    // wird hier nicht noch einmal entschieden.
    expect(tag.orders.map((o) => o.orderNumber)).toEqual([
      'BUS-2026-000123',
      'BUS-2026-000124',
    ]);
  });
});

describe('aggregateProductionDay — orderCount und totalUnits', () => {
  /**
   * Der Unterschied, den eine Verwechslung teuer macht: orderCount zählt
   * BESTELLUNGEN. Drei Bestellungen mit je zwei Positionen sind drei, nicht
   * sechs.
   */
  it('zählt Bestellungen und nicht Positionen', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 1),
        position(2, 'Beispiel Carrot Cake', 1),
      ]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [
        position(1, 'Beispiel Käsekuchen', 1),
        position(2, 'Beispiel Carrot Cake', 1),
      ]),
      bestellung('BUS-2026-000125', 'Testcafé West', [
        position(1, 'Beispiel Käsekuchen', 1),
        position(2, 'Beispiel Carrot Cake', 1),
      ]),
    ]);

    expect(tag.orderCount).toBe(3);
  });

  /**
   * totalUnits ist eine MENGENSUMME, keine Zählung. 3 + 2 + 5 = 10 — nicht 3
   * (Produktarten) und nicht 1 (Bestellungen).
   */
  it('summiert Mengen und zählt nicht Produktarten', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 3),
        position(2, 'Beispiel Carrot Cake', 2),
        position(3, 'Beispiel Schokoladentarte', 5),
      ]),
    ]);

    expect(tag.totalUnits).toBe(10);
    expect(tag.totalUnits).not.toBe(3);
    expect(tag.totalUnits).not.toBe(1);
  });

  it('summiert Mengen über mehrere Bestellungen', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [position(1, 'Beispiel Käsekuchen', 12)]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [position(1, 'Beispiel Käsekuchen', 30)]),
    ]);

    expect(tag.totalUnits).toBe(42);
  });
});

describe('aggregateProductionDay — leerer Tag', () => {
  /**
   * Ein Tag ohne Bestellungen ist kein Fehler, sondern ein freier Tag. Er
   * braucht auch keinen eigenen Zweig im Code: Eine Summe über nichts ist 0.
   */
  it('liefert Nullen und leere Listen', () => {
    expect(aggregateProductionDay(TAG, [])).toEqual({
      date: TAG,
      orderCount: 0,
      totalUnits: 0,
      products: [],
      orders: [],
    });
  });

  it('zählt eine Bestellung ohne Positionen als Bestellung, aber nicht als Menge', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', []),
    ]);

    expect(tag.orderCount).toBe(1);
    expect(tag.totalUnits).toBe(0);
    expect(tag.products).toEqual([]);
  });
});

describe('aggregateProductionDay — Snapshot-Semantik', () => {
  /**
   * DIE REGEL, UM DIE ES HIER GEHT: Eine Bestellung ist ein Dokument.
   *
   * Wird „Beispiel Käsekuchen" später umbenannt, steht in der alten
   * Bestellung weiterhin der alte Name. Über product_id zu aggregieren und
   * irgendeinen der beiden Namen anzuzeigen, benennte eine historische
   * Bestellung stillschweigend um — genau das, was Snapshots verhindern
   * sollen.
   *
   * Der Preis: zwei Zeilen statt einer. Das ist die richtige Wahl —
   * Korrektheit vor kosmetischer Zusammenführung. Die product_id steht in
   * beiden, der Zusammenhang ist also sichtbar, ohne dass die Daten ihn
   * behaupten.
   */
  it('hält denselben product_id unter verschiedenen Snapshot-Namen getrennt', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [position(1, 'Käsekuchen', 3)]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [
        position(1, 'Klassischer Käsekuchen', 8),
      ]),
    ]);

    expect(tag.products).toHaveLength(2);
    expect(tag.products.every((p) => p.productId === 1)).toBe(true);

    /**
     * Die Reihenfolge entsteht aus dem Namen, weil beide Zeilen dieselbe
     * sortOrder haben — und der Vergleich läuft nach Codepunkten: 'Kl'
     * kommt vor 'Kä', weil 'l' (U+006C) kleiner ist als 'ä' (U+00E4). Nach
     * deutscher Sortierregel wäre es andersherum; genau diese Abweichung ist
     * der Preis dafür, nicht von den ICU-Daten der Laufzeit abzuhängen.
     * Fachlich sortiert ohnehin sortOrder.
     */
    expect(tag.products.map((p) => p.productName)).toEqual([
      'Klassischer Käsekuchen',
      'Käsekuchen',
    ]);
    expect(tag.products.map((p) => p.quantity)).toEqual([8, 3]);

    // Und die Gesamtmenge stimmt trotzdem.
    expect(tag.totalUnits).toBe(11);
  });

  /**
   * „8 Blech" und „8 Stück" sind verschiedene Arbeitstage. Eine Summe über
   * beide Einheiten wäre eine Zahl ohne Bedeutung.
   */
  it('hält denselben product_id unter verschiedenen Einheiten getrennt', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 3, { unit: 'Stück' }),
      ]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [
        position(1, 'Beispiel Käsekuchen', 2, { unit: 'Blech' }),
      ]),
    ]);

    expect(tag.products).toHaveLength(2);
    expect(tag.products.map((p) => p.productUnit).sort()).toEqual(['Blech', 'Stück']);
  });

  it('fasst nur zusammen, was in ID, Name und Einheit übereinstimmt', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 3, { unit: 'Stück' }),
      ]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [
        position(1, 'Beispiel Käsekuchen', 8, { unit: 'Stück' }),
      ]),
    ]);

    expect(tag.products).toEqual([
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 11 },
    ]);
  });
});

describe('aggregateProductionDay — Sortierung', () => {
  /**
   * Die Reihenfolge des Sortiments, wie Buschmann es ordnet — dieselbe wie
   * auf der Bestellseite. Nicht die zufällige Reihenfolge, in der die
   * Bestellungen hereinkamen.
   */
  it('sortiert nach sortOrder des Produkts', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(3, 'Beispiel Schokoladentarte', 1, { sortOrder: 30 }),
        position(1, 'Beispiel Käsekuchen', 1, { sortOrder: 10 }),
        position(2, 'Beispiel Carrot Cake', 1, { sortOrder: 20 }),
      ]),
    ]);

    expect(tag.products.map((p) => p.productId)).toEqual([1, 2, 3]);
  });

  it('bricht Gleichstand in sortOrder über den Namen', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(2, 'Zwetschgenkuchen', 1, { sortOrder: 10 }),
        position(1, 'Apfelkuchen', 1, { sortOrder: 10 }),
      ]),
    ]);

    expect(tag.products.map((p) => p.productName)).toEqual(['Apfelkuchen', 'Zwetschgenkuchen']);
  });

  it('bricht Gleichstand in sortOrder und Name über die ID', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(7, 'Gleicher Name', 1, { sortOrder: 10 }),
        position(4, 'Gleicher Name', 1, { sortOrder: 10 }),
      ]),
    ]);

    expect(tag.products.map((p) => p.productId)).toEqual([4, 7]);
  });

  it('bricht den letzten Gleichstand über die Einheit', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Beispiel Käsekuchen', 1, { unit: 'Stück', sortOrder: 10 }),
      ]),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [
        position(1, 'Beispiel Käsekuchen', 1, { unit: 'Blech', sortOrder: 10 }),
      ]),
    ]);

    expect(tag.products.map((p) => p.productUnit)).toEqual(['Blech', 'Stück']);
  });

  /**
   * Kein localeCompare: Sein Ergebnis hängt an den ICU-Daten der Laufzeit und
   * könnte zwischen lokalem Test und Cloudflare-Edge abweichen — ein Test,
   * der irgendwo rot wird und nirgends reproduzierbar ist. Verglichen wird
   * nach Codepunkten, und die fachliche Reihenfolge trägt ohnehin sortOrder.
   */
  it('sortiert bei gleicher sortOrder deterministisch nach Codepunkten', () => {
    const einmal = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(1, 'Ähre', 1, { sortOrder: 5 }),
        position(2, 'Zopf', 1, { sortOrder: 5 }),
        position(3, 'Apfel', 1, { sortOrder: 5 }),
      ]),
    ]);
    const andersherum = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [
        position(3, 'Apfel', 1, { sortOrder: 5 }),
        position(2, 'Zopf', 1, { sortOrder: 5 }),
        position(1, 'Ähre', 1, { sortOrder: 5 }),
      ]),
    ]);

    expect(einmal.products.map((p) => p.productName)).toEqual(
      andersherum.products.map((p) => p.productName),
    );
    expect(einmal.products.map((p) => p.productName)).toEqual(['Apfel', 'Zopf', 'Ähre']);
  });
});

describe('aggregateProductionDay — Status und Fulfillment', () => {
  /**
   * Die Aggregation FILTERT NICHT. Was sie bekommt, summiert sie. Der Filter
   * gehört in die Abfrage — hier zu filtern wäre eine zweite Stelle, an der
   * dieselbe Regel steht.
   *
   * Dieser Test hält das fest: Ein durchgereichter Status erscheint
   * unverändert in der Antwort und wird nicht heimlich aussortiert.
   */
  it('reicht den Status jeder Bestellung unverändert durch', () => {
    const tag = aggregateProductionDay(TAG, [
      bestellung('BUS-2026-000123', 'Testcafé Nord', [position(1, 'A', 1)], { status: 'new' }),
      bestellung('BUS-2026-000124', 'Testcafé Süd', [position(1, 'A', 1)], {
        status: 'in_production',
      }),
    ]);

    expect(tag.orders.map((o) => o.status)).toEqual(['new', 'in_production']);
    expect(tag.orderCount).toBe(2);
  });

  it('behandelt Lieferung und Abholung gleich', () => {
    const lieferung: ProductionOrder = {
      orderNumber: 'BUS-2026-000123',
      customerName: 'Testcafé Nord',
      status: 'confirmed',
      fulfillmentType: 'delivery',
      note: null,
      items: [position(1, 'Beispiel Käsekuchen', 3)],
    };
    const abholung: ProductionOrder = {
      orderNumber: 'BUS-2026-000124',
      customerName: 'Testcafé Süd',
      status: 'confirmed',
      fulfillmentType: 'pickup',
      note: null,
      items: [position(1, 'Beispiel Käsekuchen', 4)],
    };

    const tag = aggregateProductionDay(TAG, [lieferung, abholung]);

    expect(tag.orderCount).toBe(2);
    expect(tag.totalUnits).toBe(7);
    expect(tag.products[0]?.quantity).toBe(7);
  });
});

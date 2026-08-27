import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { placeCafeOrder } from '../../src/application/place-cafe-order';
import type { Customer } from '../../src/domain/customer';
import { findCustomer } from '../../src/infrastructure/d1/customer-repository';
import { findOrderByNumber } from '../../src/infrastructure/d1/order-repository';
import {
  GASTRO,
  PRICING_TABLES,
  assignPriceGroup,
  changeCatalogPrice,
  priceProduct,
  resetPriceLists,
  setProductCost,
} from '../support/pricing';

/**
 * Der Kostenschnappschuss gegen eine echte D1 — §16 des Auftrags.
 *
 * DIE ENTSCHEIDENDE PRÜFUNG IST DIE DRITTE GRUPPE: Eine spätere Änderung der
 * Herstellkosten darf eine bestehende Bestellung NICHT verändern. Sie ist die
 * eigentliche Begründung dafür, dass es diese Spalte überhaupt gibt; ohne sie
 * könnte jede Auswertung die heutigen Kosten auf eine Bestellung von vor drei
 * Monaten anwenden.
 *
 * ALLE NAMEN UND BETRÄGE SIND FREI ERFUNDEN.
 */

const NOW = new Date('2026-08-24T07:00:00Z'); // Montag, Berlin: 09:00
const MORGEN = '2026-08-25';

/** Die Katalog-IDs, die priceProduct() vergibt (1000 + products.id). */
const KATALOG_KAESE = 1001;
const KATALOG_BLECH = 1002;

let cafe: Customer;

async function bestelle(
  items: ReadonlyArray<{ product_id: number; quantity: number }> = [{ product_id: 1, quantity: 3 }],
  submissionId = `sub-${crypto.randomUUID()}`,
) {
  return placeCafeOrder(env.DB, {
    customer: cafe,
    submissionId,
    input: { fulfillment_date: MORGEN, items },
    now: NOW,
  });
}

/** Die gespeicherten Kostenschnappschüsse einer Bestellung, direkt aus D1. */
async function snapshots(orderNumber: string): Promise<Array<number | null>> {
  const { results } = await env.DB.prepare(
    `SELECT oi.unit_cost_cents_snapshot AS wert
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.order_number = ?
      ORDER BY oi.id`,
  ).bind(orderNumber).all<{ wert: number | null }>();

  return results.map((r) => r.wert);
}

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await resetPriceLists(env.DB);

  const ts = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Fiktiver Käsekuchen', 520, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (2, 'Fiktiver Butterkuchen', 2400, 'Blech', 1, 20, ?1, ?1)`,
    ).bind(ts),
  ]);

  await priceProduct(env.DB, { productId: 1, gastro: 520, privat: 620 });
  await priceProduct(env.DB, { productId: 2, gastro: 2400, privat: 2800 });
  await assignPriceGroup(env.DB, 1, GASTRO);

  const customer = await findCustomer(env.DB, 1);
  if (customer === null) throw new Error('Café fehlt im Testaufbau');
  cafe = customer;
});

describe('Bestellung mit gepflegten Herstellkosten — §16.9', () => {
  it('schreibt den Kostenwert als Snapshot an die Position', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);

    const { order } = await bestelle();

    expect(await snapshots(order.orderNumber.value)).toEqual([210]);
  });

  it('schreibt je Position den Wert ihres eigenen Produkts', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    await setProductCost(env.DB, KATALOG_BLECH, 1450);

    const { order } = await bestelle([
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1 },
    ]);

    expect(await snapshots(order.orderNumber.value)).toEqual([210, 1450]);
  });

  it('liest den Snapshot unverändert zurück', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order } = await bestelle();

    const geladen = await findOrderByNumber(env.DB, order.orderNumber.value);
    expect(geladen?.items[0]?.unitCostSnapshot?.cents).toBe(210);
    expect(geladen?.costSummary().complete).toBe(true);
  });

  /** §2 — gepflegte 0 € sind eine Aussage und werden als 0 gespeichert. */
  it('speichert gepflegte 0 € als 0 und nicht als NULL', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 0);
    const { order } = await bestelle();

    expect(await snapshots(order.orderNumber.value)).toEqual([0]);
  });
});

describe('Bestellung ohne gepflegte Herstellkosten — §16.10', () => {
  /** §9 — Kostenpflege ist optional, die Bestellung darf nicht scheitern. */
  it('legt die Bestellung an und lässt den Snapshot NULL', async () => {
    const { order, created } = await bestelle();

    expect(created).toBe(true);
    expect(await snapshots(order.orderNumber.value)).toEqual([null]);
  });

  /** §14 — die Lücke bleibt als Lücke erkennbar. */
  it('meldet eine teilweise gepflegte Bestellung als unvollständig', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);

    const { order } = await bestelle([
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1 },
    ]);

    expect(await snapshots(order.orderNumber.value)).toEqual([210, null]);

    const geladen = await findOrderByNumber(env.DB, order.orderNumber.value);
    const summary = geladen!.costSummary();
    expect(summary.itemCount).toBe(2);
    expect(summary.itemsWithCost).toBe(1);
    expect(summary.complete).toBe(false);
    expect(summary.knownCost.cents).toBe(420);
  });

  it('speichert NULL und nicht 0', async () => {
    const { order } = await bestelle();

    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_items WHERE unit_cost_cents_snapshot IS NULL`,
    ).first<{ n: number }>();

    expect(row?.n).toBe(1);
    expect(await snapshots(order.orderNumber.value)).toEqual([null]);
  });
});

describe('Spätere Kostenänderung — §16.11 und §16.12', () => {
  /**
   * DIE PRÜFUNG, UM DIE ES GEHT. Die Butter wird teurer, jemand zieht den
   * Kostenwert nach — und die Bestellung von vorgestern bleibt, was sie war.
   */
  it('lässt eine bestehende Bestellung unverändert', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order: alt } = await bestelle();

    await setProductCost(env.DB, KATALOG_KAESE, 260);

    expect(await snapshots(alt.orderNumber.value)).toEqual([210]);

    const geladen = await findOrderByNumber(env.DB, alt.orderNumber.value);
    expect(geladen?.items[0]?.unitCostSnapshot?.cents).toBe(210);
  });

  /** §16.12 — die NÄCHSTE Bestellung bekommt den neuen Wert. */
  it('gibt der nächsten Bestellung den neuen Wert', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order: alt } = await bestelle();

    await setProductCost(env.DB, KATALOG_KAESE, 260);
    const { order: neu } = await bestelle();

    expect(await snapshots(alt.orderNumber.value)).toEqual([210]);
    expect(await snapshots(neu.orderNumber.value)).toEqual([260]);
  });

  /**
   * Auch das ENTFERNEN eines Kostenwerts wirkt nur nach vorn. Eine
   * Bestellung, die einmal wusste, was sie gekostet hat, verliert das nicht
   * wieder.
   */
  it('lässt eine bestehende Bestellung auch beim Entfernen der Kosten unberührt', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order: alt } = await bestelle();

    await setProductCost(env.DB, KATALOG_KAESE, null);
    const { order: neu } = await bestelle();

    expect(await snapshots(alt.orderNumber.value)).toEqual([210]);
    expect(await snapshots(neu.orderNumber.value)).toEqual([null]);
  });

  /**
   * Und umgekehrt: Wird ein Kostenwert erst NACH einer Bestellung gepflegt,
   * bleibt die alte Bestellung ohne Angabe. Kein rückwirkendes Auffüllen —
   * §4 der Migration.
   */
  it('füllt eine ältere Bestellung nicht rückwirkend auf', async () => {
    const { order: alt } = await bestelle();

    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order: neu } = await bestelle();

    expect(await snapshots(alt.orderNumber.value)).toEqual([null]);
    expect(await snapshots(neu.orderNumber.value)).toEqual([210]);
  });
});

describe('Der Verkaufspreis bleibt unberührt — §16.14', () => {
  it('speichert Preis-Snapshot und Positionsbetrag unverändert', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order } = await bestelle();

    const row = await env.DB.prepare(
      `SELECT oi.unit_price_cents, oi.line_total_cents, o.total_amount_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.order_number = ?`,
    ).bind(order.orderNumber.value).first<{
      unit_price_cents: number; line_total_cents: number; total_amount_cents: number;
    }>();

    expect(row?.unit_price_cents).toBe(520);
    expect(row?.line_total_cents).toBe(1560);
    expect(row?.total_amount_cents).toBe(1560);
  });

  /**
   * Preis- und Kostenschnappschuss sind VONEINANDER unabhängig: Eine
   * Preisänderung lässt den Kostenwert der alten Bestellung stehen und
   * umgekehrt.
   */
  it('hält Preis- und Kostenschnappschuss getrennt', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);
    const { order: alt } = await bestelle();

    await changeCatalogPrice(env.DB, KATALOG_KAESE, GASTRO, 590);
    await setProductCost(env.DB, KATALOG_KAESE, 260);
    const { order: neu } = await bestelle();

    const altGeladen = await findOrderByNumber(env.DB, alt.orderNumber.value);
    const neuGeladen = await findOrderByNumber(env.DB, neu.orderNumber.value);

    expect(altGeladen?.items[0]?.unitPrice.cents).toBe(520);
    expect(altGeladen?.items[0]?.unitCostSnapshot?.cents).toBe(210);
    expect(neuGeladen?.items[0]?.unitPrice.cents).toBe(590);
    expect(neuGeladen?.items[0]?.unitCostSnapshot?.cents).toBe(260);
  });
});

describe('Idempotenz — §16.15', () => {
  /**
   * Dieselbe Absendekennung erzeugt keine zweite Bestellung — und auch keinen
   * zweiten, womöglich anderen Kostenschnappschuss.
   */
  it('erzeugt bei doppelter Absendung keine zweite Bestellung', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);

    const kennung = 'sub-fiktiv-doppelklick-1';
    const erste = await bestelle([{ product_id: 1, quantity: 3 }], kennung);
    const zweite = await bestelle([{ product_id: 1, quantity: 3 }], kennung);

    expect(erste.created).toBe(true);
    expect(zweite.created).toBe(false);
    expect(zweite.order.orderNumber.value).toBe(erste.order.orderNumber.value);

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_items').first<{ n: number }>();
    expect(row?.n).toBe(1);
    expect(await snapshots(erste.order.orderNumber.value)).toEqual([210]);
  });

  /**
   * Ändert jemand die Kosten ZWISCHEN den beiden Absendungen, gewinnt die
   * bereits geschriebene Bestellung — die zweite Anfrage bestellt gar nichts.
   */
  it('behält bei einer Wiederholung den Snapshot der ersten Bestellung', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, 210);

    const kennung = 'sub-fiktiv-doppelklick-2';
    const erste = await bestelle([{ product_id: 1, quantity: 3 }], kennung);

    await setProductCost(env.DB, KATALOG_KAESE, 999);
    const zweite = await bestelle([{ product_id: 1, quantity: 3 }], kennung);

    expect(zweite.created).toBe(false);
    expect(await snapshots(erste.order.orderNumber.value)).toEqual([210]);
    expect(zweite.order.items[0]?.unitCostSnapshot?.cents).toBe(210);
  });
});

describe('Keine zusätzliche Abfrage — §21', () => {
  /**
   * DER KOSTENWERT KOSTET KEINEN EINZIGEN ZUGRIFF MEHR.
   *
   * Er steht in derselben Zeile wie der Preis und wird in derselben Abfrage
   * gelesen. Gezählt wird gegen einen Zähler um db.prepare; die Zahl ist
   * dieselbe, ob Kosten gepflegt sind oder nicht, und dieselbe bei einer wie
   * bei zwei Positionen — ein N+1 fiele hier sofort auf.
   */
  async function zaehle(
    fn: (db: D1Database) => Promise<unknown>,
  ): Promise<number> {
    let n = 0;
    const proxy = new Proxy(env.DB, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === 'prepare' && typeof value === 'function') {
          return (...args: unknown[]) => {
            n += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;

    await fn(proxy);
    return n;
  }

  it('braucht mit gepflegten Kosten nicht mehr Abfragen als ohne', async () => {
    const ohne = await zaehle((db) =>
      placeCafeOrder(db, {
        customer: cafe,
        submissionId: 'sub-fiktiv-zaehler-1',
        input: { fulfillment_date: MORGEN, items: [{ product_id: 1, quantity: 3 }] },
        now: NOW,
      }),
    );

    await setProductCost(env.DB, KATALOG_KAESE, 210);
    await setProductCost(env.DB, KATALOG_BLECH, 1450);

    const mit = await zaehle((db) =>
      placeCafeOrder(db, {
        customer: cafe,
        submissionId: 'sub-fiktiv-zaehler-2',
        input: { fulfillment_date: MORGEN, items: [{ product_id: 1, quantity: 3 }] },
        now: NOW,
      }),
    );

    expect(mit).toBe(ohne);
  });

  /**
   * ZWEI POSITIONEN KOSTEN GENAU EINE ANWEISUNG MEHR — den INSERT dieser
   * Position, und den gab es schon vor Phase 7A. Er läuft im selben batch()
   * und ist damit kein zusätzlicher Zugriff.
   *
   * ENTSCHEIDEND IST DIE ZWEITE ZUSICHERUNG: Dieser Zuwachs ist derselbe, ob
   * Kosten gepflegt sind oder nicht. Eine Kostenabfrage je Position würde ihn
   * verdoppeln und diesen Test rot färben.
   */
  it('kostet je zusätzlicher Position genau eine Anweisung — mit wie ohne Kosten', async () => {
    const zaehleBestellung = (kennung: string, anzahlPositionen: 1 | 2) =>
      zaehle((db) =>
        placeCafeOrder(db, {
          customer: cafe,
          submissionId: kennung,
          input: {
            fulfillment_date: MORGEN,
            items: anzahlPositionen === 1
              ? [{ product_id: 1, quantity: 1 }]
              : [{ product_id: 1, quantity: 1 }, { product_id: 2, quantity: 1 }],
          },
          now: NOW,
        }),
      );

    const eineOhne = await zaehleBestellung('sub-fiktiv-zaehler-3', 1);
    const zweiOhne = await zaehleBestellung('sub-fiktiv-zaehler-4', 2);

    await setProductCost(env.DB, KATALOG_KAESE, 210);
    await setProductCost(env.DB, KATALOG_BLECH, 1450);

    const eineMit = await zaehleBestellung('sub-fiktiv-zaehler-5', 1);
    const zweiMit = await zaehleBestellung('sub-fiktiv-zaehler-6', 2);

    expect(zweiOhne - eineOhne).toBe(1);
    expect(zweiMit - eineMit).toBe(1);
    expect(eineMit).toBe(eineOhne);
    expect(zweiMit).toBe(zweiOhne);
  });
});

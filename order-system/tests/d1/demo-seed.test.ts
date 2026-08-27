import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveCredential } from '../../scripts/create-local-auth-account.mjs';
import {
  DEMO_ADMIN,
  DEMO_CUSTOMER_LOGINS,
} from '../../scripts/demo/demo-config.mjs';
import { buildDemoDataset, demoSeedStatements } from '../../scripts/demo/demo-dataset.mjs';
import type { AppConfig } from '../../src/config/app-config';
import { getDashboardDay } from '../../src/application/get-dashboard-day';
import { getDashboardWeek } from '../../src/application/get-dashboard-week';
import { getProductionDay } from '../../src/application/get-production-day';
import { logIn } from '../../src/application/log-in';
import { placeCafeOrder } from '../../src/application/place-cafe-order';
import { plusDays, weekStart } from '../../src/domain/clock';
import { MIN_ITERATIONS } from '../../src/infrastructure/auth/credential';
import { loadCustomerOrderHistory } from '../../src/infrastructure/d1/customer-history-repository';
import { findCustomer } from '../../src/infrastructure/d1/customer-repository';
import { loadOrderPolicy } from '../../src/infrastructure/d1/order-policy-repository';
import { evaluateOrderAvailability } from '../../src/domain/order-policy';

/**
 * DER DEMO-BESTAND GEGEN EINE ECHTE D1.
 *
 * tests/domain/demo-dataset.test.ts prüft, WAS gesät wird. Hier steht, ob es
 * auch durchgeht: ob jede Fremdschlüsselbeziehung stimmt, jedes CHECK hält,
 * die Anmeldung funktioniert, das Dashboard gefüllt ist — und ob ein zweiter
 * Seedlauf denselben Stand erzeugt statt Dubletten.
 *
 * DIE DEMO WIRD HIER NICHT GESTARTET. Kein Wrangler, kein Port, kein
 * Dateisystem: Dieselben SQL-Anweisungen, die `npm run demo` anwendet, laufen
 * gegen die Wegwerf-D1 dieses Testlaufs. Was hier grün ist, ist am Demo-Port
 * derselbe Bestand.
 *
 * DER PEPPER IST DER DES TESTLAUFS und nicht der der Vorführung: Die Verifier
 * werden beim Seeden gerechnet, nicht vorberechnet — genau deshalb lässt sich
 * die Anmeldung hier überhaupt prüfen.
 */

const CONFIG: AppConfig = {
  environment: 'development',
  appOrigin: 'http://127.0.0.1:8787',
  pepper: 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789',
};

/** Ein fester Tag: Der Bestand rechnet relativ, die Prüfung soll es nicht. */
const HEUTE = '2026-08-27';
const LEITTAG = plusDays(HEUTE, 1);

/** Berlin liegt Ende August zwei Stunden vor UTC — 09:00 Ortszeit. */
const JETZT = new Date(`${HEUTE}T07:00:00.000Z`);

async function seed(): Promise<void> {
  const anweisungen = await demoSeedStatements({
    heute: HEUTE,
    pepper: CONFIG.pepper,
    iterations: MIN_ITERATIONS,
    deriveCredential,
    admin: DEMO_ADMIN,
    customerLogins: DEMO_CUSTOMER_LOGINS,
  });

  for (const anweisung of anweisungen) {
    await env.DB.prepare(anweisung).run();
  }
}

async function anmelden(identifier: string, secret: string) {
  return logIn(env.DB, CONFIG, { identifier, secret, now: JETZT, existingSessionToken: null });
}

async function zaehle(sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? -1;
}

beforeAll(async () => {
  await seed();
});

describe('Der Demo-Bestand entsteht vollständig', () => {
  it('legt Kunden, Sortiment und Bestellungen an', async () => {
    const bestand = buildDemoDataset(HEUTE);

    expect(await zaehle('SELECT COUNT(*) AS n FROM customers')).toBe(bestand.customers.length);
    expect(await zaehle('SELECT COUNT(*) AS n FROM catalog_products')).toBe(
      bestand.catalogProducts.length,
    );
    expect(await zaehle('SELECT COUNT(*) AS n FROM products')).toBe(
      bestand.catalogProducts.length,
    );
    expect(await zaehle('SELECT COUNT(*) AS n FROM orders')).toBe(bestand.orders.length);
  });

  it('verletzt keinen Fremdschlüssel', async () => {
    const { results } = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(results).toEqual([]);
  });

  it('verknüpft jedes Bestellprodukt mit dem Katalog', async () => {
    expect(await zaehle('SELECT COUNT(*) AS n FROM products WHERE catalog_product_id IS NULL')).toBe(0);
  });

  it('hält die Herstellkosten genau dort offen, wo es Absicht ist', async () => {
    const { results } = await env.DB.prepare(
      'SELECT name FROM catalog_products WHERE unit_cost_cents IS NULL ORDER BY name',
    ).all<{ name: string }>();

    expect(results.map((z) => z.name)).toEqual(['Hochzeitstorte', 'Streuselschnecke']);
  });
});

describe('Anmeldung in der Demo', () => {
  it('lässt das Demo-Admin-Konto herein', async () => {
    const ergebnis = await anmelden(DEMO_ADMIN.identifier, DEMO_ADMIN.secret);

    expect(ergebnis).not.toBeNull();
    expect(ergebnis?.role).toBe('admin');
  });

  it('lässt jeden der drei Demo-Kunden herein — jeden an seinem eigenen Kunden', async () => {
    for (const login of DEMO_CUSTOMER_LOGINS) {
      const ergebnis = await anmelden(login.identifier, login.pin);

      expect(ergebnis, `Anmeldung ${login.identifier}`).not.toBeNull();
      expect(ergebnis?.role).toBe('customer');

      const konto = await env.DB.prepare(
        'SELECT customer_id AS n FROM auth_accounts WHERE login_identifier_normalized = ?',
      ).bind(login.identifier.toLowerCase()).first<{ n: number }>();
      expect(konto?.n).toBe(login.customerId);
    }
  });

  it('weist eine falsche PIN ab', async () => {
    expect(await anmelden(DEMO_CUSTOMER_LOGINS[0]!.identifier, '99999999')).toBeNull();
  });
});

describe('Das Dashboard ist am Leittag überzeugend gefüllt', () => {
  it('zeigt Bestellungen, Umsatz, Kunden und Einheiten', async () => {
    const tag = await getDashboardDay(env.DB, LEITTAG);

    expect(tag.orderCount).toBeGreaterThanOrEqual(5);
    expect(tag.cancelledCount).toBe(1);
    expect(tag.revenueCents).toBeGreaterThan(0);
    expect(tag.customerCount).toBeGreaterThanOrEqual(3);
    expect(tag.totalUnits).toBeGreaterThan(0);
  });

  it('rechnet Rohertrag und Marge — die Kostenbasis des Leittags ist vollständig', async () => {
    const tag = await getDashboardDay(env.DB, LEITTAG);

    expect(tag.costs.complete).toBe(true);
    expect(tag.costs.missingItemCount).toBe(0);
    expect(tag.costs.grossProfitCents).not.toBeNull();
    expect(tag.costs.marginTenthsPercent).not.toBeNull();
    expect(tag.costs.grossProfitCents!).toBeGreaterThan(0);
  });

  it('zeigt alle vier Zahlungswege und mehrere Bestellstatus', async () => {
    const tag = await getDashboardDay(env.DB, LEITTAG);

    const wege = new Set(tag.orders.map((b) => b.paymentStatus));
    expect(wege).toContain('unpaid');
    expect(wege).toContain('paid_cash');
    expect(wege).toContain('paid_card');
    expect(wege).toContain('paid_bank');
    expect(tag.unpaidCents).toBeGreaterThan(0);
    expect(tag.paidCents).toBeGreaterThan(0);

    expect(tag.statusCounts.new).toBeGreaterThan(0);
    expect(tag.statusCounts.in_production).toBeGreaterThan(0);
    expect(tag.statusCounts.completed).toBeGreaterThan(0);
    expect(tag.statusCounts.cancelled).toBe(1);
  });

  /**
   * Die gewollte Lücke. Ohne sie ließe sich nicht zeigen, dass das Dashboard
   * eine unvollständige Kostenbasis ZUGIBT, statt sie stillschweigend mit
   * Nullen zu füllen.
   */
  it('lässt an einem anderen Tag eine unvollständige Kostenbasis stehen', async () => {
    const heute = await getDashboardDay(env.DB, HEUTE);

    expect(heute.orderCount).toBeGreaterThan(0);
    expect(heute.costs.complete).toBe(false);
    expect(heute.costs.grossProfitCents).toBeNull();
    expect(heute.costs.missingItemCount).toBeGreaterThan(0);
  });

  it('füllt die Wochenansicht an mehreren Tagen', async () => {
    const woche = await getDashboardWeek(env.DB, weekStart(LEITTAG));
    const gefuellt = woche.days.filter((tag) => tag.orderCount > 0);

    expect(gefuellt.length).toBeGreaterThanOrEqual(2);
    expect(woche.total.revenueCents).toBeGreaterThan(0);
  });
});

describe('Produktion und Listen sind gefüllt', () => {
  it('führt den Leittag mit offenen Bestellungen und Mengen', async () => {
    const tag = await getProductionDay(env.DB, LEITTAG);

    expect(tag.orders.length).toBeGreaterThanOrEqual(3);
    expect(tag.products.length).toBeGreaterThanOrEqual(3);
    expect(tag.totalUnits).toBeGreaterThan(0);
  });

  it('enthält Lieferungen UND Abholungen — beide Listen haben Inhalt', async () => {
    const tag = await getProductionDay(env.DB, LEITTAG);
    const arten = new Set(tag.orders.map((b) => b.fulfillmentType));

    expect(arten).toContain('delivery');
    expect(arten).toContain('pickup');
  });

  it('lässt jede offene Bestellung des Leittags weiterschalten', async () => {
    const tag = await getProductionDay(env.DB, LEITTAG);

    // Mindestens eine Bestellung in jedem der drei offenen Zustände: Nur so
    // ist jeder Statuswechsel vorführbar, ohne vorher etwas herzurichten.
    const status = new Set(tag.orders.map((b) => b.status));
    expect(status).toContain('new');
    expect(status).toContain('confirmed');
    expect(status).toContain('in_production');
  });
});

describe('Die Kundenhistorie hat eine Historie', () => {
  it('zeigt für den Demo-Gastrokunden mehrere zurückliegende Bestellungen', async () => {
    const zeilen = await loadCustomerOrderHistory(env.DB, 1, 10);

    expect(zeilen.length).toBeGreaterThanOrEqual(5);
    // Nicht alle am selben Tag — sonst ist es keine Historie, sondern ein Tag.
    expect(new Set(zeilen.map((z) => z.fulfillmentDate)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('Bestellen ist in der Demo möglich', () => {
  it('erlaubt nach der Demo-Richtlinie eine Bestellung für den Leittag', async () => {
    const { policy } = await loadOrderPolicy(env.DB);
    const verfuegbar = evaluateOrderAvailability(policy, JETZT, LEITTAG);

    expect(verfuegbar.allowed).toBe(true);
  });

  it('nimmt eine neue Bestellung an und vergibt eine freie Nummer', async () => {
    const kunde = await findCustomer(env.DB, 1);
    expect(kunde).not.toBeNull();

    const vorher = await zaehle('SELECT COUNT(*) AS n FROM orders');
    const { order, created } = await placeCafeOrder(env.DB, {
      customer: kunde!,
      submissionId: '11111111-2222-4333-8444-555555555555',
      input: { fulfillment_date: LEITTAG, items: [{ product_id: 1, quantity: 4 }] },
      now: JETZT,
    });

    expect(created).toBe(true);
    expect(order.orderNumber.value).toBe(`BUS-${HEUTE.slice(0, 4)}-000121`);
    expect(await zaehle('SELECT COUNT(*) AS n FROM orders')).toBe(vorher + 1);
  });

  it('lässt die neue Bestellung im Dashboard des Leittags erscheinen — mit Kosten', async () => {
    const tag = await getDashboardDay(env.DB, LEITTAG);

    expect(tag.orders.some((b) => b.orderNumber === `BUS-${HEUTE.slice(0, 4)}-000121`)).toBe(true);
    // Der Kostenschnappschuss wird beim Bestellen gesetzt: Der Leittag bleibt
    // auch nach einer Vorführungsbestellung vollständig kalkuliert.
    expect(tag.costs.complete).toBe(true);
  });
});

describe('Der Seed ist beliebig wiederholbar', () => {
  it('erzeugt beim zweiten Lauf keine Dubletten und denselben Ausgangsstand', async () => {
    const bestand = buildDemoDataset(HEUTE);

    // Ausgangslage: die eben aufgegebene Vorführungsbestellung steht noch da.
    expect(await zaehle('SELECT COUNT(*) AS n FROM orders')).toBe(bestand.orders.length + 1);

    await seed();

    expect(await zaehle('SELECT COUNT(*) AS n FROM orders')).toBe(bestand.orders.length);
    expect(await zaehle('SELECT COUNT(*) AS n FROM customers')).toBe(bestand.customers.length);
    expect(await zaehle('SELECT COUNT(*) AS n FROM products')).toBe(bestand.catalogProducts.length);
    expect(await zaehle('SELECT COUNT(*) AS n FROM auth_accounts')).toBe(
      DEMO_CUSTOMER_LOGINS.length + 1,
    );
    expect(await zaehle('SELECT COUNT(*) AS n FROM order_items')).toBe(
      bestand.orders.reduce((summe, b) => summe + b.items.length, 0),
    );
    // Auch die Bestellnummernvergabe steht wieder auf dem Ausgangswert.
    expect(await zaehle('SELECT COUNT(*) AS n FROM order_number_sequences')).toBe(1);
  });

  it('meldet den Leittag danach wieder vollständig kalkuliert', async () => {
    const tag = await getDashboardDay(env.DB, LEITTAG);

    expect(tag.costs.complete).toBe(true);
    expect(tag.cancelledCount).toBe(1);
  });

  it('lässt die Demokonten nach dem zweiten Lauf weiterhin herein', async () => {
    expect(await anmelden(DEMO_ADMIN.identifier, DEMO_ADMIN.secret)).not.toBeNull();
  });
});

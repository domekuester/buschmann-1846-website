import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * PHASE 7B AN DER HTTP-GRENZE — Rohertrag, Marge und Kostenabdeckung auf der
 * AUSGELIEFERTEN SEITE.
 *
 * Die Rechenregeln sind in der Domäne geprüft, die Darstellung im
 * Ansichtsmodell. Hier steht die dritte Hälfte: dass echter Worker, echte D1
 * und echter Wächter dasselbe ergeben — mit Kostenschnappschüssen, die
 * tatsächlich in order_items stehen.
 *
 * ALLE NAMEN, PREISE UND KOSTEN SIND FREI ERFUNDEN.
 */

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const TAG = '2026-08-26';
const MONTAG = '2026-08-24';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(
  id: number,
  identifier: string,
  role: 'admin' | 'customer',
  secret: string,
): Promise<void> {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (id, login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(
    id, identifier, role, role === 'customer' ? 1 : null,
    credential.algorithm, credential.iterations, credential.saltHex,
    credential.verifierHex, NOW, NOW,
  ).run();
}

async function login(identifier: string, secret: string): Promise<string> {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  return `buschmann_session_dev=${result.token}`;
}

const admin = () => login('admin@example.test', 'fiktives-admin-passwort-123');
const kunde = () => login('testcafe', 'fiktive-kunden-pin-123');

async function call(path: string, cookie: string | null = null): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

interface Position {
  /** null heißt „damals nicht gepflegt" — der Altbestand vor Phase 7A. */
  readonly unitCostCents: number | null;
  readonly quantity?: number;
}

/**
 * Eine Bestellung samt Positionen — mit oder ohne Kostenschnappschuss.
 *
 * DER KOSTENWERT WIRD DIREKT IN order_items GESCHRIEBEN und nicht über den
 * Katalog: Genau so liegt er in der Wirklichkeit, weil er beim Bestellen
 * eingefroren wurde. Ein Test, der ihn aus catalog_products holte, prüfte
 * nicht den Snapshot, sondern die Gegenwart.
 */
async function seedOrder(
  orderNumber: string,
  overrides: {
    status?: string;
    paymentStatus?: string;
    totalCents?: number;
    day?: string;
    items?: readonly Position[];
  } = {},
): Promise<void> {
  const bezahlt = overrides.paymentStatus ?? 'unpaid';
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, 1, 'Fiktives Café Nord', 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    orderNumber,
    overrides.day ?? TAG,
    overrides.status ?? 'new',
    overrides.totalCents ?? 4350,
    bezahlt,
    bezahlt === 'unpaid' ? null : NOW,
    NOW,
    NOW,
  ).run();

  /**
   * JE POSITION EIN ANDERES PRODUKT — das Schema verlangt es:
   * order_items trägt UNIQUE(order_id, product_id). Eine Bestellung kann
   * dasselbe Produkt nicht zweimal enthalten; wer mehr will, erhöht die
   * Menge.
   */
  const positionen = overrides.items ?? [{ unitCostCents: null }];
  for (const [index, item] of positionen.entries()) {
    const menge = item.quantity ?? 1;
    const produkt = index + 1;
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents,
                                unit_cost_cents_snapshot)
       VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, 'Stück',
               500, ?, ?, ?)`,
    ).bind(
      orderNumber,
      produkt,
      `Fiktives Produkt ${produkt}`,
      menge,
      500 * menge,
      item.unitCostCents,
    ).run();
  }
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktives Produkt 1', 500, 'Stück', 1, 10, ?1, ?1),
            (2, 'Fiktives Produkt 2', 500, 'Stück', 1, 20, ?1, ?1),
            (3, 'Fiktives Produkt 3', 500, 'Stück', 1, 30, ?1, ?1)`,
  ).bind(NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('GET /admin/dashboard — der vollständig kalkulierte Tag', () => {
  /** Umsatz 1.240,00 €, Kosten 510,30 €, Rohertrag 729,70 €, Marge 58,8 %. */
  async function tagAusDemAuftrag(): Promise<void> {
    await seedOrder('BUS-2026-000001', {
      totalCents: 124_000,
      items: [{ unitCostCents: 51_030 }],
    });
  }

  it('zeigt alle vier Finanzwerte', async () => {
    await tagAusDemAuftrag();

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Finanzen');
    expect(html).toContain('Herstellkosten');
    expect(html).toContain('Rohertrag');
    expect(html).toContain('1.240,00 €');
    expect(html).toContain('510,30 €');
    expect(html).toContain('729,70 €');
    expect(html).toContain('58,8 %');
  });

  it('nennt die Kostenbasis vollständig', async () => {
    await tagAusDemAuftrag();

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Kostenbasis vollständig');
    expect(html).not.toContain('Kostenbasis unvollständig');
    expect(html).not.toContain('Herstellkosten ergänzen');
  });

  it('rechnet die Menge in die Kosten ein', async () => {
    await seedOrder('BUS-2026-000001', {
      totalCents: 10_000,
      items: [{ unitCostCents: 1000, quantity: 3 }],
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    // 3 × 10,00 € = 30,00 € Kosten, Rohertrag 70,00 €, Marge 70,0 %.
    expect(html).toContain('30,00 €');
    expect(html).toContain('70,00 €');
    expect(html).toContain('70,0 %');
  });

  it('summiert über mehrere Bestellungen und Positionen', async () => {
    await seedOrder('BUS-2026-000001', {
      totalCents: 10_000,
      items: [{ unitCostCents: 1000, quantity: 2 }, { unitCostCents: 500 }],
    });
    await seedOrder('BUS-2026-000002', {
      totalCents: 10_000,
      items: [{ unitCostCents: 2500 }],
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    // 2000 + 500 + 2500 = 5000 Cent Kosten bei 20.000 Cent Umsatz → 75,0 %.
    expect(html).toContain('200,00 €');
    expect(html).toContain('50,00 €');
    expect(html).toContain('150,00 €');
    expect(html).toContain('75,0 %');
  });
});

describe('GET /admin/dashboard — die unvollständige Kostenbasis', () => {
  it('zeigt keine Gesamtmarge, aber den richtigen Umsatz', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 10_000, items: [{ unitCostCents: 2000 }] });
    await seedOrder('BUS-2026-000002', { totalCents: 10_000, items: [{ unitCostCents: null }] });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Kostenbasis unvollständig');
    expect(html).toContain('200,00 €');
    expect(html).not.toMatch(/\d,\d\s%/);
  });

  it('nennt, bei wie vielen Bestellungen die Kosten fehlen', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 10_000, items: [{ unitCostCents: 2000 }] });
    await seedOrder('BUS-2026-000002', { totalCents: 10_000, items: [{ unitCostCents: null }] });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Bei 1 von 2 Bestellungen fehlen noch die Herstellkosten.');
  });

  /** §19.18 — der Weg führt auf die bestehende Seite „Sortiment &amp; Preise". */
  it('verlinkt die bestehende Kostenpflege', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 10_000, items: [{ unitCostCents: null }] });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Herstellkosten ergänzen');
    expect(html).toContain('href="/admin/catalog#herstellkosten"');
  });

  it('führt der Link auf eine Seite, die es gibt', async () => {
    const antwort = await call('/admin/catalog', await admin());

    expect(antwort.status).toBe(200);
    expect(await antwort.text()).toContain('id="herstellkosten"');
  });

  /** §9 — der Altbestand aus der Zeit vor Phase 7A. */
  it('behandelt eine Bestellung ganz ohne Snapshots ehrlich', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 4350, items: [{ unitCostCents: null }] });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Kostenbasis unvollständig');
    expect(html).toContain('43,50 €');
    expect(html).not.toContain('NaN');
  });

  /**
   * §22.C — DER SNAPSHOT UND NICHT DER HEUTIGE KATALOGWERT.
   *
   * Ein gepflegter Kostenwert am Katalogprodukt darf eine alte Bestellung
   * ohne Snapshot NICHT nachträglich kalkulierbar machen.
   */
  it('holt sich keine Kosten aus dem heutigen Katalog', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order,
                                     unit_cost_cents, created_at, updated_at)
       VALUES (900, 'test-900', 'Fiktives Katalogprodukt', 1, 10, 333, ?, ?)`,
    ).bind(NOW, NOW).run();
    await env.DB.prepare('UPDATE products SET catalog_product_id = 900 WHERE id = 1').run();

    await seedOrder('BUS-2026-000001', { totalCents: 10_000, items: [{ unitCostCents: null }] });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Kostenbasis unvollständig');
    expect(html).not.toContain('3,33 €');
  });
});

describe('GET /admin/dashboard — Storno, Zahlung und Grenzfälle', () => {
  /** §22.B — eine stornierte Bestellung zählt in keiner Kostensumme. */
  it('lässt stornierte Bestellungen aus Kosten und Marge heraus', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 10_000, items: [{ unitCostCents: 4000 }] });
    await seedOrder('BUS-2026-000002', {
      status: 'cancelled',
      totalCents: 99_900,
      items: [{ unitCostCents: 90_000 }],
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('40,00 €');
    expect(html).toContain('60,00 €');
    expect(html).toContain('60,0 %');
  });

  it('wird von einer stornierten Bestellung ohne Kosten nicht unvollständig', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 10_000, items: [{ unitCostCents: 4000 }] });
    await seedOrder('BUS-2026-000002', {
      status: 'cancelled',
      totalCents: 5000,
      items: [{ unitCostCents: null }],
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Kostenbasis vollständig');
    expect(html).toContain('60,0 %');
  });

  /** §22.F und §16 — der Zahlungsstand ändert am Rohertrag nichts. */
  it('zählt eine unbezahlte Bestellung genauso wie eine bezahlte', async () => {
    await seedOrder('BUS-2026-000001', {
      paymentStatus: 'unpaid',
      totalCents: 10_000,
      items: [{ unitCostCents: 4000 }],
    });

    const offen = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();
    expect(offen).toContain('60,0 %');

    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid_cash', payment_recorded_at = ?`,
    ).bind(NOW).run();

    const bezahlt = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();
    expect(bezahlt).toContain('60,0 %');
    expect(bezahlt).toContain('60,00 €');
  });

  /** §15 — Kosten über dem Umsatz. */
  it('zeigt einen negativen Rohertrag mit Vorzeichen', async () => {
    await seedOrder('BUS-2026-000001', {
      totalCents: 10_000,
      items: [{ unitCostCents: 12_000 }],
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('-20,00 €');
    expect(html).toContain('-20,0 %');
    expect(html).toContain('finanzzeile--minus');
  });

  /** §14 — Umsatz null. */
  it('zeigt an einem leeren Tag keine Marge und kein NaN', async () => {
    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Finanzen');
    expect(html).toContain('Keine Umsätze an diesem Tag.');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('zeigt an einem vollständig stornierten Tag keine Marge', async () => {
    await seedOrder('BUS-2026-000001', {
      status: 'cancelled',
      totalCents: 10_000,
      items: [{ unitCostCents: 4000 }],
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).not.toMatch(/\d,\d\s%/);
    expect(html).toContain('Keine Umsätze an diesem Tag.');
  });
});

describe('GET /admin/dashboard?view=week — die Marge je Tag', () => {
  /** §20.22 und §20.23 — Zahl, wo kalkuliert ist; Hinweis, wo nicht. */
  it('zeigt eine Margenspalte mit Zahl und Hinweis', async () => {
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 42_000,
      items: [{ unitCostCents: 18_900 }],
    });
    await seedOrder('BUS-2026-000002', {
      day: '2026-08-25',
      totalCents: 31_000,
      items: [{ unitCostCents: null }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('>Marge</th>');
    expect(html).toContain('55,0 %');
    expect(html).toContain('Kosten fehlen');
    expect(html).toContain('420,00 €');
    expect(html).toContain('310,00 €');
  });

  /** §20.24 — die Wochenmarge einer vollständig kalkulierten Woche. */
  it('zeigt die Wochenmarge, wenn die ganze Woche kalkuliert ist', async () => {
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 42_000,
      items: [{ unitCostCents: 18_900 }],
    });
    await seedOrder('BUS-2026-000002', {
      day: '2026-08-26',
      totalCents: 84_000,
      items: [{ unitCostCents: 32_760 }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('Ganze Woche');
    expect(html).toContain('1.260,00 €');
    expect(html).toContain('59,0 %');
  });

  /** §20.25 — ein unvollständiger Tag nimmt die Wochenmarge mit. */
  it('lässt die Wochenmarge bei einem unvollständigen Tag aus', async () => {
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 42_000,
      items: [{ unitCostCents: 18_900 }],
    });
    await seedOrder('BUS-2026-000002', {
      day: '2026-08-27',
      totalCents: 31_000,
      items: [{ unitCostCents: null }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    const summenzeile = html.slice(html.indexOf('Ganze Woche'));
    expect(summenzeile).toContain('Kosten fehlen');
    expect(summenzeile).not.toMatch(/\d,\d\s%/);
  });

  /** §20.26 — stornierte Bestellungen bleiben auch in der Woche draußen. */
  it('lässt stornierte Bestellungen aus der Wochenmarge heraus', async () => {
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 10_000,
      items: [{ unitCostCents: 4000 }],
    });
    await seedOrder('BUS-2026-000002', {
      day: MONTAG,
      status: 'cancelled',
      totalCents: 99_900,
      items: [{ unitCostCents: null }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('60,0 %');
    expect(html).not.toContain('Kosten fehlen');
  });

  /** §20.27 — der Bereich der Woche stimmt auch für die Kosten. */
  it('nimmt nur die Positionen der betrachteten Woche', async () => {
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 10_000,
      items: [{ unitCostCents: 4000 }],
    });
    // Der Sonntag DAVOR und der Montag DANACH — beide außerhalb.
    await seedOrder('BUS-2026-000002', {
      day: '2026-08-23',
      totalCents: 50_000,
      items: [{ unitCostCents: null }],
    });
    await seedOrder('BUS-2026-000003', {
      day: '2026-08-31',
      totalCents: 50_000,
      items: [{ unitCostCents: null }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('60,0 %');
    expect(html).not.toContain('Kosten fehlen');
    expect(html).not.toContain('500,00 €');
  });

  it('bezieht den Sonntag ausdrücklich ein', async () => {
    await seedOrder('BUS-2026-000001', {
      day: '2026-08-30',
      totalCents: 10_000,
      items: [{ unitCostCents: 4000 }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('60,0 %');
    expect(html).toContain('100,00 €');
  });

  it('zeigt für eine leere Woche Striche statt Prozentwerte', async () => {
    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('>Marge</th>');
    expect(html).not.toMatch(/\d,\d\s%/);
    expect(html).not.toContain('NaN');
  });

  it('nennt Tages- und Wochenmarge unabhängig voneinander', async () => {
    /**
     * §22.G an der HTTP-Grenze: Der Mittelwert der Tagesmargen wäre 60,0 %,
     * die umsatzgewichtete Wahrheit ist 35,5 %.
     */
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 1000,
      items: [{ unitCostCents: 100 }],
    });
    await seedOrder('BUS-2026-000002', {
      day: '2026-08-29',
      totalCents: 10_000,
      items: [{ unitCostCents: 7000 }],
    });

    const html = await (await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())).text();

    expect(html).toContain('90,0 %');
    expect(html).toContain('30,0 %');
    expect(html).toContain('35,5 %');
    expect(html).not.toContain('60,0 %');
  });
});

describe('§21 — die Finanzdaten bleiben im Adminbereich', () => {
  it('zeigt einem Café das Dashboard gar nicht erst', async () => {
    const antwort = await call(`/admin/dashboard?date=${TAG}`, await kunde());

    expect(antwort.status).toBe(403);
    const html = await antwort.text();
    expect(html).not.toContain('Rohertrag');
    expect(html).not.toContain('Marge');
  });

  it('zeigt einem Café auch die Wochenansicht nicht', async () => {
    const antwort = await call(`/admin/dashboard?date=${MONTAG}&view=week`, await kunde());

    expect(antwort.status).toBe(403);
    expect(await antwort.text()).not.toContain('Marge');
  });

  it('weist einen Aufruf ohne Anmeldung ab', async () => {
    const antwort = await call(`/admin/dashboard?date=${TAG}`);

    expect([302, 303]).toContain(antwort.status);
    expect(await antwort.text()).not.toContain('Rohertrag');
  });
});

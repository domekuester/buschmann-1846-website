import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminCustomerInput } from '../../src/domain/admin-customer';
import { Address } from '../../src/domain/address';
import { MIN_ITERATIONS, deriveCredential, verifyCredential } from '../../src/infrastructure/auth/credential';
import { findAccountByIdentifier } from '../../src/infrastructure/d1/auth-account-repository';
import {
  createAdminCustomer,
  loadAdminCustomerWorkspace,
  resetAdminCustomerPin,
  updateAdminCustomer,
} from '../../src/infrastructure/d1/admin-customer-repository';

const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-28T10:00:00.000Z';
const LATER = '2026-08-28T11:00:00.000Z';

const input = (overrides: Partial<AdminCustomerInput> = {}): AdminCustomerInput => ({
  name: 'Fiktives Café',
  customerCode: 'cafemorgen',
  contactPerson: 'Erika Beispiel',
  email: 'erika@example.test',
  phone: '0211 123456',
  deliveryAddress: new Address('Teststraße 1', '40213', 'Düsseldorf'),
  priceGroupCode: 'gastro',
  defaultFulfillment: 'delivery',
  isActive: true,
  internalNote: 'Lieferung an der Rückseite',
  ...overrides,
});

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('Admin-Kundenaggregat in D1', () => {
  it('führt Altbestände ohne Preisgruppe und ohne Zugang weiterhin auf', async () => {
    await env.DB.prepare(
      `INSERT INTO customers
         (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (91, 'Fiktiver Altbestand', 0, 'pickup', ?, ?)`,
    ).bind(NOW, NOW).run();

    expect(await loadAdminCustomerWorkspace(env.DB)).toEqual([
      expect.objectContaining({
        id: 91,
        name: 'Fiktiver Altbestand',
        customerCode: '',
        priceGroupCode: null,
        isActive: false,
      }),
    ]);
  });

  it('legt Kunde, Preisgruppe und sicheren Zugang atomar an', async () => {
    const credential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    expect(await createAdminCustomer(env.DB, input(), credential, NOW)).toBe('created');

    const [customer] = await loadAdminCustomerWorkspace(env.DB);
    expect(customer).toMatchObject({
      name: 'Fiktives Café', customerCode: 'cafemorgen', priceGroupCode: 'gastro',
      defaultFulfillment: 'delivery', isActive: true,
      deliveryAddress: { street: 'Teststraße 1', postalCode: '40213', city: 'Düsseldorf' },
    });
    const account = await findAccountByIdentifier(env.DB, 'cafemorgen');
    expect(account?.customerId).toBe(customer?.id);
    expect(await verifyCredential('00123456', PEPPER, account!.credential)).toBe(true);
  });

  it('lehnt einen doppelten Kundencode ohne verwaisten Kunden ab', async () => {
    const credential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    await createAdminCustomer(env.DB, input(), credential, NOW);

    expect(await createAdminCustomer(
      env.DB,
      input({ name: 'Zweites Café' }),
      credential,
      LATER,
    )).toBe('duplicate_code');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>()).toEqual({ n: 1 });
  });

  it('ändert Stammdaten, Kundencode, Preisgruppe, Erfüllung und Status zusammen', async () => {
    const credential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    await createAdminCustomer(env.DB, input(), credential, NOW);
    const [created] = await loadAdminCustomerWorkspace(env.DB);
    if (!created) throw new Error('Kunde fehlt');

    expect(await updateAdminCustomer(env.DB, created.id, created.updatedAt, input({
      name: 'Fiktive Abholung',
      customerCode: 'privatdemo',
      contactPerson: null,
      email: null,
      phone: null,
      deliveryAddress: null,
      priceGroupCode: 'private',
      defaultFulfillment: 'pickup',
      isActive: false,
      internalNote: null,
    }), LATER)).toBe('updated');

    expect((await loadAdminCustomerWorkspace(env.DB))[0]).toMatchObject({
      name: 'Fiktive Abholung', customerCode: 'privatdemo', priceGroupCode: 'private',
      defaultFulfillment: 'pickup', isActive: false, deliveryAddress: null,
    });
    expect((await findAccountByIdentifier(env.DB, 'privatdemo'))?.isActive).toBe(false);
    expect(await findAccountByIdentifier(env.DB, 'cafemorgen')).toBeNull();
  });

  it('weist einen veralteten Save ohne Teiländerung zurück', async () => {
    const credential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    await createAdminCustomer(env.DB, input(), credential, NOW);
    const [created] = await loadAdminCustomerWorkspace(env.DB);
    if (!created) throw new Error('Kunde fehlt');
    await env.DB.prepare('UPDATE customers SET name = ?, updated_at = ? WHERE id = ?')
      .bind('Jüngerer Name', LATER, created.id).run();

    expect(await updateAdminCustomer(
      env.DB,
      created.id,
      created.updatedAt,
      input({ name: 'Alter Name', customerCode: 'altercode' }),
      '2026-08-28T12:00:00.000Z',
    )).toBe('conflict');
    expect(await env.DB.prepare('SELECT name FROM customers WHERE id = ?').bind(created.id).first()).toEqual({ name: 'Jüngerer Name' });
    expect(await findAccountByIdentifier(env.DB, 'cafemorgen')).not.toBeNull();
    expect(await findAccountByIdentifier(env.DB, 'altercode')).toBeNull();
  });

  it('ersetzt eine PIN sicher, zeigt sie nie an und setzt Sperrdaten zurück', async () => {
    const oldCredential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    await createAdminCustomer(env.DB, input(), oldCredential, NOW);
    const [created] = await loadAdminCustomerWorkspace(env.DB);
    if (!created) throw new Error('Kunde fehlt');
    await env.DB.prepare(
      'UPDATE auth_accounts SET failed_attempts = 5, locked_until = ? WHERE customer_id = ?',
    ).bind('2026-08-28T12:00:00.000Z', created.id).run();
    const nextCredential = await deriveCredential('87654321', PEPPER, { iterations: MIN_ITERATIONS });

    expect(await resetAdminCustomerPin(env.DB, created.id, 'cafemorgen', nextCredential, LATER)).toBe('updated');
    const account = await findAccountByIdentifier(env.DB, 'cafemorgen');
    expect(await verifyCredential('00123456', PEPPER, account!.credential)).toBe(false);
    expect(await verifyCredential('87654321', PEPPER, account!.credential)).toBe(true);
    expect(account).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('verändert bei Stammdatenänderungen keine historische Bestellung', async () => {
    const credential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    await createAdminCustomer(env.DB, input(), credential, NOW);
    const [created] = await loadAdminCustomerWorkspace(env.DB);
    if (!created) throw new Error('Kunde fehlt');
    await env.DB.prepare(
      `INSERT INTO orders
         (order_number, customer_id, customer_name_snapshot, fulfillment_type,
          fulfillment_date, delivery_address_snapshot, status, total_amount_cents, created_at, updated_at)
       VALUES ('BUS-2026-000001', ?, 'Alter Kundenname', 'delivery', '2026-08-29',
               'Alte Straße 1, 40213 Düsseldorf', 'new', 2200, ?, ?)`,
    ).bind(created.id, NOW, NOW).run();

    await updateAdminCustomer(env.DB, created.id, created.updatedAt, input({
      name: 'Neuer Kundenname', deliveryAddress: null, defaultFulfillment: 'pickup',
    }), LATER);
    expect(await env.DB.prepare(
      'SELECT customer_name_snapshot, fulfillment_type, delivery_address_snapshot FROM orders',
    ).first()).toEqual({
      customer_name_snapshot: 'Alter Kundenname', fulfillment_type: 'delivery',
      delivery_address_snapshot: 'Alte Straße 1, 40213 Düsseldorf',
    });
  });
});

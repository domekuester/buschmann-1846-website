import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { FulfillmentDate } from '../../src/domain/fulfillment-date';
import { Money } from '../../src/domain/money';
import { Order } from '../../src/domain/order';
import { OrderItem } from '../../src/domain/order-item';
import { OrderNumber } from '../../src/domain/order-number';
import {
  MAX_OPERATOR_RECIPIENTS,
  normalizeEmailAddress,
  normalizeOperatorRecipients,
} from '../../src/domain/email-notification-settings';
import {
  renderCustomerOrderConfirmationEmail,
  renderOperatorNewOrderEmail,
} from '../../src/application/email-templates';
import { MemoryEmailSender, NoProviderEmailSender } from '../../src/infrastructure/email/email-sender';

function order(): Order {
  return Order.restore({
    orderNumber: OrderNumber.fromString('BUS-2026-000123'),
    customerId: 7,
    customerNameSnapshot: 'Café <Morgen> & Söhne',
    fulfillmentType: 'delivery',
    fulfillmentDate: FulfillmentDate.restore('2026-09-02'),
    deliveryAddressSnapshot: 'Musterweg 8, 40213 Düsseldorf',
    note: 'Bitte <kühl> & pünktlich',
    status: 'new',
    items: [
      new OrderItem({
        productId: 11,
        productNameSnapshot: 'Zitronen-Cheesecake <frisch>',
        productUnitSnapshot: 'Stück & Serviette',
        unitPrice: Money.fromCents(435),
        quantity: 3,
        unitCost: Money.fromCents(120),
      }),
    ],
    createdAt: '2026-08-29T08:15:00.000Z',
    updatedAt: '2026-08-29T08:15:00.000Z',
  });
}

describe('E-Mail-Adressen', () => {
  it('trimmt und normalisiert eine gültige Adresse', () => {
    expect(normalizeEmailAddress('  Claudia@Example.TEST  ')).toBe('claudia@example.test');
  });

  it('lehnt eine ungültige Adresse sauber ab', () => {
    expect(() => normalizeEmailAddress('keine-adresse')).toThrow(ValidationError);
  });

  it('entfernt leere und doppelte Empfänger in stabiler Reihenfolge', () => {
    expect(normalizeOperatorRecipients([
      ' Claudia@Example.TEST ', '', 'gregor@example.test', 'claudia@example.test', '   ',
    ])).toEqual(['claudia@example.test', 'gregor@example.test']);
  });

  it('begrenzt die Zahl eindeutiger Empfänger', () => {
    const recipients = Array.from(
      { length: MAX_OPERATOR_RECIPIENTS + 1 },
      (_, index) => `betrieb-${index}@example.test`,
    );
    expect(() => normalizeOperatorRecipients(recipients)).toThrow(ValidationError);
  });
});

describe('Deutsche E-Mail-Inhalte', () => {
  it('enthält in der Betreiberbenachrichtigung die wesentlichen Bestelldaten', () => {
    const message = renderOperatorNewOrderEmail(order(), 'betrieb@example.test', 'https://orders.example.test');

    expect(message.subject).toBe('Neue Bestellung BUS-2026-000123 – Café <Morgen> & Söhne');
    for (const expected of [
      'Neue Bestellung', 'BUS-2026-000123', 'Café <Morgen> & Söhne', 'Lieferung',
      '02.09.2026', '3 × Zitronen-Cheesecake <frisch>', '13,05 €',
    ]) {
      expect(message.text).toContain(expected);
    }
    expect(message.text).toContain('https://orders.example.test/admin/orders?date=2026-09-02#bestellungen');
  });

  it('bestätigt dem Kunden nur den Eingang und verwendet Snapshotpreise', () => {
    const message = renderCustomerOrderConfirmationEmail(order(), 'kunde@example.test');

    expect(message.subject).toBe('Ihre Bestellung bei Buschmann ist eingegangen');
    expect(message.text).toContain('Ihre Bestellung ist bei uns eingegangen.');
    expect(message.text).toContain('3 × Zitronen-Cheesecake <frisch> · 4,35 € · 13,05 €');
    expect(message.text).toContain('Lieferung');
    expect(message.text).toContain('02.09.2026');
    expect(message.text).not.toMatch(/versendet|garantiert|bestätigt und wird/i);
  });

  it('escaped alle dynamischen Werte im HTML', () => {
    const operator = renderOperatorNewOrderEmail(order(), 'betrieb@example.test');
    const customer = renderCustomerOrderConfirmationEmail(order(), 'kunde@example.test');

    expect(operator.html).toContain('Café &lt;Morgen&gt; &amp; Söhne');
    for (const html of [operator.html, customer.html]) {
      expect(html).toContain('Zitronen-Cheesecake &lt;frisch&gt;');
      expect(html).not.toContain('<frisch>');
    }
    expect(operator.html).not.toContain('<Morgen>');
    expect(customer.html).toContain('Bitte &lt;kühl&gt; &amp; pünktlich');
  });

  it('gibt keine internen Kosten-, Margen- oder technischen Kennungen preis', () => {
    for (const message of [
      renderOperatorNewOrderEmail(order(), 'betrieb@example.test'),
      renderCustomerOrderConfirmationEmail(order(), 'kunde@example.test'),
    ]) {
      const content = `${message.subject}\n${message.text}\n${message.html}`;
      expect(content).not.toMatch(/Herstellkosten|Marge|Rohertrag|unit_cost|customerId|productId/i);
      expect(content).not.toContain('120');
    }
  });
});

describe('Sendergrenze', () => {
  it('zeichnet mit dem Testsender Nachrichten deterministisch auf', async () => {
    const sender = new MemoryEmailSender();
    const message = renderCustomerOrderConfirmationEmail(order(), 'kunde@example.test');
    await sender.send(message);
    expect(sender.messages).toEqual([message]);
  });

  it('meldet ohne konfigurierten Provider ehrlich unavailable', async () => {
    await expect(new NoProviderEmailSender().send(
      renderCustomerOrderConfirmationEmail(order(), 'kunde@example.test'),
    )).resolves.toEqual({ kind: 'unavailable' });
  });
});

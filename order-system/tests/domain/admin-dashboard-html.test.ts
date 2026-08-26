import { describe, expect, it } from 'vitest';
import type { DashboardDay, DashboardOrder } from '../../src/domain/dashboard-day';
import { PAYMENT_STATUSES } from '../../src/domain/payment-status';
import { renderAdminDashboardPage } from '../../src/ui/admin-dashboard-html';
import { toDashboardView } from '../../src/ui/dashboard-view';

const TAG = '2026-08-28';

function bestellung(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
  return {
    orderNumber: 'BUS-2026-000001',
    customerId: 1,
    customerName: 'Fiktives Café Nord',
    status: 'new',
    paymentStatus: 'unpaid',
    fulfillmentType: 'pickup',
    totalCents: 4350,
    createdAt: '2026-08-25T07:12:00.000Z',
    items: [
      {
        productId: 1,
        productName: 'Fiktiver Käsekuchen',
        productUnit: 'Stück',
        sortOrder: 10,
        quantity: 2,
      },
    ],
    ...overrides,
  };
}

function tag(overrides: Partial<DashboardDay> = {}): DashboardDay {
  return {
    date: TAG,
    orderCount: 1,
    cancelledCount: 0,
    revenueCents: 4350,
    openCount: 1,
    customerCount: 1,
    totalUnits: 2,
    unpaidCents: 4350,
    unpaidCount: 1,
    orders: [bestellung()],
    topProducts: [
      { productId: 1, productName: 'Fiktiver Käsekuchen', productUnit: 'Stück', quantity: 2 },
    ],
    ...overrides,
  };
}

function seite(overrides: Partial<DashboardDay> = {}, noticeCode: string | null = null): string {
  return renderAdminDashboardPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'test-csrf-token',
    day: toDashboardView(tag(overrides)),
    noticeCode,
  });
}

describe('toDashboardView', () => {
  it('schreibt den Tag deutsch aus und kennt seine Nachbarn', () => {
    const view = toDashboardView(tag());

    expect(view.day).toBe(TAG);
    expect(view.dayLabel).toBe('Freitag, 28. August 2026');
    expect(view.previousDay).toBe('2026-08-27');
    expect(view.nextDay).toBe('2026-08-29');
  });

  it('formatiert Umsatz und offenen Betrag als deutsche Eurobeträge', () => {
    const view = toDashboardView(tag({ revenueCents: 123456, unpaidCents: 4350 }));

    expect(view.revenueLabel).toBe('1.234,56 €');
    expect(view.unpaidLabel).toBe('43,50 €');
  });

  it('übernimmt die Kennzahlen unverändert, statt sie neu zu rechnen', () => {
    const view = toDashboardView(
      tag({ orderCount: 7, openCount: 3, customerCount: 4, totalUnits: 22, cancelledCount: 2 }),
    );

    expect(view.orderCount).toBe(7);
    expect(view.openCount).toBe(3);
    expect(view.customerCount).toBe(4);
    expect(view.totalUnits).toBe(22);
    expect(view.cancelledCount).toBe(2);
  });

  it('nennt einen Tag ohne jede Bestellung leer', () => {
    const leer = toDashboardView(
      tag({ orders: [], orderCount: 0, cancelledCount: 0, topProducts: [], revenueCents: 0 }),
    );
    expect(leer.isEmpty).toBe(true);
    expect(toDashboardView(tag()).isEmpty).toBe(false);
  });

  it('nennt einen Tag mit ausschließlich stornierten Bestellungen NICHT leer', () => {
    const view = toDashboardView(
      tag({
        orders: [bestellung({ status: 'cancelled' })],
        orderCount: 0,
        cancelledCount: 1,
        revenueCents: 0,
        topProducts: [],
      }),
    );

    expect(view.isEmpty).toBe(false);
  });

  it('beschriftet jede Bestellzeile für Menschen', () => {
    const view = toDashboardView(tag());
    const zeile = view.orders[0];

    expect(zeile?.statusLabel).toBe('Neu');
    expect(zeile?.paymentStatusLabel).toBe('Offen');
    expect(zeile?.amountLabel).toBe('43,50 €');
    expect(zeile?.orderedAtLabel).toBe('25.08.2026, 09:12');
    expect(zeile?.fulfillmentLabel).toBe('Abholung');
  });

  it('kennzeichnet eine stornierte Bestellung', () => {
    const view = toDashboardView(tag({ orders: [bestellung({ status: 'cancelled' })] }));
    expect(view.orders[0]?.isCancelled).toBe(true);
    expect(view.orders[0]?.statusLabel).toBe('Storniert');
  });

  it('unterscheidet bezahlt von offen', () => {
    const offen = toDashboardView(tag({ orders: [bestellung({ paymentStatus: 'unpaid' })] }));
    const bezahlt = toDashboardView(tag({ orders: [bestellung({ paymentStatus: 'paid_card' })] }));

    expect(offen.orders[0]?.isPaid).toBe(false);
    expect(bezahlt.orders[0]?.isPaid).toBe(true);
    expect(bezahlt.orders[0]?.paymentStatusLabel).toBe('Karte bezahlt');
  });
});

describe('renderAdminDashboardPage — Gerüst', () => {
  it('trägt den Tag in Titel und Überschrift', () => {
    const html = seite();
    expect(html).toContain('<title>Dashboard 2026-08-28 — Buschmann 1846</title>');
    expect(html).toContain('Freitag, 28. August 2026');
  });

  it('benennt den Tagesbezug ausdrücklich als Produktionstag', () => {
    expect(seite()).toContain('Produktionstag');
  });

  it('führt die Adminnavigation mit dem Dashboard als aktueller Seite', () => {
    const html = seite();
    expect(html).toContain('<a href="/admin/dashboard" aria-current="page">Dashboard</a>');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/catalog"');
    expect(html).toContain('href="/admin/customers"');
  });

  it('navigiert tageweise über echte Links auf das Dashboard', () => {
    const html = seite();
    expect(html).toContain('href="/admin/dashboard?date=2026-08-27"');
    expect(html).toContain('href="/admin/dashboard?date=2026-08-29"');
    expect(html).toContain('action="/admin/dashboard"');
  });

  it('führt zur Produktionsansicht desselben Tages', () => {
    expect(seite()).toContain('href="/admin?date=2026-08-28"');
  });

  it('trägt kein Skript', () => {
    expect(seite()).not.toContain('<script');
  });

  /**
   * Die Bestelltabelle hat SECHS Spalten — mehr als jede andere Adminseite.
   * In der 44rem-Spalte der übrigen Seiten brach der Browser Bestellnummern
   * und Beträge Zeichen für Zeichen um („BUS- 2026 -000 104", „26 ,1 0 €").
   * Der Befund kam aus dem Browser und nicht aus dem Entwurf; die Seite sagt
   * deshalb im Körper an, dass sie die breitere Spalte braucht.
   */
  it('kennzeichnet sich als Seite mit breiter Spalte', () => {
    expect(seite()).toContain('<body class="adminseite adminseite--breit">');
  });

  it('lässt die übrigen Adminseiten schmal', () => {
    expect(seite()).toContain('adminseite--breit');
  });
});

describe('renderAdminDashboardPage — Kennzahlen', () => {
  it('zeigt die sechs Kennzahlen des Tages', () => {
    const html = seite({
      orderCount: 7,
      revenueCents: 123456,
      openCount: 3,
      customerCount: 4,
      totalUnits: 22,
      unpaidCents: 4350,
      unpaidCount: 2,
    });

    expect(html).toContain('Bestellungen');
    expect(html).toContain('Umsatz');
    expect(html).toContain('1.234,56 €');
    expect(html).toContain('Offen');
    expect(html).toContain('Kunden');
    expect(html).toContain('Einheiten');
    expect(html).toContain('Noch nicht bezahlt');
    expect(html).toContain('43,50 €');
  });

  it('weist stornierte Bestellungen getrennt aus', () => {
    const html = seite({
      orderCount: 2,
      cancelledCount: 1,
      orders: [bestellung(), bestellung({ orderNumber: 'BUS-2026-000002', status: 'cancelled' })],
    });

    expect(html).toContain('1 storniert');
  });

  it('schweigt über die Stornozahl, wenn es keine gibt', () => {
    // Der Dauerhinweis „ohne stornierte" an der Umsatzkarte bleibt: Er
    // erklärt, WAS die Zahl ist, und gilt an jedem Tag. Was verschwinden
    // soll, ist die ZÄHLUNG — „davon 0 storniert" wäre Rauschen.
    expect(seite({ cancelledCount: 0 })).not.toMatch(/davon \d+ storniert/);
    expect(seite({ cancelledCount: 3 })).toMatch(/davon 3 storniert/);
  });

  it('zeigt für einen Tag ohne Bestellungen keine Kennzahlenwand', () => {
    const html = seite({
      orders: [],
      orderCount: 0,
      revenueCents: 0,
      openCount: 0,
      customerCount: 0,
      totalUnits: 0,
      unpaidCents: 0,
      unpaidCount: 0,
      topProducts: [],
    });

    expect(html).not.toContain('Noch nicht bezahlt');
    expect(html).toContain('Für diesen Tag liegt noch keine Bestellung vor');
  });
});

describe('renderAdminDashboardPage — Bestellliste', () => {
  it('zeigt Bestellnummer, Kunde, Status, Betrag und Zeitpunkt', () => {
    const html = seite();

    expect(html).toContain('BUS-2026-000001');
    expect(html).toContain('Fiktives Café Nord');
    expect(html).toContain('Neu');
    expect(html).toContain('43,50 €');
    expect(html).toContain('25.08.2026, 09:12');
  });

  it('markiert eine stornierte Bestellung sichtbar als solche', () => {
    const html = seite({ orders: [bestellung({ status: 'cancelled' })] });
    expect(html).toContain('Storniert');
  });

  /**
   * Der Befund kam aus dem Browser: Auf 375px brach „Testcafé Nord ·
   * Abholung" hinter dem Namen um, und die zweite Zeile begann mit einem
   * einsamen Trennpunkt. Die Abholart steht deshalb als EIGENE Zeile da und
   * nicht als angehängter Zusatz — wie Bestellnummer und Bestellzeitpunkt in
   * der Spalte davor.
   */
  it('setzt die Abholart als eigene Zeile ohne Trennzeichen', () => {
    const html = seite();
    expect(html).toContain('<span class="bestellzeile__art">Abholung</span>');
    expect(html).not.toContain('· Abholung');
  });

  it('escapet Kundennamen', () => {
    const html = seite({
      orders: [bestellung({ customerName: '<script>alert(1)</script>' })],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderAdminDashboardPage — Zahlungsstatus ändern', () => {
  it('gibt jeder Bestellung ein echtes POST-Formular', () => {
    const html = seite();
    expect(html).toContain(
      'method="post" action="/api/admin/orders/BUS-2026-000001/payment"',
    );
  });

  it('legt den CSRF-Token in jedes Formular', () => {
    const html = seite({
      orders: [bestellung(), bestellung({ orderNumber: 'BUS-2026-000002' })],
    });

    expect(html.split('name="csrf_token"').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('bietet genau die fünf bekannten Zahlungsstände an', () => {
    const html = seite();
    for (const status of PAYMENT_STATUSES) {
      expect(html).toContain(`value="${status}"`);
    }
    expect(html).toContain('Bar bezahlt');
    expect(html).toContain('Überweisung bezahlt');
  });

  it('wählt den gespeicherten Stand vor', () => {
    const html = seite({ orders: [bestellung({ paymentStatus: 'paid_bank' })] });
    expect(html).toContain('value="paid_bank" selected');
  });

  it('gibt jedem Auswahlfeld ein Label mit der Bestellnummer', () => {
    expect(seite()).toContain('Zahlungsstatus für Bestellung BUS-2026-000001');
  });

  it('bietet auch für eine stornierte Bestellung ein Formular an', () => {
    const html = seite({ orders: [bestellung({ status: 'cancelled' })] });
    expect(html).toContain('action="/api/admin/orders/BUS-2026-000001/payment"');
  });
});

describe('renderAdminDashboardPage — Rückmeldungen', () => {
  it('bestätigt einen gespeicherten Zahlungsstand', () => {
    expect(seite({}, 'payment_saved')).toContain('Der Zahlungsstatus wurde gespeichert.');
  });

  it('sagt bei einem Fehlschlag, dass nichts gespeichert wurde', () => {
    for (const code of ['unknown_order', 'invalid', 'internal']) {
      expect(seite({}, code)).toContain('nicht gespeichert');
    }
  });

  it('zeigt für einen unbekannten Code gar keine Meldung', () => {
    const html = seite({}, 'nicht-existierender-code');
    expect(html).not.toContain('nicht-existierender-code');
    expect(html).not.toContain('role="status"');
  });
});

describe('renderAdminDashboardPage — Meistbestellt', () => {
  it('zeigt die Top-Produkte des Tages', () => {
    const html = seite({
      topProducts: [
        { productId: 2, productName: 'Fiktive Tarte', productUnit: 'Stück', quantity: 7 },
        { productId: 1, productName: 'Fiktiver Käsekuchen', productUnit: 'Stück', quantity: 2 },
      ],
    });

    expect(html).toContain('Meistbestellt');
    expect(html).toContain('Fiktive Tarte');
    expect(html.indexOf('Fiktive Tarte')).toBeLessThan(html.indexOf('Fiktiver Käsekuchen'));
  });

  it('lässt den Abschnitt weg, wenn es nichts zu zeigen gibt', () => {
    expect(seite({ topProducts: [] })).not.toContain('Meistbestellt');
  });
});

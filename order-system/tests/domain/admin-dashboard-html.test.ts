import { describe, expect, it } from 'vitest';
import {
  aggregateDashboardDay,
  type DashboardDay,
  type DashboardOrder,
} from '../../src/domain/dashboard-day';
import { PAYMENT_STATUSES } from '../../src/domain/payment-status';
import {
  renderAdminDashboardPage,
  renderAdminOverviewPage,
  renderAdminOrdersPage,
} from '../../src/ui/admin-dashboard-html';
import {
  toDashboardView,
  toOrderListView,
  toQuickDaysView,
  type OrderFilter,
} from '../../src/ui/dashboard-view';

const TAG = '2026-08-28';
const HEUTE = '2026-08-26';

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
    items: [position()],
    ...overrides,
  };
}

/**
 * Eine Position — standardmäßig OHNE gepflegte Herstellkosten.
 *
 * Der Standard ist der Altbestand: Vor Phase 7A trägt jede Position NULL.
 * Ein Test, der eine vollständige Kalkulation braucht, setzt sie
 * ausdrücklich — und keiner der älteren Tests behauptet sie versehentlich.
 */
function position(unitCostCents: number | null = null, quantity = 2) {
  return {
    productId: 1,
    productName: 'Fiktiver Käsekuchen',
    productUnit: 'Stück',
    sortOrder: 10,
    quantity,
    unitCostCents,
  };
}

/**
 * Der Prüftag entsteht aus der ECHTEN Aggregation und nicht aus einer
 * abgeschriebenen Zahlenliste.
 *
 * Vorher stand hier ein Literal mit neun von Hand gesetzten Summen. Es ließ
 * Prüffälle zu, die es in der Anwendung nicht geben kann — etwa „eine
 * stornierte Bestellung, und orderCount ist trotzdem 1" —, und es fiel beim
 * ersten neuen Feld in DashboardDay auseinander. Jetzt zählt dieselbe
 * Funktion wie im Betrieb; `overrides` gewinnt weiterhin, wo ein Test eine
 * bestimmte Zahl braucht.
 */
function tag(overrides: Partial<DashboardDay> = {}): DashboardDay {
  return {
    ...aggregateDashboardDay(TAG, overrides.orders ?? [bestellung()]),
    ...overrides,
  };
}

/**
 * Der Prüftag als vollständige Seitenansicht.
 *
 * Schnellwahl und Bestellliste entstehen aus DENSELBEN Funktionen wie im
 * Betrieb (toQuickDaysView, toOrderListView) und nicht aus abgeschriebenen
 * Werten — sonst prüfte die Seite gegen ein Ansichtsmodell, das es so
 * nirgends gibt.
 */
function seite(
  overrides: Partial<DashboardDay> = {},
  noticeCode: string | null = null,
  filter: OrderFilter = 'all',
): string {
  const day = toDashboardView(tag(overrides));

  return renderAdminDashboardPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'test-csrf-token',
    day,
    noticeCode,
    quickDays: toQuickDaysView(HEUTE, day.day, 'day'),
    orderList: toOrderListView(day, filter),
  });
}

function uebersichtsseite(overrides: Partial<DashboardDay> = {}): string {
  const day = toDashboardView(tag(overrides));

  return renderAdminOverviewPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'test-csrf-token',
    day,
    noticeCode: null,
    quickDays: toQuickDaysView(HEUTE, day.day, 'day'),
    orderList: toOrderListView(day, 'all'),
  });
}

function bestellseite(
  overrides: Partial<DashboardDay> = {},
  noticeCode: string | null = null,
): string {
  const day = toDashboardView(tag(overrides));

  return renderAdminOrdersPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'test-csrf-token',
    day,
    noticeCode,
    quickDays: toQuickDaysView(HEUTE, day.day, 'day'),
    orderList: toOrderListView(day, 'all'),
  });
}

describe('toDashboardView', () => {
  it('hält erlaubte Status- und Zahlungsaktionen im Bestellbereich gemeinsam erreichbar', () => {
    const html = bestellseite({ orders: [bestellung({ status: 'new' })] });

    expect(html).toContain('action="/api/admin/orders/BUS-2026-000001/status?workspace=orders"');
    expect(html).toContain('name="status" value="confirmed"');
    expect(html).toContain('>Bestätigen<span');
    expect(html).toContain('/admin/orders/BUS-2026-000001/cancel?workspace=orders');
    expect(html).toContain('action="/api/admin/orders/BUS-2026-000001/payment"');
  });

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

  it('führt die sechs Bereiche mit Übersicht als aktueller Seite', () => {
    const html = seite();
    expect(html).toContain('<a href="/admin" aria-current="page">Übersicht</a>');
    expect(html).toContain('href="/admin/orders"');
    expect(html).toContain('href="/admin/production"');
    expect(html).toContain('href="/admin/catalog"');
    expect(html).toContain('href="/admin/customers"');
    expect(html).toContain('href="/admin/settings"');
  });

  it('navigiert tageweise über echte Links auf das Dashboard', () => {
    const html = seite();
    expect(html).toContain('href="/admin/dashboard?date=2026-08-27"');
    expect(html).toContain('href="/admin/dashboard?date=2026-08-29"');
    expect(html).toContain('action="/admin/dashboard"');
  });

  it('führt zur Produktionsansicht desselben Tages', () => {
    expect(seite()).toContain('href="/admin/production?date=2026-08-28"');
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
    expect(seite()).toContain('<body class="adminseite adminseite--overview adminseite--breit">');
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
    // soll, ist die ZÄHLUNG — „zusätzlich 0 storniert" wäre Rauschen.
    //
    // „ZUSÄTZLICH" UND NICHT „DAVON" seit Phase 6A.1: orderCount zählt die
    // stornierten gar nicht mit (siehe domain/dashboard-day.ts). „davon 1
    // storniert" unter einer 5 behauptete, es seien vier übrig.
    expect(seite({ cancelledCount: 0 })).not.toMatch(/\d+ storniert/);
    expect(seite({ cancelledCount: 3 })).toMatch(/zusätzlich 3 storniert/);
    expect(seite({ cancelledCount: 3 })).not.toMatch(/davon 3 storniert/);
  });

  /**
   * SEIT PHASE 6A.1 STEHT DIE WAND AUCH AN EINEM LEEREN TAG.
   *
   * Vorher verschwand sie, und die Seite bestand aus einem Satz. Das sah aus
   * wie ein Ladefehler und nicht wie ein ruhiger Dienstag — und wer den Tag
   * durchblätterte, bekam bei jedem leeren Tag eine ANDERE Seite. Sechs
   * Nullen sind die ehrliche Antwort und stehen an derselben Stelle wie
   * sechs Zahlen.
   */
  it('zeigt für einen Tag ohne Bestellungen alle sechs Karten mit Null', () => {
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

    for (const label of [
      'Bestellungen',
      'Umsatz',
      'Offen / in Arbeit',
      'Kunden',
      'Einheiten',
      'Noch nicht bezahlt',
    ]) {
      expect(html).toContain(label);
    }

    expect(html).toContain('0,00 €');
    expect(html).toContain('Für diesen Tag liegt noch keine Bestellung vor');
  });

  /**
   * Ein leerer Tag ist kein Fehler. Die Seite darf ihn nicht wie einen
   * darstellen — `.banner` ist im ganzen System die Fehlerdarstellung.
   */
  it('stellt einen leeren Tag nicht als Fehler dar', () => {
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

    expect(html).not.toContain('class="banner"');
    expect(html).not.toContain('kennzahlkarte--betont');
  });
});

describe('renderAdminDashboardPage — Reihenfolge der Abschnitte', () => {
  /**
   * DIE SEITE FOLGT DEM ARBEITSTAG UND NICHT DEM DATENMODELL.
   *
   * Erst der Tag, dann die Zahlen, dann die Bestellungen — und zuletzt, wovon
   * am meisten weggeht. „Meistbestellt" stand bis Phase 6A.3 vor den
   * Bestellungen und schob damit die einzige Liste, an der etwas ZU TUN ist,
   * unter eine, die nur einordnet.
   *
   * Der Test misst Positionen im Quelltext, nicht Aussehen: Eine spätere
   * Umsortierung im Renderer fällt damit auf, auch wenn niemand die Seite
   * dabei ansieht.
   */
  it('stellt die Bestellungen vor die meistbestellten Produkte', () => {
    const html = seite();

    const kennzahlen = html.indexOf('kennzahlen-titel');
    const bestellungen = html.indexOf('bestellliste-titel');
    const topProdukte = html.indexOf('topprodukte-titel');

    expect(kennzahlen).toBeGreaterThan(-1);
    expect(bestellungen).toBeGreaterThan(kennzahlen);
    expect(topProdukte).toBeGreaterThan(bestellungen);
  });

  /**
   * Auch an einem Tag ohne Bestellungen: Der leere Abschnitt steht an
   * derselben Stelle wie der volle. Wer den Tag wechselt, soll dieselbe Seite
   * wiederfinden und nicht eine zweite.
   */
  it('behält die Reihenfolge an einem leeren Tag', () => {
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

    expect(html.indexOf('bestellliste-titel')).toBeGreaterThan(html.indexOf('kennzahlen-titel'));
    expect(html.indexOf('topprodukte-titel')).toBeGreaterThan(html.indexOf('bestellliste-titel'));
  });
});

describe('renderAdminDashboardPage — Ringe', () => {
  /**
   * DER RING IST DIE ZWEITFASSUNG, DIE LEGENDE IST DER INHALT.
   *
   * Jede Angabe des Diagramms muss als TEXT auf der Seite stehen. Wer die
   * Grafik nicht sieht — Screenreader, abgeschaltete Bilder, ein verwaschener
   * Tresenbildschirm — darf keine einzige Zahl verlieren.
   */
  it('nennt jede Angabe des Zahlungsrings als Text', () => {
    const html = seite({
      orders: [
        bestellung({ orderNumber: 'BUS-2026-000001', paymentStatus: 'paid_cash', totalCents: 1500 }),
        bestellung({ orderNumber: 'BUS-2026-000002', paymentStatus: 'unpaid', totalCents: 2500 }),
        bestellung({ orderNumber: 'BUS-2026-000003', paymentStatus: 'unpaid', totalCents: 1000 }),
      ],
    });

    expect(html).toContain('Bezahlt');
    expect(html).toContain('Noch offen');
    expect(html).toContain('1 Bestellung<');
    expect(html).toContain('2 Bestellungen');
    expect(html).toContain('15,00 €');
    expect(html).toContain('35,00 €');
  });

  /**
   * Der Statusring nennt jeden vorkommenden Status mit seinem deutschen Wort
   * und seiner Anzahl — und die stornierte Bestellung MIT, weil sie einen
   * Produktionsstatus hat, auch wenn sie in keiner Summe steht.
   */
  it('nennt jeden vorkommenden Bestellstatus als Text', () => {
    const html = seite({
      orders: [
        bestellung({ orderNumber: 'BUS-2026-000001', status: 'new' }),
        bestellung({ orderNumber: 'BUS-2026-000002', status: 'in_production' }),
        bestellung({ orderNumber: 'BUS-2026-000003', status: 'cancelled' }),
      ],
    });

    expect(html).toContain('ring__stueck--new');
    expect(html).toContain('ring__stueck--in_production');
    expect(html).toContain('ring__stueck--cancelled');
    expect(html).toContain('In Produktion');
  });

  /**
   * Ein Status, an dem heute keine Bestellung steht, bekommt kein Stück und
   * keine Legendenzeile. „Bestätigt: 0 Bestellungen" beantwortet keine Frage.
   */
  it('zeichnet keinen Status, an dem an diesem Tag nichts steht', () => {
    const html = seite({ orders: [bestellung({ status: 'new' })] });

    expect(html).toContain('ring__stueck--new');
    expect(html).not.toContain('ring__stueck--confirmed');
    expect(html).not.toContain('ring__stueck--completed');
  });

  /**
   * DIE STORNIERTE BESTELLUNG IST KEIN STÜCK DES ZAHLUNGSRINGS.
   *
   * Sie hat keinen Zahlungsanspruch und steht in keiner Summe des Tages. Wäre
   * sie ein drittes Stück, wäre die Gesamtzahl in der Mitte des Rings eine
   * Zahl, die auf dieser Seite sonst nirgends vorkommt. Sie steht deshalb als
   * Fußnote darunter — mit demselben Wort wie auf der Kennzahlenkarte.
   */
  it('führt eine stornierte Bestellung als Fußnote und nicht als Ringstück', () => {
    const html = seite({
      orders: [
        bestellung({ orderNumber: 'BUS-2026-000001', paymentStatus: 'unpaid' }),
        bestellung({ orderNumber: 'BUS-2026-000002', status: 'cancelled' }),
      ],
    });

    expect(html).toContain('zusätzlich 1 Bestellung storniert');
    expect(html).toContain('ringlegende__fussnote');
  });

  /**
   * DIE GRAFIK IST FÜR SCREENREADER NICHT DA.
   *
   * Sie trägt keine Angabe, die nicht daneben steht; vorgelesen ergäbe sie
   * „Grafik" ohne Inhalt. `focusable="false"` hält sie zusätzlich aus dem
   * Tabulaturweg.
   */
  it('hält die Grafik aus Vorlesereihenfolge und Tabulaturweg heraus', () => {
    const html = seite();

    expect(html).toContain('<svg class="ring__grafik" viewBox="0 0 42 42" aria-hidden="true" focusable="false">');
  });

  /**
   * DIE GEOMETRIE STEHT IN ATTRIBUTEN UND NICHT IN STILEN.
   *
   * Die CSP dieser Anwendung kennt `style-src 'self'` und kein
   * `'unsafe-inline'`. Ein `style="stroke-dasharray:…"` würde vom Browser
   * verworfen, und der Ring wäre leer — ohne Fehlermeldung und ohne dass ein
   * Test es merkt. Deshalb merkt es dieser.
   */
  it('kommt ohne ein einziges style-Attribut aus', () => {
    const html = seite();

    expect(html).toContain('stroke-dasharray="');
    expect(html).toContain('stroke-dashoffset="');
    expect(html).not.toContain('style="');
  });

  /**
   * DER LEERE TAG BEHÄLT BEIDE RINGE. Ein Diagramm, das an einem stillen Tag
   * verschwindet, macht die Seite an genau dem Tag unvollständig, an dem
   * jemand zum ersten Mal nachsieht, ob überhaupt etwas los ist.
   */
  it('zeigt an einem leeren Tag beide Ringe ohne Stücke', () => {
    const html = seite({ orders: [], topProducts: [] });

    expect(html).toContain('Zahlungen');
    expect(html).toContain('Bestellstatus');
    expect(html).toContain('ring__spur');
    expect(html).not.toContain('ring__stueck');
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

  it('zeigt den E-Mail-Stand kurz unter der Bestellnummer und ohne reine Farbbedeutung', () => {
    const html = seite({
      orders: [bestellung({ emailSummary: { status: 'failed', count: 2 } })],
    });

    expect(html).toContain('E-Mail: Fehlgeschlagen (2)');
    expect(html).not.toContain('<th scope="col">E-Mail</th>');
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

  it('zeigt einen gespeicherten Bestellstatus im Bestellbereich als Erfolg', () => {
    const html = bestellseite({}, 'status_saved');

    expect(html).toContain('Der Bestellstatus wurde gespeichert.');
    expect(html).toContain('class="kundenmeldung kundenmeldung--erfolg"');
    expect(html).not.toContain('class="banner kundenmeldung"');
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

  /**
   * SEIT PHASE 6A.1 BLEIBT DIE TAFEL STEHEN. Ein Abschnitt, der an leeren
   * Tagen verschwindet, ist an leeren Tagen unbekannt: Wer die Seite zum
   * ersten Mal an einem ruhigen Dienstag sieht, weiß nicht, dass es ihn
   * gibt. Ein Satz an derselben Stelle sagt, was fehlt.
   */
  it('behält den Abschnitt mit einem ruhigen Satz, wenn es nichts zu zeigen gibt', () => {
    const html = seite({ topProducts: [] });

    expect(html).toContain('Meistbestellt');
    expect(html).toContain('Für diesen Tag ist noch kein Produkt bestellt');
    expect(html).not.toContain('class="topliste"');
  });
});

describe('renderAdminOverviewPage — Betriebszentrale', () => {
  it('führt vier primäre Signale und die Produktionsliste als Tagesfokus', () => {
    const html = uebersichtsseite();
    expect(html.match(/class="kennzahlkarte[^_]/g)).toHaveLength(4);
    expect(html).toContain('Produktion heute');
    expect(html).toContain('Als Nächstes');
  });
});

/**
 * PHASE 7B — DER FINANZBEREICH DER TAGESANSICHT.
 *
 * §19 des Auftrags. Geprüft wird die AUSGELIEFERTE SEITE und nicht nur das
 * Ansichtsmodell: Eine Marge, die im Modell fehlt und im HTML doch dasteht,
 * wäre genau der Fehler, den diese Phase verhindern soll.
 */
describe('§19.15 — die vollständig kalkulierte Tagesansicht', () => {
  /** Umsatz 1.240,00 €, Kosten 510,30 € — das Beispiel aus §3 des Auftrags. */
  const vollstaendig = () => ({
    orders: [
      bestellung({
        totalCents: 124_000,
        items: [position(51_030, 1)],
      }),
    ],
  });

  it('zeigt Umsatz, Herstellkosten, Rohertrag und Marge', () => {
    const html = seite(vollstaendig());

    expect(html).toContain('Finanzen');
    expect(html).toContain('Umsatz');
    expect(html).toContain('Herstellkosten');
    expect(html).toContain('Rohertrag');
    expect(html).toContain('Marge');

    expect(html).toContain('1.240,00 €');
    expect(html).toContain('510,30 €');
    expect(html).toContain('729,70 €');
    expect(html).toContain('58,8 %');
  });

  it('kennzeichnet die Kostenbasis als vollständig', () => {
    const html = seite(vollstaendig());

    expect(html).toContain('Kostenbasis vollständig');
    expect(html).not.toContain('Kostenbasis unvollständig');
  });

  it('nennt, wie viele Bestellungen kalkuliert sind', () => {
    expect(seite(vollstaendig())).toContain('Alle 1 Bestellung ist vollständig kalkuliert.');
  });

  it('führt bei vollständiger Basis NICHT zur Kostenpflege', () => {
    /**
     * Ein Weg, an dessen Ende nichts zu tun ist, ist eine Einladung ins
     * Leere — er steht nur da, wenn tatsächlich etwas fehlt.
     */
    expect(seite(vollstaendig())).not.toContain('Herstellkosten ergänzen');
  });

  it('setzt den Finanzbereich zwischen Handlungsbedarf und Ringe', () => {
    const html = seite(vollstaendig());

    expect(html.indexOf('handlung-titel')).toBeLessThan(html.indexOf('finanzen-titel'));
    expect(html.indexOf('finanzen-titel')).toBeLessThan(html.indexOf('zahlungsring-titel'));
  });

  it('gibt dem Bereich eine eigene Überschrift für Screenreader', () => {
    expect(seite(vollstaendig())).toContain('aria-labelledby="finanzen-titel"');
  });
});

describe('§19.16 und §19.17 — die unvollständige Kostenbasis', () => {
  /**
   * Vier Bestellungen, eine davon ohne Kostenwert. Der Umsatz stimmt, die
   * Marge gibt es nicht.
   */
  const unvollstaendig = () => ({
    orders: [
      bestellung({ orderNumber: 'BUS-2026-000001', totalCents: 10_000, items: [position(2000, 1)] }),
      bestellung({ orderNumber: 'BUS-2026-000002', totalCents: 10_000, items: [position(2000, 1)] }),
      bestellung({ orderNumber: 'BUS-2026-000003', totalCents: 10_000, items: [position(2000, 1)] }),
      bestellung({ orderNumber: 'BUS-2026-000004', totalCents: 10_000, items: [position(null, 1)] }),
    ],
  });

  it('zeigt keine Gesamtmarge', () => {
    const html = seite(unvollstaendig());

    expect(html).toContain('Kostenbasis unvollständig');
    expect(html).not.toMatch(/\d,\d\s%/);
  });

  it('zeigt auch keinen Rohertrag und keine Gesamtkosten', () => {
    /**
     * §2 — DIE TEILSUMME IST DIE GEFÄHRLICHERE HALBWAHRHEIT. „Herstellkosten
     * 60,00 €" neben „Umsatz 400,00 €" liest sich vollständig, ganz gleich,
     * was darunter steht.
     */
    const html = seite(unvollstaendig());

    expect(html).not.toContain('60,00 €');
    expect(html).not.toContain('340,00 €');
  });

  it('zeigt den Umsatz weiterhin vollständig und richtig', () => {
    expect(seite(unvollstaendig())).toContain('400,00 €');
  });

  it('nennt, bei wie vielen Bestellungen die Kosten fehlen', () => {
    expect(seite(unvollstaendig())).toContain(
      'Bei 1 von 4 Bestellungen fehlen noch die Herstellkosten.',
    );
  });

  it('zählt mehrere Lücken richtig', () => {
    const html = seite({
      orders: [
        bestellung({ orderNumber: 'BUS-2026-000001', totalCents: 10_000, items: [position(2000, 1)] }),
        bestellung({ orderNumber: 'BUS-2026-000002', totalCents: 10_000, items: [position(null, 1)] }),
        bestellung({ orderNumber: 'BUS-2026-000003', totalCents: 10_000, items: [position(null, 1)] }),
      ],
    });

    expect(html).toContain('Bei 2 von 3 Bestellungen fehlen noch die Herstellkosten.');
  });

  it('setzt den Strich als Zeichen und lässt die Zelle nicht leer', () => {
    const html = seite(unvollstaendig());
    const bereich = html.slice(html.indexOf('finanzen-titel'), html.indexOf('ringzone'));

    expect(bereich.match(/—/g)?.length).toBe(3);
  });

  /** §19.18 — der Weg zur Kostenpflege. */
  it('führt zur bestehenden Adminseite Sortiment & Preise', () => {
    const html = seite(unvollstaendig());

    expect(html).toContain('Herstellkosten ergänzen');
    expect(html).toContain('href="/admin/catalog#herstellkosten"');
  });

  it('legt keine zweite Kostenpflegeseite an', () => {
    expect(seite(unvollstaendig())).not.toContain('/admin/kosten');
  });

  it('bleibt ein Hinweis und wird kein Fehlerbanner', () => {
    /**
     * §8 und §24 — deutlich, aber nicht alarmistisch. Kein role="alert",
     * keine Fehlerfläche: Fehlende Kosten sind kein Fehler, sondern etwas,
     * das noch nicht gepflegt ist.
     */
    const html = seite(unvollstaendig());
    const bereich = html.slice(html.indexOf('finanzen-titel'), html.indexOf('ringzone'));

    expect(bereich).not.toContain('role="alert"');
    expect(bereich).not.toContain('class="banner"');
  });
});

describe('§14 — der Tag ohne Umsatz', () => {
  it('zeigt an einem leeren Tag keine Marge und kein NaN', () => {
    const html = seite({ orders: [] });

    expect(html).toContain('Finanzen');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).toContain('Keine Umsätze an diesem Tag.');
  });

  it('zeigt an einem leeren Tag trotzdem 0,00 € Umsatz und Kosten', () => {
    const html = seite({ orders: [] });
    const bereich = html.slice(html.indexOf('finanzen-titel'), html.indexOf('ringzone'));

    expect(bereich.match(/0,00 €/g)?.length).toBe(3);
  });

  it('zeigt an einem vollständig stornierten Tag keine Marge', () => {
    const html = seite({
      orders: [bestellung({ status: 'cancelled', totalCents: 5000, items: [position(100, 1)] })],
    });

    expect(html).not.toMatch(/\d,\d\s%/);
    expect(html).toContain('Keine Umsätze an diesem Tag.');
  });
});

describe('§15 — der negative Rohertrag auf der Seite', () => {
  const verlusttag = () => ({
    orders: [bestellung({ totalCents: 10_000, items: [position(12_000, 1)] })],
  });

  it('zeigt ihn mit Vorzeichen statt ihn auf null zu klemmen', () => {
    const html = seite(verlusttag());

    expect(html).toContain('-20,00 €');
    expect(html).toContain('-20,0 %');
  });

  it('kennzeichnet ihn zusätzlich für die Darstellung', () => {
    // Rohertrag UND Marge — beide stehen unter null, beide werden gekennzeichnet.
    expect(seite(verlusttag()).match(/finanzzeile--minus/g)?.length).toBe(2);
  });

  it('färbt einen Strich nicht ein, wo es gar keine Marge gibt', () => {
    /**
     * Ein Tag mit Kosten und ohne Umsatz — alles storniert — hätte einen
     * negativen Rohertrag, aber keine Marge. Ein roter Strich wäre eine
     * Farbe ohne Aussage.
     */
    const view = toDashboardView(
      tag({ orders: [bestellung({ status: 'cancelled', totalCents: 5000, items: [position(100, 1)] })] }),
    );

    expect(view.finance.marginLabel).toBe('—');
    expect(view.finance.isMarginNegative).toBe(false);
  });

  it('sagt es im Text und nicht nur in einer Farbe', () => {
    /**
     * §24 — Farbe ist auf diesen Seiten nie die einzige Aussage. Das
     * Minuszeichen steht im Text, und der Text ist die Auskunft.
     */
    const html = seite(verlusttag());
    expect(html).toMatch(/-20,00 €/);
  });
});

describe('§19.19 bis §19.21 — was 7B NICHT verändert', () => {
  const tagMitKosten = () => ({
    orders: [
      bestellung({ orderNumber: 'BUS-2026-000001', totalCents: 4350, items: [position(1000, 2)] }),
      bestellung({
        orderNumber: 'BUS-2026-000002',
        totalCents: 1290,
        paymentStatus: 'paid_cash',
        items: [position(300, 1)],
      }),
    ],
  });

  /** §19.19 — die Umsatzkennzahl ist unverändert. */
  it('lässt die Kennzahlenwand bei sechs Karten', () => {
    const html = seite(tagMitKosten());

    // Nur die Karten selbst — nicht ihre Innenteile (kennzahlkarte__label …).
    expect(html.match(/class="kennzahlkarte[^_]/g)?.length).toBe(6);
  });

  it('zeigt den Umsatz weiterhin als Hauptkennzahl', () => {
    const html = seite(tagMitKosten());

    expect(html).toContain('kennzahlkarte--haupt');
    expect(html).toContain('56,40 €');
  });

  it('nennt denselben Umsatz in der Kennzahl und im Finanzbereich', () => {
    const view = toDashboardView(tag(tagMitKosten()));

    expect(view.finance.revenueLabel).toBe(view.revenueLabel);
  });

  /** §19.20 — die Ringe bleiben, wie sie waren. */
  it('lässt beide Ringe unverändert stehen', () => {
    const html = seite(tagMitKosten());

    expect(html).toContain('id="zahlungsring-titel"');
    expect(html).toContain('id="statusring-titel"');
    expect(html.match(/class="tafel ringtafel"/g)?.length).toBe(2);
  });

  it('fügt keinen dritten Ring und keinen Margen-Donut hinzu', () => {
    const html = seite(tagMitKosten());

    expect(html.match(/<svg/g)?.length).toBe(2);
    expect(html).not.toContain('margenring');
    expect(html).not.toContain('kostenring');
  });

  /** §19.21 — der Handlungsbedarf bekommt keine Kostenzeile. */
  it('lässt den Handlungsbedarf unverändert', () => {
    const html = seite(tagMitKosten());
    const bereich = html.slice(html.indexOf('handlung-titel'), html.indexOf('finanzen-titel'));

    expect(bereich).not.toContain('Herstellkosten');
    expect(bereich).not.toContain('Kostenbasis');
  });

  it('erzeugt aus fehlenden Kosten keinen neuen Handlungspunkt', () => {
    const ohneKosten = seite({
      orders: [bestellung({ totalCents: 4350, items: [position(null, 2)] })],
    });
    const mitKosten = seite({
      orders: [bestellung({ totalCents: 4350, items: [position(1000, 2)] })],
    });

    const punkte = (html: string) => html.match(/class="handlung__punkt"/g)?.length ?? 0;
    expect(punkte(ohneKosten)).toBe(punkte(mitKosten));
  });

  it('lässt Meistbestellt und die Bestellliste unberührt', () => {
    const html = seite(tagMitKosten());

    expect(html).toContain('Meistbestellt');
    expect(html).toContain('id="bestellungen"');
    expect(html).toContain('Fiktiver Käsekuchen');
  });
});

describe('Der Finanzbereich als Ansichtsmodell', () => {
  it('trägt fertige Zeichenketten und keine Rechenarbeit für den Renderer', () => {
    const view = toDashboardView(
      tag({ orders: [bestellung({ totalCents: 124_000, items: [position(51_030, 1)] })] }),
    );

    expect(view.finance).toEqual({
      revenueLabel: '1.240,00 €',
      costLabel: '510,30 €',
      grossProfitLabel: '729,70 €',
      marginLabel: '58,8 %',
      isComplete: true,
      isNegative: false,
      isMarginNegative: false,
      statusLabel: 'Kostenbasis vollständig',
      note: 'Alle 1 Bestellung ist vollständig kalkuliert.',
      href: null,
      linkLabel: 'Herstellkosten ergänzen',
    });
  });

  it('setzt bei unvollständiger Basis überall den Strich', () => {
    const view = toDashboardView(
      tag({ orders: [bestellung({ totalCents: 10_000, items: [position(null, 1)] })] }),
    );

    expect(view.finance.revenueLabel).toBe('100,00 €');
    expect(view.finance.costLabel).toBe('—');
    expect(view.finance.grossProfitLabel).toBe('—');
    expect(view.finance.marginLabel).toBe('—');
    expect(view.finance.isComplete).toBe(false);
    expect(view.finance.href).toBe('/admin/catalog#herstellkosten');
  });

  it('erkennt den negativen Rohertrag für die Darstellung', () => {
    const view = toDashboardView(
      tag({ orders: [bestellung({ totalCents: 10_000, items: [position(12_000, 1)] })] }),
    );

    expect(view.finance.isNegative).toBe(true);
    expect(view.finance.isMarginNegative).toBe(true);
    expect(view.finance.grossProfitLabel).toBe('-20,00 €');
  });

  it('nennt einen Rohertrag von genau null nicht negativ', () => {
    const view = toDashboardView(
      tag({ orders: [bestellung({ totalCents: 10_000, items: [position(10_000, 1)] })] }),
    );

    expect(view.finance.isNegative).toBe(false);
    expect(view.finance.grossProfitLabel).toBe('0,00 €');
    expect(view.finance.marginLabel).toBe('0,0 %');
  });
});

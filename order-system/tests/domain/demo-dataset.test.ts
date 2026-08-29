import { describe, expect, it } from 'vitest';
import {
  CATALOG_PRODUCTS,
  CUSTOMERS,
  DEMO_POLICY,
  buildDemoDataset,
  buildOrders,
  demoSeedStatements,
  plusDays as demoPlusDays,
} from '../../scripts/demo/demo-dataset.mjs';
import {
  DEMO_ADMIN,
  DEMO_CUSTOMER_LOGINS,
  DEMO_PEPPER,
  DEMO_PORT,
  DEMO_URL,
} from '../../scripts/demo/demo-config.mjs';
import { deriveCredential } from '../../scripts/create-local-auth-account.mjs';
import { plusDays, weekdayIndex } from '../../src/domain/clock';
import { evaluateOrderAvailability, nextOrderableDay } from '../../src/domain/order-policy';
import type { OrderPolicy } from '../../src/domain/order-policy';
import { ORDER_STATUSES } from '../../src/domain/order-status';
import { PAYMENT_STATUSES } from '../../src/domain/payment-status';

/**
 * Der Demo-Bestand OHNE Datenbank.
 *
 * Hier steht die Hälfte, die nichts starten muss: Rechnet die Tagesarithmetik
 * richtig? Passt jede Bestellung zur Preisgruppe ihres Kunden? Ist der
 * Leittag vollständig kalkuliert? Erzeugt ein zweiter Lauf denselben Bestand?
 *
 * Die andere Hälfte — dass dieses SQL in einer echten D1 auch durchgeht —
 * steht in tests/d1/demo-seed.test.ts.
 */

/** Ein Tag, der bewusst NICHT „heute" ist: Der Bestand darf nicht daran hängen. */
const HEUTE = '2026-08-27';

type DemoCatalogProduct = {
  id: number;
  key: string;
  prices: Record<string, {
    type: 'fixed' | 'from' | 'range' | 'on_request';
    price_cents?: number;
    min_price_cents?: number;
    max_price_cents?: number;
  }>;
};

const CREDENTIAL_ARGS = {
  pepper: DEMO_PEPPER,
  // 1000 statt des Betriebswerts: Diese Datei prüft den BESTAND, nicht das
  // Ableitungsverfahren — das steht in credential.test.ts.
  iterations: 1000,
  deriveCredential,
  admin: DEMO_ADMIN,
  customerLogins: DEMO_CUSTOMER_LOGINS,
};

describe('Tagesarithmetik der Demo', () => {
  /**
   * Die Kopie von plusDays() im Skript MUSS Zeichen für Zeichen dasselbe
   * liefern wie die Domäne. Läuft sie auseinander, entsteht ein Bestand für
   * einen Tag, den die Anwendung nie anzeigt — und niemand merkt es, weil
   * beide für sich richtig aussehen.
   */
  it('stimmt über Monats-, Jahres- und Schaltjahresgrenzen mit der Domäne überein', () => {
    const proben = [
      '2026-01-31',
      '2026-02-27',
      '2026-12-30',
      '2028-02-28',
      '2028-02-29',
      '2027-03-01',
    ];

    for (const tag of proben) {
      for (const versatz of [-21, -14, -7, -1, 0, 1, 2, 3, 4, 30]) {
        expect(demoPlusDays(tag, versatz)).toBe(plusDays(tag, versatz));
      }
    }
  });
});

describe('Demo-Bestand', () => {
  it('verwendet den vollständigen normalisierten Buschmann-Katalog ohne doppelte Identitäten', () => {
    expect(CATALOG_PRODUCTS).toHaveLength(26);

    const schluessel = CATALOG_PRODUCTS.map((produkt: DemoCatalogProduct) => produkt.key);
    expect(new Set(schluessel).size).toBe(26);
    expect(schluessel).toContain('cake:new-york-cheese-classic:ring-26');
    expect(schluessel).toContain('seasonal:duesseldorf-christstollen:100g');
  });

  it('bewahrt beide Preislisten, alle Preisformen und einseitige Preise quelltreu', () => {
    const nachSchluessel = (key: string) => CATALOG_PRODUCTS.find(
      (produkt: DemoCatalogProduct) => produkt.key === key,
    ) as DemoCatalogProduct | undefined;

    expect(nachSchluessel('cake:new-york-cheese-classic:ring-26')?.prices).toEqual({
      gastro: { type: 'fixed', price_cents: 2200 },
      private: { type: 'fixed', price_cents: 4000 },
    });
    expect(nachSchluessel('cake:assorted-sheet')?.prices.private).toEqual({
      type: 'from', min_price_cents: 5500,
    });
    expect(nachSchluessel('seasonal:christmas-cookies:100g')?.prices.private).toEqual({
      type: 'range', min_price_cents: 300, max_price_cents: 450,
    });
    expect(nachSchluessel('cake:seasonal-assortment')?.prices).toEqual({
      private: { type: 'on_request' },
    });
    expect(nachSchluessel('cake:marble:ring-26')?.prices.private).toBeUndefined();
    expect(nachSchluessel('cake:marble:loaf-30')?.prices.gastro).toBeUndefined();
  });

  it('legt den Leittag auf morgen — die Voreinstellung aller Adminseiten', () => {
    const bestand = buildDemoDataset(HEUTE);
    expect(bestand.leittag).toBe(plusDays(HEUTE, 1));
  });

  it('enthält keine fest verdrahteten Kalenderdaten', () => {
    const frueh = buildOrders('2026-08-27');
    const spaet = buildOrders('2027-11-02');

    const tageFrueh = new Set(frueh.map((b) => b.fulfillmentDate));
    const tageSpaet = new Set(spaet.map((b) => b.fulfillmentDate));

    // Kein einziger Tag darf sich wiederholen, wenn sich „heute" verschiebt.
    for (const tag of tageFrueh) {
      expect(tageSpaet.has(tag)).toBe(false);
    }
  });

  it('füllt den Leittag mit fünf bis acht Bestellungen', () => {
    const bestand = buildDemoDataset(HEUTE);
    const amLeittag = bestand.orders.filter((b) => b.fulfillmentDate === bestand.leittag);

    expect(amLeittag.length).toBeGreaterThanOrEqual(5);
    expect(amLeittag.length).toBeLessThanOrEqual(8);
  });

  it('mischt Bestellstatus und Zahlungswege am Leittag', () => {
    const bestand = buildDemoDataset(HEUTE);
    const amLeittag = bestand.orders.filter((b) => b.fulfillmentDate === bestand.leittag);

    const status = new Set(amLeittag.map((b) => b.status));
    expect(status).toContain('new');
    expect(status).toContain('in_production');
    expect(status).toContain('completed');
    // Genau eine stornierte Bestellung — nicht keine und nicht zwei.
    expect(amLeittag.filter((b) => b.status === 'cancelled')).toHaveLength(1);

    const zahlung = new Set(amLeittag.map((b) => b.paymentStatus));
    expect(zahlung).toContain('unpaid');
    expect(zahlung).toContain('paid_cash');
    expect(zahlung).toContain('paid_card');
    expect(zahlung).toContain('paid_bank');
  });

  it('verwendet ausschließlich gültige Status- und Zahlungswerte', () => {
    for (const bestellung of buildDemoDataset(HEUTE).orders) {
      expect(ORDER_STATUSES).toContain(bestellung.status);
      expect(PAYMENT_STATUSES).toContain(bestellung.paymentStatus);
    }
  });

  it('bestellt für jeden Kunden zu seiner eigenen Preisgruppe', () => {
    for (const bestellung of buildDemoDataset(HEUTE).orders) {
      const kunde = CUSTOMERS.find((k) => k.id === bestellung.customerId);
      expect(kunde).toBeDefined();

      for (const position of bestellung.items) {
        const artikel = CATALOG_PRODUCTS.find(
          (a: DemoCatalogProduct) => a.id === position.productId + 200,
        ) as DemoCatalogProduct | undefined;
        const code = kunde?.priceListId === 2 ? 'private' : 'gastro';
        const preis = artikel?.prices[code];
        expect(preis?.type).toBe('fixed');
        expect(position.unitPriceCents).toBe(preis?.type === 'fixed' ? preis.price_cents : undefined);
      }
    }
  });

  it('lässt jede Demo-Bestellposition auf ein reales Katalogprodukt zeigen', () => {
    const produktIds = new Set(CATALOG_PRODUCTS.map(
      (produkt: DemoCatalogProduct) => produkt.id - 200,
    ));

    for (const bestellung of buildDemoDataset(HEUTE).orders) {
      for (const position of bestellung.items) {
        expect(produktIds.has(position.productId)).toBe(true);
      }
    }
  });

  it('rechnet jeden Positions- und Bestellbetrag aus Preis mal Menge', () => {
    for (const bestellung of buildDemoDataset(HEUTE).orders) {
      let summe = 0;
      for (const position of bestellung.items) {
        const { unitPriceCents, quantity, lineTotalCents } = position as {
          unitPriceCents: number;
          quantity: number;
          lineTotalCents: number;
        };
        expect(lineTotalCents).toBe(unitPriceCents * quantity);
        summe += lineTotalCents;
      }
      expect(bestellung.totalAmountCents).toBe(summe);
    }
  });

  it('trägt für jede Lieferung eine Adresse und für jede Abholung keine', () => {
    for (const bestellung of buildDemoDataset(HEUTE).orders) {
      if (bestellung.fulfillmentType === 'delivery') {
        expect(bestellung.deliveryAddress).toMatch(/, \d{5} /);
      } else {
        expect(bestellung.deliveryAddress).toBeNull();
      }
    }
  });

  it('vergibt jede Bestellnummer genau einmal', () => {
    const nummern = buildDemoDataset(HEUTE).orders.map((b) => b.orderNumber);
    expect(new Set(nummern).size).toBe(nummern.length);
  });

  it('hält die nächste laufende Nummer über allen vergebenen frei', () => {
    const bestand = buildDemoDataset(HEUTE);
    const hoechste = Math.max(
      ...bestand.orders.map((b) => Number(b.orderNumber.slice(-6))),
    );
    expect(bestand.nextOrderSequence).toBeGreaterThan(hoechste);
  });
});

describe('Kostenbasis der Demo', () => {
  it('kalkuliert den Leittag vollständig', () => {
    const bestand = buildDemoDataset(HEUTE);

    for (const bestellung of bestand.orders) {
      if (bestellung.fulfillmentDate !== bestand.leittag) continue;
      if (bestellung.status === 'cancelled') continue;

      for (const position of bestellung.items) {
        expect(position.unitCostCents).not.toBeNull();
      }
    }
  });

  /**
   * Die Lücke ist eine Zusage, keine Nachlässigkeit: Ohne sie ließe sich
   * „KOSTENBASIS UNVOLLSTÄNDIG" nicht vorführen — und niemand sähe, dass das
   * Dashboard fehlende Angaben zugibt, statt sie zu ersetzen.
   */
  it('lässt genau außerhalb des Leittags eine Kostenlücke stehen', () => {
    const bestand = buildDemoDataset(HEUTE);
    const luecken = bestand.orders.filter(
      (b) =>
        b.status !== 'cancelled' &&
        b.items.some((p) => p.unitCostCents === null),
    );

    expect(luecken.length).toBeGreaterThan(0);
    for (const bestellung of luecken) {
      expect(bestellung.fulfillmentDate).not.toBe(bestand.leittag);
    }
  });
});

describe('Bestellregeln der Demo', () => {
  const policy: OrderPolicy = {
    weekdays: DEMO_POLICY.weekdays,
    cutoffEnabled: DEMO_POLICY.cutoffEnabled,
    leadDays: DEMO_POLICY.leadDays,
    cutoffTime: DEMO_POLICY.cutoffTime,
  } as OrderPolicy;

  /**
   * DIE WICHTIGSTE ZUSAGE DER GANZEN PHASE: Keine Vorführung darf daran
   * scheitern, dass gerade Wochenende ist. Geprüft wird für jeden Wochentag
   * und für mehrere Uhrzeiten — nicht für „heute".
   */
  it('erlaubt an jedem Wochentag und zu jeder Bürozeit eine Bestellung', () => {
    for (let versatz = 0; versatz < 7; versatz += 1) {
      for (const stunde of [7, 9, 12, 15, 18, 21]) {
        const jetzt = new Date(Date.UTC(2026, 7, 24 + versatz, stunde - 2, 0, 0));
        expect(nextOrderableDay(policy, jetzt)).not.toBeNull();
      }
    }
  });

  /**
   * Und zwar bis 22:00 Uhr GENAU DEN LEITTAG — den Tag, den Dashboard und
   * Produktion ohnehin geöffnet haben. Wer vorher bestellt, sieht die neue
   * Bestellung sofort dort, wo er gerade war.
   */
  it('belegt bis zum Bestellschluss den Leittag vor', () => {
    for (let versatz = 0; versatz < 7; versatz += 1) {
      for (const stunde of [8, 12, 17, 21]) {
        // Europe/Berlin liegt im August zwei Stunden vor UTC.
        const jetzt = new Date(Date.UTC(2026, 7, 24 + versatz, stunde - 2, 0, 0));
        const heute = `2026-08-${String(24 + versatz).padStart(2, '0')}`;
        const morgen = plusDays(heute, 1);

        expect(evaluateOrderAvailability(policy, jetzt, morgen).allowed).toBe(true);
      }
    }
  });

  it('schaltet keinen Wochentag ab — sonst wäre der Leittag an einem Tag im Monat gesperrt', () => {
    for (let index = 0; index < 7; index += 1) {
      expect(DEMO_POLICY.weekdays[index]).toBe(true);
    }
    // Und der Leittag jedes Tages ist damit auch wirklich freigegeben.
    for (const tag of ['2026-08-24', '2026-08-29', '2026-08-30']) {
      expect(DEMO_POLICY.weekdays[weekdayIndex(plusDays(tag, 1))]).toBe(true);
    }
  });
});

describe('Demo-Seed als SQL', () => {
  it('räumt vor dem Schreiben auf — den Fremdschlüsseln folgend', async () => {
    const anweisungen = await demoSeedStatements({ heute: HEUTE, ...CREDENTIAL_ARGS });
    const loeschungen = anweisungen.filter((a) => a.startsWith('DELETE'));

    // order_items vor orders, products vor catalog_products, alles vor customers.
    const reihenfolge = loeschungen.map((a) => a.replace('DELETE FROM ', '').replace(';', ''));
    expect(reihenfolge.indexOf('order_items')).toBeLessThan(reihenfolge.indexOf('orders'));
    expect(reihenfolge.indexOf('orders')).toBeLessThan(reihenfolge.indexOf('customers'));
    expect(reihenfolge.indexOf('products')).toBeLessThan(reihenfolge.indexOf('catalog_products'));
    expect(reihenfolge.indexOf('auth_sessions')).toBeLessThan(reihenfolge.indexOf('auth_accounts'));
  });

  it('fasst price_lists und die Zeile in order_policy nicht an', async () => {
    const anweisungen = await demoSeedStatements({ heute: HEUTE, ...CREDENTIAL_ARGS });
    const alles = anweisungen.join('\n');

    expect(alles).not.toMatch(/DELETE FROM price_lists/);
    expect(alles).not.toMatch(/DELETE FROM order_policy/);
    expect(alles).not.toMatch(/INSERT INTO order_policy/);
    expect(alles).toMatch(/UPDATE order_policy SET/);
  });

  it('schreibt kein Geheimnis im Klartext', async () => {
    const alles = (await demoSeedStatements({ heute: HEUTE, ...CREDENTIAL_ARGS })).join('\n');

    expect(alles).not.toContain(DEMO_PEPPER);
    expect(alles).not.toContain(DEMO_ADMIN.secret);
    for (const login of DEMO_CUSTOMER_LOGINS) {
      expect(alles).not.toContain(login.pin);
    }
  });

  /**
   * Zwei Läufe erzeugen bis auf Salt und Verifier dasselbe SQL. Die beiden
   * Ausnahmen sind gewollt: Ein zufälliger Salt je Lauf ist genau das, was
   * ein Salt sein soll.
   */
  it('erzeugt bei jedem Lauf denselben Bestand', async () => {
    const ohneKonten = (anweisungen: readonly string[]) =>
      anweisungen.filter((a) => !a.includes('auth_accounts')).join('\n');

    const erster = await demoSeedStatements({ heute: HEUTE, ...CREDENTIAL_ARGS });
    const zweiter = await demoSeedStatements({ heute: HEUTE, ...CREDENTIAL_ARGS });

    expect(ohneKonten(zweiter)).toBe(ohneKonten(erster));
  });

  it('legt genau ein Admin- und drei Kundenkonten an', async () => {
    const anweisungen = await demoSeedStatements({ heute: HEUTE, ...CREDENTIAL_ARGS });
    const konten = anweisungen.find((a) => a.includes('INSERT INTO auth_accounts')) ?? '';

    expect(konten.match(/'admin'/g) ?? []).toHaveLength(1);
    expect(konten.match(/'customer'/g) ?? []).toHaveLength(DEMO_CUSTOMER_LOGINS.length);
    expect(konten).toContain(DEMO_ADMIN.identifier);
  });
});

describe('Feste Werte der Vorführung', () => {
  it('nennt Port und Adresse an genau einer Stelle und übereinstimmend', () => {
    expect(DEMO_PORT).toBe(8790);
    expect(DEMO_URL).toBe(`http://127.0.0.1:${DEMO_PORT}`);
  });

  it('hält die Demo-Zugangsdaten in der Form, die die Domäne verlangt', () => {
    // Ein Admin-Geheimnis braucht mindestens 16 Zeichen.
    expect(DEMO_ADMIN.secret.length).toBeGreaterThanOrEqual(16);
    // Ein Pepper mindestens 32.
    expect(DEMO_PEPPER.length).toBeGreaterThanOrEqual(32);

    for (const login of DEMO_CUSTOMER_LOGINS) {
      expect(login.pin).toMatch(/^[0-9]{8}$/);
      // Die Kennung muss sich zu sich selbst normalisieren lassen.
      expect(login.identifier.toLowerCase()).toMatch(/^[a-z0-9._@+-]+$/);
    }
  });

  it('zeigt mit jedem Kundenzugang einen anderen Preisfall', () => {
    const gruppen = DEMO_CUSTOMER_LOGINS.map(
      (login) => CUSTOMERS.find((k) => k.id === login.customerId)?.priceListId,
    );

    expect(gruppen).toContain(1); // Gastronomie
    expect(gruppen).toContain(2); // Privatkunden
    expect(gruppen).toContain(null); // noch nicht zugeordnet
  });
});

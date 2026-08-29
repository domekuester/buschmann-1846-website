/**
 * DER DATENBESTAND DER VORFÜHRUNG — als reine Funktion.
 *
 * Diese Datei kennt keine Datenbank, kein Wrangler und kein Dateisystem. Sie
 * bekommt einen Tag und einen Pepper und gibt SQL-Anweisungen zurück. Das ist
 * der Grund, warum sie geprüft werden kann, ohne etwas zu starten
 * (tests/domain/demo-dataset.test.ts), und warum derselbe Bestand in einem
 * D1-Test entsteht wie in der laufenden Demo (tests/d1/demo-seed.test.ts).
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  KUNDEN, ADRESSEN, HERSTELLKOSTEN UND BESTELLUNGEN SIND FREI          ║
 * ║  ERFUNDEN. Sortiment und Verkaufspreise kommen dagegen direkt aus    ║
 * ║  dem normalisierten Phase-5A-Katalog unter source-data/derived/.      ║
 * ║  Die Demo enthält weiterhin keine echten Buschmann-Kundendaten.      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * KEINE FESTEN KALENDERDATEN.
 *
 * Jeder Tag wird aus dem übergebenen `heute` gerechnet. Ein Bestand mit
 * '2026-08-27' darin wäre in vier Wochen ein leeres Dashboard — und die Demo
 * wäre genau dann kaputt, wenn niemand mehr damit rechnet. Das einzige
 * Literal mit Jahreszahl in dieser Datei ist die Zeitzone der Uhrzeiten, und
 * die hat keine.
 *
 * DER LEITTAG IST MORGEN.
 *
 * Dashboard, Produktionsansicht, Produktionsliste und Abholliste haben
 * dieselbe Voreinstellung: den nächsten Kalendertag (siehe
 * src/http/admin-dashboard-page.ts). Wer die Demo öffnet, sieht deshalb
 * MORGEN — und morgen ist hier der volle Betriebstag mit acht Bestellungen.
 * Ein Bestand, der HEUTE füllt, zeigte dem Betrachter eine leere Seite und
 * verlangte als Erstes einen Klick auf einen anderen Tag.
 */

import catalogSource from '../../source-data/derived/catalog-pricing.json' with { type: 'json' };
import { validateCatalogPricing } from '../catalog-pricing.mjs';

/**
 * Tagesarithmetik auf 'JJJJ-MM-TT'.
 *
 * Dieselbe Rechnung wie plusDays() in src/domain/clock.ts, hier ein zweites
 * Mal, weil dieses Skript in Node läuft und die Domäne in TypeScript für
 * workerd übersetzt wird — es gibt keinen gemeinsamen Modulbaum ohne
 * Build-Schritt. Dieselbe Lage wie bei scripts/create-local-auth-account.mjs,
 * und dieselbe Absicherung: tests/domain/demo-dataset.test.ts vergleicht
 * beide Funktionen über mehrere Monats- und Jahresgrenzen hinweg.
 *
 * Date.UTC ist hier korrekt und nicht etwa nachlässig: Gerechnet wird auf
 * einem KALENDER, nicht auf Zeitpunkten. Der 28. plus ein Tag ist der 29.,
 * unabhängig von Sommerzeit — genau deshalb steht die Zeitzone nirgends in
 * dieser Rechnung.
 */
export function plusDays(day, days) {
  const [jahr, monat, tag] = day.split('-').map(Number);
  const verschoben = new Date(Date.UTC(jahr, monat - 1, tag + days));
  return verschoben.toISOString().slice(0, 10);
}

/** Ein Zeitpunkt in ISO-8601-UTC, wie ihn die ganze Datenbank verlangt. */
function zeitpunkt(day, uhrzeit = '07:30:00') {
  return `${day}T${uhrzeit}.000Z`;
}

/** Einfache Anführungszeichen verdoppeln — SQLite-Literal. */
function text(value) {
  return value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
}

/** Zahl oder NULL. Für Spalten, in denen NULL ausdrücklich NICHT 0 bedeutet. */
function zahl(value) {
  return value === null || value === undefined ? 'NULL' : String(value);
}

/**
 * DIE PREISGRUPPEN kommen aus Migration 0012 und werden hier NICHT angelegt.
 * 1 = Gastronomie, 2 = Privatkunden.
 */
export const GASTRO = 1;
export const PRIVAT = 2;

/**
 * DAS SORTIMENT UND DIE VERKAUFSPREISE.
 *
 * Die normalisierte Phase-5A-Datei ist die einzige Wahrheit. Sie wird mit
 * demselben Validator gelesen wie der lokale Katalogimport. Ein Produkt mit
 * zwei Preislisten bleibt ein Produkt; fehlende Listenpreise und die Formen
 * fixed/from/range/on_request bleiben unverändert.
 *
 * `cost` ist ausdrücklich nur ein DEMO-WERT. Gepflegt sind die Artikel, die
 * für die Beispielbestellungen gebraucht werden. New York Cheese Frucht
 * bleibt offen und kommt nur außerhalb des Leittags vor: So bleibt der
 * Haupttag vollständig kalkuliert, während die unvollständige Kostenbasis
 * weiterhin ehrlich vorgeführt werden kann.
 */
const REAL_CATALOG = validateCatalogPricing(catalogSource);

const DEMO_COSTS = Object.freeze({
  'cake:new-york-cheese-classic:ring-26': 900,
  'cake:american-cheese-chocolate:ring-26': 940,
  'cake:covered-apple-vegan:ring-26': 880,
  'cake:apple-crumble-vegan:ring-26': 920,
  'cake:cheesecake:ring-26': 880,
  'cake:lemon-poppy:ring-or-loaf': 800,
});

export const CATALOG_PRODUCTS = Object.freeze(
  REAL_CATALOG.products.map((product, index) => Object.freeze({
    id: 201 + index,
    key: product.source_key,
    name: product.name,
    variant: product.variant,
    unit: product.unit,
    category: product.category,
    sort: product.sort_order,
    prices: Object.freeze(product.prices),
    cost: DEMO_COSTS[product.source_key] ?? null,
  })),
);

/**
 * DIE KUNDEN.
 *
 * Fünf Kunden, aber nur DREI ZUGÄNGE. Die beiden übrigen (Hotel Rheinblick,
 * Restaurant Alte Mühle) bestellen im Datenbestand mit und haben absichtlich
 * kein Konto: Ein Betriebstag mit zwei verschiedenen Bestellern sieht aus wie
 * eine Testdatei, einer mit vier sieht aus wie ein Dienstag. Drei
 * Anmeldemöglichkeiten reichen trotzdem völlig — mehr Zugangsdaten auf einem
 * Zettel wären in der Vorführung nur Ballast.
 *
 * `priceListId: null` bei der Konditorei ist KEIN vergessener Eintrag. Es ist
 * der Fall, den der Betreiber verstehen muss: Ein neu angelegter Kunde
 * bekommt nicht stillschweigend Gastropreise, sondern gar keine — er sieht
 * keine Preise und kann nichts bestellen, bis jemand entscheidet.
 */
export const CUSTOMERS = Object.freeze([
  {
    id: 1, name: 'Café Morgenrot', priceListId: GASTRO, fulfillment: 'delivery',
    street: 'Rheinstraße 12', postalCode: '40213', city: 'Düsseldorf',
    contact: 'Frau Alscher', phone: '0211 1234567',
  },
  {
    id: 2, name: 'Konditorei Rosengarten', priceListId: null, fulfillment: 'pickup',
    street: null, postalCode: null, city: null,
    contact: 'Herr Vogt', phone: '0211 2345678',
  },
  {
    id: 3, name: 'Familie Brenner', priceListId: PRIVAT, fulfillment: 'pickup',
    street: null, postalCode: null, city: null,
    contact: null, phone: '0211 3456789',
  },
  {
    id: 4, name: 'Hotel Rheinblick', priceListId: GASTRO, fulfillment: 'delivery',
    street: 'Uferweg 3', postalCode: '40221', city: 'Düsseldorf',
    contact: 'Herr Kaminski', phone: '0211 4567890',
  },
  {
    id: 5, name: 'Restaurant Alte Mühle', priceListId: GASTRO, fulfillment: 'pickup',
    street: null, postalCode: null, city: null,
    contact: 'Frau Teichmann', phone: '0211 5678901',
  },
]);

/**
 * DIE BESTELLREGELN DER VORFÜHRUNG.
 *
 * ALLE SIEBEN TAGE AN. Nicht, weil eine Bäckerei sonntags backt, sondern
 * weil der Leittag der Demo MORGEN ist — und morgen ist an jedem siebten Tag
 * ein Sonntag. Ein abgeschalteter Sonntag hieße: An einem Samstag zeigt das
 * Dashboard einen vollen Produktionstag, den die Bestellregeln zugleich für
 * unmöglich erklären. Im Betrieb schaltet Gregor die Tage ab, an denen er
 * nicht produziert; in der Vorführung darf kein Wochentag den Ablauf
 * zerlegen.
 *
 * BESTELLSCHLUSS EINEN TAG VORHER UM 22:00 UHR. Er ist EINGESCHALTET, weil
 * die Regel sonst nur als leerer Schalter zu sehen wäre. 22:00 ist so
 * gewählt, dass die Vorbelegung der Bestellseite zu jeder realistischen
 * Vorführungszeit auf dem Leittag steht: Für morgen kann bis heute 22:00 Uhr
 * bestellt werden. Wer später vorführt, bekommt keinen Fehler, sondern den
 * übernächsten Tag vorbelegt — die Seite erklärt das selbst.
 */
export const DEMO_POLICY = Object.freeze({
  weekdays: Object.freeze([true, true, true, true, true, true, true]),
  cutoffEnabled: true,
  leadDays: 1,
  cutoffTime: '22:00',
});

/**
 * DIE BESTELLUNGEN — als Beschreibung, nicht als SQL.
 *
 * `tag` ist der Versatz in Kalendertagen gegenüber HEUTE:
 *
 *    +1  der Leittag: der Tag, den Dashboard und Produktion von selbst öffnen
 *     0  heute: der bereits gelaufene Tag, hier steht die Kostenlücke
 *    +2  übermorgen: damit die Wochenansicht eine Verteilung hat
 *   -7 … -21  Vergangenheit: damit die Kundenhistorie eine Historie ist
 *
 * Die Beträge stehen NICHT in dieser Liste. Sie werden aus Preis mal Menge
 * gerechnet (siehe buildOrders) — genau wie es die Anwendung tut und wie es
 * das CHECK in Migration 0004 verlangt. Eine von Hand gepflegte Summe wäre
 * die zweite Wahrheit, die irgendwann von der ersten abweicht.
 */
const ORDER_PLAN = Object.freeze([
  // ── Der Leittag: acht Bestellungen, alle Status, alle Zahlungswege ────────
  { seq: 101, tag: 1, kunde: 1, status: 'completed',     zahlung: 'paid_bank', positionen: [['cake:new-york-cheese-classic:ring-26', 8], ['cake:cheesecake:ring-26', 6]] },
  { seq: 102, tag: 1, kunde: 4, status: 'in_production', zahlung: 'unpaid',    positionen: [['cake:apple-crumble-vegan:ring-26', 2], ['cake:lemon-poppy:ring-or-loaf', 3]] },
  { seq: 103, tag: 1, kunde: 5, status: 'confirmed',     zahlung: 'paid_card', positionen: [['cake:american-cheese-chocolate:ring-26', 6], ['cake:new-york-cheese-classic:ring-26', 4]] },
  { seq: 104, tag: 1, kunde: 3, status: 'new',           zahlung: 'unpaid',    positionen: [['cake:new-york-cheese-classic:ring-26', 2], ['cake:cheesecake:ring-26', 2]] },
  { seq: 105, tag: 1, kunde: 1, status: 'new',           zahlung: 'unpaid',    positionen: [['cake:lemon-poppy:ring-or-loaf', 2]] },
  { seq: 106, tag: 1, kunde: 5, status: 'confirmed',     zahlung: 'unpaid',    positionen: [['cake:apple-crumble-vegan:ring-26', 1], ['cake:american-cheese-chocolate:ring-26', 10]] },
  { seq: 107, tag: 1, kunde: 3, status: 'completed',     zahlung: 'paid_cash', positionen: [['cake:apple-crumble-vegan:ring-26', 1]] },
  // Genau eine stornierte Bestellung. Sie zählt nicht zum Umsatz, steht aber
  // sichtbar da — das Dashboard weist sie getrennt aus, statt sie zu
  // verschweigen.
  { seq: 108, tag: 1, kunde: 1, status: 'cancelled',     zahlung: 'unpaid',    positionen: [['cake:new-york-cheese-classic:ring-26', 5]] },

  // ── Heute: der Tag mit der Kostenlücke (New York Cheese Frucht) ──────────
  { seq: 109, tag: 0, kunde: 1, status: 'completed', zahlung: 'paid_bank', positionen: [['cake:new-york-cheese-fruit:ring-26', 4], ['cake:cheesecake:ring-26', 2]] },
  { seq: 110, tag: 0, kunde: 5, status: 'completed', zahlung: 'paid_cash', positionen: [['cake:new-york-cheese-classic:ring-26', 10]] },
  { seq: 111, tag: 0, kunde: 3, status: 'completed', zahlung: 'unpaid',    positionen: [['cake:cheesecake:ring-26', 2], ['cake:lemon-poppy:ring-or-loaf', 1]] },

  // ── Die kommenden Tage: damit die Woche nicht an einem Tag hängt ──────────
  //
  // VIER TAGE VORAUS UND NICHT NUR EINER. Die Wochenansicht beginnt am
  // Montag, der Leittag ist morgen — je nach Wochentag liegen davor null bis
  // sechs leere Tage. Bestellungen bis +4 sorgen dafür, dass an JEDEM
  // Wochentag mehrere Zeilen der Woche gefüllt sind und die Ansicht nicht
  // wie ein Ausfall aussieht.
  { seq: 112, tag: 2, kunde: 4, status: 'new', zahlung: 'unpaid', positionen: [['cake:new-york-cheese-classic:ring-26', 20]] },
  { seq: 113, tag: 2, kunde: 1, status: 'new', zahlung: 'unpaid', positionen: [['cake:apple-crumble-vegan:ring-26', 2], ['cake:cheesecake:ring-26', 3]] },
  { seq: 117, tag: 3, kunde: 4, status: 'new', zahlung: 'unpaid', positionen: [['cake:cheesecake:ring-26', 4], ['cake:lemon-poppy:ring-or-loaf', 1]] },
  { seq: 118, tag: 4, kunde: 5, status: 'new', zahlung: 'unpaid', positionen: [['cake:american-cheese-chocolate:ring-26', 12]] },

  // ── Vergangenheit: die Historie des Café Morgenrot ────────────────────────
  { seq: 114, tag: -7,  kunde: 1, status: 'completed', zahlung: 'paid_bank', positionen: [['cake:new-york-cheese-classic:ring-26', 10], ['cake:cheesecake:ring-26', 5]] },
  { seq: 115, tag: -14, kunde: 1, status: 'completed', zahlung: 'paid_bank', positionen: [['cake:lemon-poppy:ring-or-loaf', 4]] },
  { seq: 116, tag: -21, kunde: 1, status: 'completed', zahlung: 'paid_bank', positionen: [['cake:apple-crumble-vegan:ring-26', 3]] },
]);

/**
 * Die nächste freie laufende Nummer.
 *
 * Sie steht bewusst über der höchsten vergebenen: Eine in der Vorführung
 * aufgegebene Bestellung bekommt BUS-JJJJ-000121 und kann mit keiner
 * Seedzeile kollidieren. Ohne diesen Eintrag begänne die Vergabe bei 1 und
 * liefe nach hundert Vorführungen in die erste Dublette — abgefangen von
 * UNIQUE(order_number), aber als Fehlermeldung mitten in der Demo.
 */
const NEXT_ORDER_SEQUENCE = 120;

/** Der Preis eines Katalogprodukts in einer Preisgruppe, in Cent. */
function preis(artikel, priceListId) {
  const code = priceListId === PRIVAT ? 'private' : 'gastro';
  const wert = artikel?.prices[code];
  if (wert?.type !== 'fixed') {
    throw new Error(
      `Demo-Bestand: Katalogprodukt ${artikel?.key ?? 'unbekannt'} hat in Preisgruppe ${priceListId} keinen Festpreis. ` +
        'Nur Festpreisartikel dürfen in einer Bestellung vorkommen.',
    );
  }
  return wert.price_cents;
}

/**
 * Aus dem Plan werden Bestellungen: Tage aufgelöst, Preise nachgeschlagen,
 * Beträge gerechnet, Kostenschnappschüsse gesetzt.
 *
 * DER KOSTENSCHNAPPSCHUSS WIRD HIER GESETZT UND NICHT SPÄTER GERECHNET —
 * genauso, wie es place-cafe-order.ts beim echten Bestellen tut. Eine
 * Bestellung ist ein Dokument: Was sie gekostet hat, hat sie gekostet.
 */
export function buildOrders(heute) {
  return ORDER_PLAN.map((plan) => {
    const kunde = CUSTOMERS.find((c) => c.id === plan.kunde);
    if (kunde === undefined) {
      throw new Error(`Demo-Bestand: Bestellung ${plan.seq} verweist auf Kunde ${plan.kunde}.`);
    }
    if (kunde.priceListId === null) {
      throw new Error(
        `Demo-Bestand: Bestellung ${plan.seq} gehört zu Kunde ${kunde.name}, der keine Preisgruppe hat. ` +
          'Ein Kunde ohne Preisgruppe kann nicht bestellen — auch nicht im Seed.',
      );
    }

    const tag = plusDays(heute, plan.tag);
    const positionen = plan.positionen.map(([katalogKey, menge]) => {
      const artikel = CATALOG_PRODUCTS.find((p) => p.key === katalogKey);
      if (artikel === undefined) {
        throw new Error(`Demo-Bestand: Unbekanntes Katalogprodukt ${katalogKey}.`);
      }
      const einzelpreis = preis(artikel, kunde.priceListId);
      return {
        productId: artikel.id - 200,
        name: artikel.name,
        unit: artikel.unit,
        unitPriceCents: einzelpreis,
        quantity: menge,
        lineTotalCents: einzelpreis * menge,
        unitCostCents: artikel.cost ?? null,
      };
    });

    return {
      orderNumber: `BUS-${heute.slice(0, 4)}-${String(plan.seq).padStart(6, '0')}`,
      customerId: kunde.id,
      customerName: kunde.name,
      fulfillmentType: kunde.fulfillment,
      fulfillmentDate: tag,
      deliveryAddress:
        kunde.fulfillment === 'delivery'
          ? `${kunde.street}, ${kunde.postalCode} ${kunde.city}`
          : null,
      status: plan.status,
      paymentStatus: plan.zahlung,
      totalAmountCents: positionen.reduce((summe, p) => summe + p.lineTotalCents, 0),
      // Bestellt wurde am Vortag am späten Vormittag — die Uhrzeit, zu der ein
      // Café seinen Bedarf durchgibt.
      createdAt: zeitpunkt(plusDays(tag, -1), '09:20:00'),
      items: positionen,
    };
  });
}

/**
 * Der gesamte Bestand als Beschreibung. Keine Datenbank, kein SQL — der
 * Zwischenschritt, gegen den sich prüfen lässt, WAS gesät wird, bevor man
 * anschaut, WIE.
 */
export function buildDemoDataset(heute) {
  return {
    heute,
    leittag: plusDays(heute, 1),
    catalogProducts: CATALOG_PRODUCTS,
    orderableProducts: CATALOG_PRODUCTS.filter((product) => product.unit !== null),
    customers: CUSTOMERS,
    policy: DEMO_POLICY,
    orders: buildOrders(heute),
    nextOrderSequence: NEXT_ORDER_SEQUENCE,
  };
}

/** Die Preiszeile eines Katalogprodukts für eine Preisgruppe — oder null. */
function preiszeile(artikel, priceListId, jetzt) {
  const code = priceListId === PRIVAT ? 'private' : 'gastro';
  const preis = artikel.prices[code];
  if (preis === undefined) return null;

  const fest = preis.type === 'fixed' ? preis.price_cents : null;
  const minimum = preis.type === 'from' || preis.type === 'range' ? preis.min_price_cents : null;
  const maximum = preis.type === 'range' ? preis.max_price_cents : null;
  return `(${artikel.id}, ${priceListId}, ${text(preis.type)}, ${zahl(fest)}, ${zahl(minimum)}, ${zahl(maximum)}, ${text(jetzt)}, ${text(jetzt)})`;
}

/**
 * Die Anmeldekonten der Vorführung.
 *
 * DIE VERIFIER WERDEN BEI JEDEM SEED NEU GERECHNET, gegen den Pepper, mit dem
 * der Demo-Worker auch startet. Vorberechnete Hashes in einer SQL-Datei
 * wären genau so lange richtig, bis jemand den Pepper ändert — und dann wäre
 * das Ergebnis eine Demo, in der niemand sich anmelden kann.
 *
 * `deriveCredential` kommt aus scripts/create-local-auth-account.mjs und ist
 * damit dieselbe Rechnung, die auch der Worker anwendet
 * (tests/domain/create-local-auth-account.test.ts prüft das gegeneinander).
 *
 * DER SALT IST ZUFÄLLIG UND NICHT FEST. Zwei Seedläufe erzeugen deshalb
 * verschiedene Verifier für dieselbe PIN — und beide funktionieren. Ein fester
 * Salt hätte nur den Vorteil bytegleicher Zeilen und den Nachteil, das
 * Verfahren falsch vorzuführen.
 */
async function buildAccounts({ pepper, iterations, jetzt, deriveCredential, admin, customerLogins }) {
  const konten = [];

  const adminCredential = await deriveCredential(admin.secret, pepper, { iterations });
  konten.push({
    id: 1,
    identifier: admin.identifier.toLowerCase(),
    role: 'admin',
    customerId: null,
    credential: adminCredential,
    jetzt,
  });

  let id = 2;
  for (const login of customerLogins) {
    konten.push({
      id,
      identifier: login.identifier.toLowerCase(),
      role: 'customer',
      customerId: login.customerId,
      credential: await deriveCredential(login.pin, pepper, { iterations }),
      jetzt,
    });
    id += 1;
  }

  return konten;
}

/**
 * Der vollständige Seed als Liste einzelner SQL-Anweisungen.
 *
 * EINZELN UND NICHT ALS EINE ZEICHENKETTE: `wrangler d1 execute --file` und
 * `D1Database.batch()` wollen beide Anweisungen, und eine Liste lässt sich in
 * einem Test Zeile für Zeile anwenden. Die Reihenfolge ist verbindlich — die
 * DELETEs folgen den Fremdschlüsseln von innen nach außen, wie schon in
 * seeds/002_cafe_ordering_dev.sql.
 *
 * IDEMPOTENT DURCH LÖSCHEN. Jeder Lauf räumt zuerst auf und schreibt dann
 * denselben Bestand mit denselben Schlüsseln. Zweimal ausgeführt entsteht
 * derselbe Stand und keine Dublette — die Eigenschaft, an der `npm run demo`
 * hängt, weil es bei jedem Start seedet.
 *
 * NICHT ANGETASTET werden price_lists (kommt aus Migration 0012) und die
 * Zeile in order_policy (kommt aus 0016) — die eine wird nur gelesen, die
 * andere aktualisiert.
 */
export async function demoSeedStatements({
  heute,
  pepper,
  iterations,
  deriveCredential,
  admin,
  customerLogins,
}) {
  const bestand = buildDemoDataset(heute);
  const jetzt = zeitpunkt(heute, '06:00:00');
  const anweisungen = [];

  // ── Aufräumen, den Fremdschlüsseln folgend ────────────────────────────────
  anweisungen.push(
    'DELETE FROM order_items;',
    'DELETE FROM orders;',
    'DELETE FROM auth_sessions;',
    'DELETE FROM auth_accounts;',
    'DELETE FROM order_number_sequences;',
    'DELETE FROM products;',
    'DELETE FROM catalog_product_prices;',
    'DELETE FROM catalog_products;',
    'DELETE FROM customers;',
  );

  // ── Katalog: Identität, Einheit, Kategorie, Herstellkosten ────────────────
  anweisungen.push(
    'INSERT INTO catalog_products (id, source_key, name, variant, unit, category, is_active, sort_order, unit_cost_cents, created_at, updated_at) VALUES\n' +
      bestand.catalogProducts
        .map(
          (a) =>
            `    (${a.id}, ${text(a.key)}, ${text(a.name)}, ${text(a.variant)}, ${text(a.unit)}, ${text(a.category)}, 1, ${a.sort}, ${zahl(a.cost)}, ${text(jetzt)}, ${text(jetzt)})`,
        )
        .join(',\n') + ';',
  );

  const preiszeilen = [];
  for (const artikel of bestand.catalogProducts) {
    for (const liste of [GASTRO, PRIVAT]) {
      const zeile = preiszeile(artikel, liste, jetzt);
      if (zeile !== null) {
        preiszeilen.push(`    ${zeile}`);
      }
    }
  }
  anweisungen.push(
    'INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at) VALUES\n' +
      preiszeilen.join(',\n') + ';',
  );

  /**
   * DIE BESTELLPRODUKTE. price_cents steht auf 0 und BEDEUTET NICHTS: Seit
   * Phase 5C liest der Bestellfluss die Spalte nicht mehr, der Preis kommt
   * aus catalog_product_prices. Ein alter Wert stünde hier nur, um irgendwann
   * für einen Preis gehalten zu werden.
   */
  anweisungen.push(
    'INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order, catalog_product_id, created_at, updated_at) VALUES\n' +
      bestand.orderableProducts
        .map(
          (a) =>
            `    (${a.id - 200}, ${text(a.name)}, ${text(a.variant)}, 0, ${text(a.unit)}, 1, ${a.sort}, ${a.id}, ${text(jetzt)}, ${text(jetzt)})`,
        )
        .join(',\n') + ';',
  );

  // ── Kunden und ihre Preisgruppen ──────────────────────────────────────────
  anweisungen.push(
    'INSERT INTO customers (id, name, contact_person, email, phone, delivery_street, delivery_postal_code, delivery_city, is_active, default_fulfillment, price_list_id, internal_note, created_at, updated_at) VALUES\n' +
      bestand.customers
        .map(
          (k) =>
            `    (${k.id}, ${text(k.name)}, ${text(k.contact)}, NULL, ${text(k.phone)}, ${text(k.street)}, ${text(k.postalCode)}, ${text(k.city)}, 1, ${text(k.fulfillment)}, ${zahl(k.priceListId)}, NULL, ${text(jetzt)}, ${text(jetzt)})`,
        )
        .join(',\n') + ';',
  );

  // ── Anmeldekonten ─────────────────────────────────────────────────────────
  const konten = await buildAccounts({
    pepper,
    iterations,
    jetzt,
    deriveCredential,
    admin,
    customerLogins,
  });
  anweisungen.push(
    'INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id, credential_algorithm, credential_iterations, credential_salt, credential_verifier, is_active, failed_attempts, created_at, updated_at) VALUES\n' +
      konten
        .map(
          (k) =>
            `    (${k.id}, ${text(k.identifier)}, ${text(k.role)}, ${zahl(k.customerId)}, ${text(k.credential.algorithm)}, ${k.credential.iterations}, ${text(k.credential.saltHex)}, ${text(k.credential.verifierHex)}, 1, 0, ${text(jetzt)}, ${text(jetzt)})`,
        )
        .join(',\n') + ';',
  );

  // ── Bestellungen und Positionen ───────────────────────────────────────────
  anweisungen.push(
    'INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type, fulfillment_date, delivery_address_snapshot, note, status, total_amount_cents, payment_status, payment_recorded_at, created_at, updated_at) VALUES\n' +
      bestand.orders
        .map(
          (b) =>
            `    (${text(b.orderNumber)}, ${b.customerId}, ${text(b.customerName)}, ${text(b.fulfillmentType)}, ${text(b.fulfillmentDate)}, ${text(b.deliveryAddress)}, NULL, ${text(b.status)}, ${b.totalAmountCents}, ${text(b.paymentStatus)}, ${b.paymentStatus === 'unpaid' ? 'NULL' : text(b.createdAt)}, ${text(b.createdAt)}, ${text(b.createdAt)})`,
        )
        .join(',\n') + ';',
  );

  const positionszeilen = [];
  for (const bestellung of bestand.orders) {
    for (const position of bestellung.items) {
      positionszeilen.push(
        `    ((SELECT id FROM orders WHERE order_number = ${text(bestellung.orderNumber)}), ${position.productId}, ${text(position.name)}, ${text(position.unit)}, ${position.unitPriceCents}, ${position.quantity}, ${position.lineTotalCents}, ${zahl(position.unitCostCents)})`,
      );
    }
  }
  anweisungen.push(
    'INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot, unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot) VALUES\n' +
      positionszeilen.join(',\n') + ';',
  );

  anweisungen.push(
    `INSERT INTO order_number_sequences (year, next_value) VALUES (${Number(heute.slice(0, 4))}, ${bestand.nextOrderSequence});`,
  );

  // ── Bestellregeln: UPDATE, denn die Zeile kommt aus Migration 0016 ────────
  const p = bestand.policy;
  const an = (index) => (p.weekdays[index] === true ? 1 : 0);
  anweisungen.push(
    'UPDATE order_policy SET ' +
      `monday_enabled = ${an(0)}, tuesday_enabled = ${an(1)}, wednesday_enabled = ${an(2)}, ` +
      `thursday_enabled = ${an(3)}, friday_enabled = ${an(4)}, saturday_enabled = ${an(5)}, ` +
      `sunday_enabled = ${an(6)}, cutoff_enabled = ${p.cutoffEnabled ? 1 : 0}, ` +
      `lead_days = ${p.leadDays}, cutoff_time = ${text(p.cutoffTime)}, updated_at = ${text(jetzt)} ` +
      'WHERE id = 1;',
  );

  return anweisungen;
}

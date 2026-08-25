import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, canTransitionTo } from '../../src/domain/order-status';
import type { ProductionDay, ProductionOrder } from '../../src/domain/production-day';
import { toProductionDayView } from '../../src/ui/production-day-view';

/**
 * Das Ansichtsmodell — die Schicht zwischen dem Lesemodell aus Phase 3B und
 * dem HTML.
 *
 * Diese Tests laufen im Projekt „domain": ohne Worker, ohne D1, ohne Uhr.
 * Genau das ist die Probe darauf, dass die Aufbereitung rein ist — hinge sie
 * an einer Datenbank oder an Date.now(), liefen sie hier nicht.
 */

function bestellung(over: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    orderNumber: 'BUS-2026-000123',
    customerName: 'Testcafé Nord',
    status: 'confirmed',
    fulfillmentType: 'delivery',
    note: null,
    items: [
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', sortOrder: 10, quantity: 3 },
    ],
    ...over,
  };
}

function tag(over: Partial<ProductionDay> = {}): ProductionDay {
  return {
    date: '2026-08-25',
    orderCount: 1,
    totalUnits: 3,
    products: [
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 3 },
    ],
    orders: [bestellung()],
    ...over,
  };
}

describe('toProductionDayView — deutsche Labels', () => {
  it('bildet Status und Fulfillment auf deutsche Bezeichnungen ab', () => {
    const view = toProductionDayView(tag());

    expect(view.orders[0]?.statusLabel).toBe('Bestätigt');
    expect(view.orders[0]?.fulfillmentLabel).toBe('Lieferung');
  });
});

describe('toProductionDayView — Datum', () => {
  it('schreibt den Tag deutsch aus', () => {
    expect(toProductionDayView(tag()).dayLabel).toBe('Dienstag, 25. August 2026');
  });

  it('liefert den vorherigen Kalendertag', () => {
    const view = toProductionDayView(tag());
    expect(view.previousDay).toBe('2026-08-24');
    expect(view.previousDayLabel).toBe('Montag, 24. August 2026');
  });

  it('liefert den nächsten Kalendertag', () => {
    const view = toProductionDayView(tag());
    expect(view.nextDay).toBe('2026-08-26');
    expect(view.nextDayLabel).toBe('Mittwoch, 26. August 2026');
  });

  it('springt über den Monatswechsel', () => {
    expect(toProductionDayView(tag({ date: '2026-08-31' })).nextDay).toBe('2026-09-01');
    expect(toProductionDayView(tag({ date: '2026-09-01' })).previousDay).toBe('2026-08-31');
  });

  it('springt über den Jahreswechsel', () => {
    expect(toProductionDayView(tag({ date: '2026-12-31' })).nextDay).toBe('2027-01-01');
    expect(toProductionDayView(tag({ date: '2027-01-01' })).previousDay).toBe('2026-12-31');
  });

  /**
   * 2028 ist ein Schaltjahr. Ein Renderer, der Tage über „+86400 Sekunden auf
   * einer lokalen Zeit" rechnete, läge hier daneben.
   */
  it('kennt den 29. Februar eines Schaltjahres', () => {
    expect(toProductionDayView(tag({ date: '2028-02-28' })).nextDay).toBe('2028-02-29');
    expect(toProductionDayView(tag({ date: '2028-02-29' })).nextDay).toBe('2028-03-01');
    expect(toProductionDayView(tag({ date: '2028-03-01' })).previousDay).toBe('2028-02-29');
  });

  /** Und im Nicht-Schaltjahr gibt es ihn nicht. */
  it('überspringt den 29. Februar in einem Nicht-Schaltjahr', () => {
    expect(toProductionDayView(tag({ date: '2027-02-28' })).nextDay).toBe('2027-03-01');
  });
});

describe('toProductionDayView — Umbenennungsfall', () => {
  /**
   * Der Fall aus Phase 3B: dieselbe Produkt-ID, zwei Snapshot-Namen, bewusst
   * nicht zusammengefasst. Die Ansicht muss ihn kennzeichnen können, sonst
   * sieht er aus wie ein doppelter Eintrag.
   */
  it('markiert die abweichende Zeile derselben Produkt-ID', () => {
    const view = toProductionDayView(
      tag({
        products: [
          { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 11 },
          { productId: 1, productName: 'Klassischer Käsekuchen', productUnit: 'Stück', quantity: 3 },
        ],
      }),
    );

    expect(view.products[0]?.renamed).toBe(false);
    expect(view.products[1]?.renamed).toBe(true);
  });

  it('markiert auch eine abweichende Einheit derselben Produkt-ID', () => {
    const view = toProductionDayView(
      tag({
        products: [
          { productId: 1, productName: 'Beispiel Streusel', productUnit: 'Blech', quantity: 3 },
          { productId: 1, productName: 'Beispiel Streusel', productUnit: 'Stück', quantity: 8 },
        ],
      }),
    );

    expect(view.products[1]?.renamed).toBe(true);
  });

  /**
   * DIE GEGENPROBE, und sie ist die wichtigere: Zwei VERSCHIEDENE Produkte
   * mit zufällig gleichem Namen sind kein Umbenennungsfall. Ein Hinweis dort
   * wäre schlicht falsch — und genau das würde passieren, wenn über den Namen
   * statt über die ID gruppiert würde.
   */
  it('markiert zwei verschiedene Produkte mit gleichem Namen nicht', () => {
    const view = toProductionDayView(
      tag({
        products: [
          { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 11 },
          { productId: 2, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 4 },
        ],
      }),
    );

    expect(view.products.every((line) => !line.renamed)).toBe(true);
  });

  it('markiert eine einzelne Zeile nie', () => {
    expect(toProductionDayView(tag()).products[0]?.renamed).toBe(false);
  });

  /**
   * Der Snapshot ist der Snapshot. Es gibt in dieser Schicht gar keinen Weg
   * zu einem aktuellen Produktnamen — die Stammdaten werden nicht geladen.
   */
  it('reicht Snapshot-Namen und -Einheiten unverändert durch', () => {
    const view = toProductionDayView(
      tag({
        products: [
          { productId: 7, productName: 'Historische Bezeichnung', productUnit: 'Blech', quantity: 2 },
        ],
      }),
    );

    expect(view.products[0]?.name).toBe('Historische Bezeichnung');
    expect(view.products[0]?.unit).toBe('Blech');
  });
});

describe('toProductionDayView — Kennzahlen und leerer Tag', () => {
  it('übernimmt die Kennzahlen aus der Aggregation, ohne neu zu rechnen', () => {
    const view = toProductionDayView(tag({ orderCount: 8, totalUnits: 24 }));
    expect(view.orderCount).toBe(8);
    expect(view.totalUnits).toBe(24);
  });

  it('erkennt einen Tag ohne offene Bestellungen', () => {
    const view = toProductionDayView(
      tag({ orderCount: 0, totalUnits: 0, products: [], orders: [] }),
    );

    expect(view.isEmpty).toBe(true);
    expect(view.products).toEqual([]);
    expect(view.orders).toEqual([]);
  });

  it('ist bei vorhandenen Bestellungen nicht leer', () => {
    expect(toProductionDayView(tag()).isEmpty).toBe(false);
  });

  /**
   * Widersprüchliche Daten sind ein Befund und kein leerer Tag. Zeigte die
   * Seite hier „nichts zu tun", verschwände der Fehler still — und mit ihm
   * die Produktion.
   */
  it('gilt nicht als leer, wenn Zahlen und Zeilen sich widersprechen', () => {
    const view = toProductionDayView(
      tag({
        orderCount: 0,
        totalUnits: 3,
        products: [
          { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 3 },
        ],
        orders: [],
      }),
    );

    expect(view.isEmpty).toBe(false);
  });
});

describe('toProductionDayView — Notiz', () => {
  it('reicht eine vorhandene Notiz unverändert durch', () => {
    const view = toProductionDayView(
      tag({ orders: [bestellung({ note: 'Bitte vor 10 Uhr anliefern' })] }),
    );

    expect(view.orders[0]?.note).toBe('Bitte vor 10 Uhr anliefern');
  });

  it('behandelt eine fehlende Notiz als keine Notiz', () => {
    expect(toProductionDayView(tag()).orders[0]?.note).toBeNull();
  });

  /**
   * Ein versehentlich abgeschicktes Leerzeichen soll keinen Notizblock mit
   * leerem Inhalt erzeugen.
   */
  it('behandelt eine Notiz aus reinem Leerraum als keine Notiz', () => {
    for (const leer of ['', ' ', '   ', '\n', '\t\n ']) {
      const view = toProductionDayView(tag({ orders: [bestellung({ note: leer })] }));
      expect(view.orders[0]?.note).toBeNull();
    }
  });

  /** Aber der Inhalt einer echten Notiz wird nicht beschnitten. */
  it('verändert den Inhalt einer echten Notiz nicht', () => {
    const view = toProductionDayView(
      tag({ orders: [bestellung({ note: '  Rückseite\n  Klingel defekt  ' })] }),
    );

    expect(view.orders[0]?.note).toBe('  Rückseite\n  Klingel defekt  ');
  });
});

describe('toProductionDayView — Datensparsamkeit', () => {
  /**
   * Die Ansicht ist finanzfrei durch Bauart: Das Lesemodell führt keine
   * Preise, also kann diese Schicht keine übernehmen. Der Test hält fest,
   * dass niemand später eins hinzufügt.
   */
  it('trägt keine Preis-, Kosten- oder Betragsfelder', () => {
    const serialisiert = JSON.stringify(toProductionDayView(tag()));

    for (const verboten of ['price', 'cents', 'amount', 'total_amount', 'cost', 'margin']) {
      expect(serialisiert).not.toContain(verboten);
    }
  });

  /**
   * Interne Kennungen haben in der Backstube keinen Nutzen. Die Produkt-ID
   * wird für die Umbenennungserkennung GEBRAUCHT — sie darf sie aber nicht
   * verlassen, sonst stünde sie irgendwann auf dem Bildschirm.
   */
  it('trägt keine internen Kennungen nach außen', () => {
    const serialisiert = JSON.stringify(toProductionDayView(tag()));

    for (const verboten of ['productId', 'product_id', 'customerId', 'sortOrder', 'orderId']) {
      expect(serialisiert).not.toContain(verboten);
    }
  });

  it('trägt keine Kontaktdaten', () => {
    const serialisiert = JSON.stringify(toProductionDayView(tag()));

    for (const verboten of ['email', 'mail', 'phone', 'telefon', 'street', 'postal', 'address']) {
      expect(serialisiert.toLowerCase()).not.toContain(verboten);
    }
  });
});

describe('toProductionDayView — Bestellungen', () => {
  it('übernimmt Bestellnummer und Kundenname als Snapshot', () => {
    const view = toProductionDayView(
      tag({ orders: [bestellung({ orderNumber: 'BUS-2026-000999', customerName: 'Testcafé Süd' })] }),
    );

    expect(view.orders[0]?.orderNumber).toBe('BUS-2026-000999');
    expect(view.orders[0]?.customerName).toBe('Testcafé Süd');
  });

  it('bildet alle offenen Status deutsch ab', () => {
    const erwartet = { new: 'Neu', confirmed: 'Bestätigt', in_production: 'In Produktion' } as const;

    for (const [status, label] of Object.entries(erwartet)) {
      const view = toProductionDayView(
        tag({ orders: [bestellung({ status: status as 'new' })] }),
      );
      expect(view.orders[0]?.statusLabel).toBe(label);
    }
  });

  it('bildet Abholung deutsch ab', () => {
    const view = toProductionDayView(
      tag({ orders: [bestellung({ fulfillmentType: 'pickup' })] }),
    );

    expect(view.orders[0]?.fulfillmentLabel).toBe('Abholung');
  });

  it('übernimmt die Positionen mit Menge und Einheit', () => {
    const view = toProductionDayView(
      tag({
        orders: [
          bestellung({
            items: [
              { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', sortOrder: 10, quantity: 3 },
              { productId: 2, productName: 'Beispiel Streusel', productUnit: 'Blech', sortOrder: 20, quantity: 2 },
            ],
          }),
        ],
      }),
    );

    expect(view.orders[0]?.items).toEqual([
      { name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 },
      { name: 'Beispiel Streusel', unit: 'Blech', quantity: 2 },
    ]);
  });

  /**
   * Die Reihenfolge der Backliste kommt aus Phase 3B und wird hier nicht
   * angetastet. Eine zweite Sortierung wäre eine zweite Meinung darüber, wie
   * das Sortiment geordnet ist.
   */
  it('sortiert die Backliste nicht um', () => {
    const view = toProductionDayView(
      tag({
        products: [
          { productId: 3, productName: 'Zuletzt im Sortiment', productUnit: 'Stück', quantity: 1 },
          { productId: 1, productName: 'Als Erstes', productUnit: 'Stück', quantity: 9 },
        ],
      }),
    );

    expect(view.products.map((line) => line.name)).toEqual([
      'Zuletzt im Sortiment',
      'Als Erstes',
    ]);
  });
});

/**
 * DIE STATUSAKTIONEN — Phase 4B.
 *
 * Der Kern dieser Gruppe ist ein einziger Satz: Es gibt in der Oberfläche
 * KEINE zweite Übergangstabelle. Welche Schaltfläche erscheint, entscheidet
 * canTransitionTo() in domain/order-status.ts und sonst nichts.
 *
 * Deshalb steht in den Tests unten canTransitionTo() selbst auf der
 * Erwartungsseite und keine abgeschriebene Liste: Eine abgeschriebene Liste
 * wäre genau die zweite Fassung der Regel, die hier ausgeschlossen werden
 * soll — sie bliebe grün, wenn die Domäne sich änderte.
 */
describe('toProductionDayView — Statusaktionen', () => {
  it('bietet zu einer neuen Bestellung Bestätigen und Stornieren an', () => {
    const view = toProductionDayView(tag({ orders: [bestellung({ status: 'new' })] }));

    expect(view.orders[0]?.actions.map((aktion) => aktion.target)).toEqual([
      'confirmed',
      'cancelled',
    ]);
  });

  it('bietet zu einer bestätigten Bestellung Produktion starten und Stornieren an', () => {
    const view = toProductionDayView(tag({ orders: [bestellung({ status: 'confirmed' })] }));

    expect(view.orders[0]?.actions.map((aktion) => aktion.target)).toEqual([
      'in_production',
      'cancelled',
    ]);
  });

  it('bietet zu einer laufenden Produktion Abschließen und Stornieren an', () => {
    const view = toProductionDayView(tag({ orders: [bestellung({ status: 'in_production' })] }));

    expect(view.orders[0]?.actions.map((aktion) => aktion.target)).toEqual([
      'completed',
      'cancelled',
    ]);
  });

  /**
   * Endzustände. Sie tauchen in der offenen Produktionsliste nicht auf —
   * geprüft wird hier trotzdem, weil das Ansichtsmodell nicht filtert und
   * eine beschädigte Zeile sonst eine Schaltfläche bekäme, die nichts
   * bewirken kann.
   */
  it('bietet zu einer abgeschlossenen Bestellung keine Aktion an', () => {
    const view = toProductionDayView(tag({ orders: [bestellung({ status: 'completed' })] }));

    expect(view.orders[0]?.actions).toEqual([]);
  });

  it('bietet zu einer stornierten Bestellung keine Aktion an', () => {
    const view = toProductionDayView(tag({ orders: [bestellung({ status: 'cancelled' })] }));

    expect(view.orders[0]?.actions).toEqual([]);
  });

  /**
   * DER TEST GEGEN DIE ZWEITE STATE MACHINE.
   *
   * Für JEDEN Ausgangsstatus und JEDEN Zielstatus gilt: Die Aktion ist genau
   * dann da, wenn die Domäne den Übergang erlaubt. Würde die Oberfläche eine
   * eigene Liste führen, müsste sie hier auseinanderlaufen.
   */
  it('bietet genau die Übergänge an, die canTransitionTo erlaubt', () => {
    for (const von of ORDER_STATUSES) {
      const view = toProductionDayView(tag({ orders: [bestellung({ status: von })] }));
      const angeboten = view.orders[0]?.actions.map((aktion) => aktion.target) ?? [];

      expect({ von, ziele: angeboten }).toEqual({
        von,
        ziele: ORDER_STATUSES.filter((nach) => canTransitionTo(von, nach)),
      });
    }
  });

  it('gibt jeder Aktion ein verständliches deutsches Label', () => {
    const labels = new Map<string, string>();
    for (const von of ORDER_STATUSES) {
      const view = toProductionDayView(tag({ orders: [bestellung({ status: von })] }));
      for (const aktion of view.orders[0]?.actions ?? []) {
        labels.set(aktion.target, aktion.label);
      }
    }

    expect(Object.fromEntries(labels)).toEqual({
      confirmed: 'Bestätigen',
      in_production: 'Produktion starten',
      completed: 'Abschließen',
      cancelled: 'Stornieren',
    });
  });

  /** Kein Label trägt den technischen Statusnamen. */
  it('schreibt keine technischen Statusnamen auf die Schaltflächen', () => {
    for (const von of ORDER_STATUSES) {
      const view = toProductionDayView(tag({ orders: [bestellung({ status: von })] }));
      for (const aktion of view.orders[0]?.actions ?? []) {
        for (const technisch of ORDER_STATUSES) {
          expect(aktion.label).not.toContain(technisch);
        }
      }
    }
  });

  /**
   * Stornieren ist die einzige Aktion, die nichts voranbringt, sondern etwas
   * beendet. Die Oberfläche muss sie anders darstellen können — das ist eine
   * Frage der Darstellung und keine der Domäne, deshalb steht das Merkmal
   * hier und nicht in order-status.ts.
   */
  it('kennzeichnet ausschließlich das Stornieren als abbrechende Aktion', () => {
    for (const von of ORDER_STATUSES) {
      const view = toProductionDayView(tag({ orders: [bestellung({ status: von })] }));
      for (const aktion of view.orders[0]?.actions ?? []) {
        expect({ ziel: aktion.target, abbruch: aktion.destructive }).toEqual({
          ziel: aktion.target,
          abbruch: aktion.target === 'cancelled',
        });
      }
    }
  });

  /** Die abbrechende Aktion steht zuletzt und niemals vor dem Fortschritt. */
  it('stellt die abbrechende Aktion hinter die fortschreitende', () => {
    for (const von of ORDER_STATUSES) {
      const view = toProductionDayView(tag({ orders: [bestellung({ status: von })] }));
      const aktionen = view.orders[0]?.actions ?? [];
      const abbruch = aktionen.findIndex((aktion) => aktion.destructive);

      if (abbruch !== -1) {
        expect(abbruch).toBe(aktionen.length - 1);
      }
    }
  });
});

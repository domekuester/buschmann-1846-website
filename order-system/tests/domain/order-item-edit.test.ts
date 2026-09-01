import { describe, expect, it } from 'vitest';
import { OrderItem } from '../../src/domain/order-item';
import { planQuantityChanges, type EditableItemState } from '../../src/domain/order-item-edit';

/**
 * Die Mengenregel der Positionsbearbeitung — ohne Datenbank, ohne HTTP.
 *
 * Sie beantwortet genau eine Frage: Was ändert sich, wenn ein Admin ein
 * Formular mit Mengen abschickt? Alles andere — wer darf, was in die
 * Datenbank geht, wie der Gesamtbetrag entsteht — steht woanders.
 */

const AKTIV = (id: number, quantity: number): EditableItemState => ({
  id,
  quantity,
  cancelled: false,
});

const STORNIERT = (id: number, quantity: number): EditableItemState => ({
  id,
  quantity,
  cancelled: true,
});

describe('planQuantityChanges', () => {
  it('plant eine Verringerung von 5 auf 3', () => {
    const plan = planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: '3' }]);

    expect(plan).toEqual({
      outcome: 'planned',
      changes: [{ id: 1, previousQuantity: 5, newQuantity: 3 }],
    });
  });

  it('plant eine Erhöhung von 3 auf 5', () => {
    const plan = planQuantityChanges([AKTIV(1, 3)], [{ id: 1, quantity: '5' }]);

    expect(plan).toEqual({
      outcome: 'planned',
      changes: [{ id: 1, previousQuantity: 3, newQuantity: 5 }],
    });
  });

  /**
   * DER WICHTIGSTE FALL DIESER DATEI. Ein Formular schickt IMMER alle
   * Mengen mit, auch die unveränderten. Ohne diese Regel entstünde für jede
   * unangetastete Position eine Spur — und in dem Rauschen ginge die eine
   * echte Änderung unter. Die Datenbank lehnt „5 → 5" ohnehin ab (0022); hier
   * wird es gar nicht erst geplant.
   */
  it('plant nichts für eine unveränderte Menge', () => {
    const plan = planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: '5' }]);

    expect(plan).toEqual({ outcome: 'planned', changes: [] });
  });

  it('plant nur die tatsächlich geänderten Positionen', () => {
    const plan = planQuantityChanges(
      [AKTIV(1, 5), AKTIV(2, 3), AKTIV(3, 2)],
      [
        { id: 1, quantity: '3' },
        { id: 2, quantity: '3' },
        { id: 3, quantity: '7' },
      ],
    );

    expect(plan).toEqual({
      outcome: 'planned',
      changes: [
        { id: 1, previousQuantity: 5, newQuantity: 3 },
        { id: 3, previousQuantity: 2, newQuantity: 7 },
      ],
    });
  });

  it('übergeht eine Position, für die das Formular nichts sagt', () => {
    const plan = planQuantityChanges([AKTIV(1, 5), AKTIV(2, 3)], [{ id: 2, quantity: '4' }]);

    expect(plan).toEqual({
      outcome: 'planned',
      changes: [{ id: 2, previousQuantity: 3, newQuantity: 4 }],
    });
  });

  it('lehnt die Menge 0 ab — sie ist eine Stornierung und keine Menge', () => {
    expect(planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: '0' }])).toEqual({
      outcome: 'invalid_quantity',
      id: 1,
    });
  });

  it('lehnt eine negative Menge ab', () => {
    expect(planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: '-2' }])).toEqual({
      outcome: 'invalid_quantity',
      id: 1,
    });
  });

  it('lehnt eine gebrochene Menge ab', () => {
    expect(planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: '2.5' }])).toEqual({
      outcome: 'invalid_quantity',
      id: 1,
    });
  });

  it('lehnt ab, was keine Zahl ist', () => {
    for (const unsinn of ['', '   ', 'drei', 'NaN', 'Infinity', '1e3', '0x3', '3,5', null, undefined]) {
      expect(planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: unsinn }])).toEqual({
        outcome: 'invalid_quantity',
        id: 1,
      });
    }
  });

  it('lehnt eine unplausibel hohe Menge ab', () => {
    expect(
      planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: String(OrderItem.MAX_QUANTITY + 1) }]),
    ).toEqual({ outcome: 'invalid_quantity', id: 1 });
  });

  it('nimmt die höchste plausible Menge an', () => {
    expect(
      planQuantityChanges([AKTIV(1, 5)], [{ id: 1, quantity: String(OrderItem.MAX_QUANTITY) }]),
    ).toEqual({
      outcome: 'planned',
      changes: [{ id: 1, previousQuantity: 5, newQuantity: OrderItem.MAX_QUANTITY }],
    });
  });

  it('lehnt eine Position ab, die nicht zu dieser Bestellung gehört', () => {
    expect(planQuantityChanges([AKTIV(1, 5)], [{ id: 4711, quantity: '3' }])).toEqual({
      outcome: 'unknown_item',
      id: 4711,
    });
  });

  /**
   * Eine stornierte Position hat keine Menge mehr, die sich ändern ließe. Das
   * Formular zeigt für sie auch kein Eingabefeld — wer hier trotzdem eine
   * Menge schickt, arbeitet auf einem veralteten Bildschirm.
   */
  it('lehnt die Mengenänderung einer stornierten Position ab', () => {
    expect(planQuantityChanges([STORNIERT(1, 5)], [{ id: 1, quantity: '3' }])).toEqual({
      outcome: 'cancelled_item',
      id: 1,
    });
  });

  /**
   * ZWEIMAL DIESELBE POSITION IST KEIN PLAN, SONDERN EIN ANGRIFF AUF DEN
   * BATCH.
   *
   * Aus einem Formular kann das nicht kommen — die HTTP-Schicht baut ihre
   * Wünsche aus den Positionen der Bestellung und nicht aus den Feldnamen des
   * Körpers. Käme es trotzdem, entstünden zwei Anweisungen für dieselbe
   * Zeile: Die erste träfe, die zweite fände die alte Menge nicht mehr — und
   * der Vorgang wäre halb geschrieben, obwohl er als Konflikt gemeldet wird.
   * Die Regel steht deshalb hier, wo sie ohne Datenbank prüfbar ist.
   */
  it('lehnt dieselbe Position zweimal ab', () => {
    expect(
      planQuantityChanges(
        [AKTIV(1, 5)],
        [
          { id: 1, quantity: '3' },
          { id: 1, quantity: '4' },
        ],
      ),
    ).toEqual({ outcome: 'duplicate_item', id: 1 });
  });

  it('lehnt eine Wiederholung auch dann ab, wenn sie nichts ändert', () => {
    expect(
      planQuantityChanges(
        [AKTIV(1, 5)],
        [
          { id: 1, quantity: '5' },
          { id: 1, quantity: '5' },
        ],
      ),
    ).toEqual({ outcome: 'duplicate_item', id: 1 });
  });

  it('meldet die ERSTE ungültige Position und plant nichts', () => {
    const plan = planQuantityChanges(
      [AKTIV(1, 5), AKTIV(2, 3)],
      [
        { id: 1, quantity: '3' },
        { id: 2, quantity: '0' },
      ],
    );

    // Alles oder nichts: Eine ungültige Zeile verwirft auch die gültige davor.
    expect(plan).toEqual({ outcome: 'invalid_quantity', id: 2 });
  });
});

import { OrderNumber } from '../../domain/order-number';

/**
 * Vergibt die nächste laufende Nummer des Jahres.
 *
 * Der gesamte Vorgang ist EINE Anweisung. Das ist der Kern der Sache: Ein
 * "erst lesen, dann schreiben" — SELECT MAX(...) gefolgt von INSERT — hat
 * zwischen den beiden Schritten eine Lücke, in der zwei gleichzeitige
 * Bestellungen dieselbe Nummer bekämen. Der UPSERT hat diese Lücke nicht,
 * weil SQLite Schreibvorgänge serialisiert und RETURNING den vergebenen Wert
 * aus derselben Anweisung liefert.
 *
 * Lücken sind zulässig: Scheitert das anschließende Schreiben der Bestellung,
 * ist die Nummer verbraucht. Lückenlosigkeit ist eine Anforderung an
 * Rechnungsnummern, nicht an Bestellnummern. Die letzte Absicherung bleibt
 * ohnehin UNIQUE(order_number) auf orders.
 */
export async function reserveOrderNumber(db: D1Database, year: number): Promise<OrderNumber> {
  const row = await db
    .prepare(
      `INSERT INTO order_number_sequences (year, next_value)
            VALUES (?, 1)
       ON CONFLICT (year) DO UPDATE SET next_value = next_value + 1
         RETURNING next_value`,
    )
    .bind(year)
    .first<{ next_value: number }>();

  if (row === null) {
    throw new Error('Die Bestellnummer konnte nicht vergeben werden.');
  }
  return OrderNumber.fromYearAndSequence(year, row.next_value);
}

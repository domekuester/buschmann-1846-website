import { toUtcTimestamp } from './clock';

/**
 * Ob eine Bestellung bezahlt ist — und wie.
 *
 * DIESE DATEI IST NICHT order-status.ts, und sie soll es nie werden.
 *
 * Der Produktionsstatus hat einen Lebenszyklus: neu, bestätigt, in
 * Produktion, abgeschlossen. Er kennt Übergänge, Endzustände und die Regel,
 * dass nichts rückwärts läuft — „abgeschlossen zurück auf neu" wäre
 * Datenkorruption.
 *
 * Der Zahlungsstatus hat davon nichts. Er ist ein EINTRAG, keine Reise: Er
 * hält fest, was jemand am Tresen gesehen hat. Wer versehentlich „Bar
 * bezahlt" gewählt hat, wo „Karte" richtig war, muss das korrigieren können —
 * und zwar sofort, ohne Storno, ohne Gegenbuchung, ohne dass ein
 * Zustandsautomat es verbietet. Deshalb gibt es hier KEINE Übergangstabelle
 * und KEIN canTransitionTo(). Jeder der fünf Zustände darf jedem folgen.
 *
 * Wer hier eines Tages doch eine Übergangsregel vermisst, sucht in Wahrheit
 * eine Zahlungshistorie — und die ist eine eigene Tabelle und eine eigene
 * Entscheidung, nicht eine Zeile in dieser Datei.
 *
 * ER BEEINFLUSST DEN UMSATZ NICHT. Was ein Tag umgesetzt hat, entscheidet
 * sich an den Bestellungen und daran, ob sie storniert wurden — nicht daran,
 * ob das Geld schon da ist. „Abgeschlossen und trotzdem offen" ist deshalb
 * kein Widerspruch, sondern der Alltag eines Betriebs, der auf Rechnung
 * liefert.
 */
export const PAYMENT_STATUSES = [
  'unpaid',
  'paid_cash',
  'paid_card',
  'paid_bank',
  'paid_other',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Die Allowlist — und die einzige im System.
 *
 * Sie ist derselbe Wächter für einen Wert aus einem Formular wie für einen
 * Wert aus der Datenbank. Zwei Fassungen wären zwei Meinungen darüber, was
 * ein Zahlungsstatus ist, und die HTTP-Fassung wäre diejenige, die niemand
 * pflegt — dieselbe Überlegung, die isOrderStatus() zugrunde liegt.
 *
 * ES WIRD NICHTS NORMALISIERT: kein trim, kein toLowerCase, keine Zuordnung
 * von 'Bar' auf 'paid_cash'. Der Wert ist einer der fünf oder er ist keiner.
 * Aus einer beliebigen Zeichenkette hier einen Zustand zu machen hieße, die
 * Menge der Zustände an der Außengrenze zu erweitern.
 */
export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Ist das Geld da?
 *
 * Die Frage wird HIER beantwortet und nirgends sonst. Ein `status !==
 * 'unpaid'` in einer Aggregation, ein `status.startsWith('paid_')` in einer
 * Oberfläche und ein IN-Ausdruck in einer Abfrage wären drei Fassungen
 * derselben Regel — und die Präfixfassung wäre zugleich die zerbrechlichste:
 * Ein sechster Zustand namens 'paid_later' wäre nach ihr bezahlt, ohne dass
 * jemand das entschieden hätte.
 */
export function isPaid(status: PaymentStatus): boolean {
  return status !== 'unpaid';
}

/**
 * Der Zeitpunkt, der zu einem Zahlungsstand gehört — oder keiner.
 *
 * DIE REGEL HÄNGT AM ZIEL UND NICHT AM WEG DORTHIN, und das ist eine
 * bewusste Vereinfachung gegenüber der naheliegenden Fassung mit drei Fällen
 * („offen → bezahlt: setzen", „bezahlt → andere Zahlart: aktualisieren",
 * „bezahlt → offen: löschen"). Alle drei ergeben dasselbe Ergebnis:
 *
 *   Ziel ist 'unpaid'  → kein Zeitpunkt.
 *   Ziel ist bezahlt   → der Zeitpunkt dieses Eintrags.
 *
 * Eine Funktion, die den bisherigen Stand gar nicht kennt, kann ihn auch
 * nicht falsch auslegen — und sie kann nicht in den Zustand geraten, den das
 * Schema verbietet: „bezahlt ohne Zeitpunkt".
 *
 * DER ZEITPUNKT WIRD ÜBERGEBEN UND NICHT ABGELEITET. Kein Date.now(): Sonst
 * hinge das Ergebnis daran, wann die Funktion läuft, und wäre in keinem Test
 * prüfbar — dieselbe Regel wie im gesamten übrigen System.
 */
export function paymentRecordedAtFor(target: PaymentStatus, now: Date): string | null {
  return isPaid(target) ? toUtcTimestamp(now) : null;
}

/**
 * Die deutsche Beschriftung.
 *
 * „Offen" und nicht „Unbezahlt": Der Betrieb sagt „das ist noch offen", und
 * eine Oberfläche, die die Sprache ihres Betriebs spricht, muss nicht erklärt
 * werden. Die vier bezahlten Zustände nennen die Zahlart, weil genau das der
 * Grund ist, sie zu unterscheiden.
 */
export function paymentStatusLabel(status: PaymentStatus): string {
  const labels: Readonly<Record<PaymentStatus, string>> = {
    unpaid: 'Offen',
    paid_cash: 'Bar bezahlt',
    paid_card: 'Karte bezahlt',
    paid_bank: 'Überweisung bezahlt',
    paid_other: 'Sonstiges bezahlt',
  };
  return labels[status];
}

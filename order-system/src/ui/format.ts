import { InvalidArgumentError } from '../domain/errors';

/**
 * Darstellung — und nur Darstellung. Diese Datei rechnet nichts aus, sie
 * schreibt bereits berechnete Werte auf.
 *
 * Sie liegt in src/ui/ und nicht in src/domain/, weil ein Geldbetrag keine
 * Sprache hat. „4,35 €" ist eine deutsche Schreibweise, kein Fachbegriff des
 * Bestellwesens.
 */

/**
 * Ganzzahlige Cent als deutscher Eurobetrag.
 *
 * Rein zeichenbasiert. Intl.NumberFormat wäre kürzer, nimmt aber eine
 * Fließkommazahl entgegen — cents/100 wäre genau der Wert, den Money.ts im
 * gesamten System vermeidet. „Nur für die Anzeige" ist keine Ausnahme davon:
 * Ein Betrag, der auf dem Bildschirm steht, ist der Betrag, den ein Café
 * gegenrechnet.
 */
export function formatEuro(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new InvalidArgumentError('Ein Betrag zur Anzeige muss ganzzahlige Cent ab 0 sein.');
  }

  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${groupThousands(euros)},${String(rest).padStart(2, '0')} €`;
}

function groupThousands(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    // Ein Punkt vor jeder Dreiergruppe, von rechts gezählt.
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out += '.';
    }
    out += digits[i];
  }
  return out;
}

/**
 * Ganzzahlige Cent als EINGABEWERT eines Formularfeldes: „2,10", „0,00",
 * „1250,00".
 *
 * DER UNTERSCHIED ZU formatEuro() IST ABSICHT UND KEIN VERSEHEN:
 *
 *   kein Eurozeichen   Es steht im Formular NEBEN dem Feld. Ein „€" im Wert
 *                      käme beim Speichern zurück und wäre dann eine
 *                      ungültige Eingabe — ein Feld, dessen eigener Inhalt
 *                      unabgesendet werden kann, ist eine Falle.
 *   kein Tausenderpunkt
 *                      „1.250,00" zurückgeschickt wäre nicht mehr eindeutig
 *                      lesbar; parseUnitCost() lehnt zwei Trennzeichen
 *                      ausdrücklich ab. Was hier herauskommt, muss dieselbe
 *                      Funktion wieder annehmen.
 *
 * Damit gilt: Wer ein Feld unverändert absendet, speichert genau den Wert,
 * der schon da stand. Rein zeichenbasiert wie alles in dieser Datei — es
 * entsteht keine Fließkommazahl, auch nicht kurzzeitig für die Ausgabe.
 */
export function formatAmountInput(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new InvalidArgumentError('Ein Betrag zur Eingabe muss ganzzahlige Cent ab 0 sein.');
  }

  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${euros},${String(rest).padStart(2, '0')}`;
}

/**
 * Ein Betrag, der auch NEGATIV sein darf — für den Rohertrag.
 *
 * WARUM formatEuro() DAS NICHT SELBST KANN: Es wirft bei einer negativen
 * Zahl, und das soll es weiterhin. Ein negativer Umsatz, ein negativer
 * offener Betrag oder ein negativer Positionsbetrag wären ein Rechenfehler,
 * und ein Rechenfehler soll laut scheitern statt sich als „-4,35 €" auf eine
 * Seite zu schreiben. Es gibt in diesem System genau EINE Zahl, die
 * unterhalb von null etwas Sinnvolles bedeutet: den Rohertrag. Sie bekommt
 * deshalb eine eigene Funktion und keine gelockerte Regel für alle.
 *
 * Das Vorzeichen steht als schlichtes Minus vorn — kein Klammerpaar (das ist
 * angelsächsische Buchhaltung und wird hier als Fußnote gelesen), keine
 * Farbe (Farbe ist auf diesen Seiten nie die einzige Aussage).
 */
export function formatSignedEuro(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new InvalidArgumentError('Ein Betrag zur Anzeige muss ganzzahlige Cent sein.');
  }
  return cents < 0 ? `-${formatEuro(-cents)}` : formatEuro(cents);
}

/**
 * ZEHNTEL PROZENT als deutscher Prozentwert: 588 wird „58,8 %".
 *
 * DIE EINGABE IST GANZZAHLIG, und das ist der ganze Punkt — dieselbe
 * Überlegung wie bei formatEuro(): Der Rundungsschritt ist in der Domäne
 * bereits getan und nachprüfbar (cost-summary.ts); hier wird nur noch
 * gesetzt. Käme eine Fließkommazahl herein, stünde die Rundungsregel in
 * einer Anzeigefunktion, und zwei Stellen im System entschieden über
 * dieselbe Zahl.
 *
 * Rein zeichenbasiert, deshalb entsteht auch hier kein Float. Negative Werte
 * sind zulässig: Eine Marge unter null ist eine betriebliche Auskunft.
 */
export function formatPercentFromTenths(tenths: number): string {
  if (!Number.isInteger(tenths)) {
    throw new InvalidArgumentError('Ein Prozentwert zur Anzeige muss ganzzahlige Zehntel sein.');
  }

  const betrag = Math.abs(tenths);
  const ganze = Math.floor(betrag / 10);
  const zehntel = betrag % 10;
  return `${tenths < 0 ? '-' : ''}${groupThousands(ganze)},${zehntel} %`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Die einzige Stelle, an der aus Text HTML wird.
 *
 * Jeder Wert, der aus der Datenbank in eine Seite geht — Caféname,
 * Produktname, Beschreibung, Einheit —, läuft hier durch. Die CSP verbietet
 * zwar Inline-Skripte, aber eine CSP ist die zweite Verteidigungslinie; die
 * erste ist, dass gar kein Markup entsteht.
 *
 * Der eine Ersetzungsdurchlauf statt fünf ist nicht Eleganz, sondern
 * Notwendigkeit: Nacheinander ausgeführt würde die '&'-Ersetzung die Ergebnisse
 * der übrigen erneut escapen ('&lt;' → '&amp;lt;').
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] as string);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const GERMAN_DATE = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * 'JJJJ-MM-TT' als ausgeschriebener deutscher Tag: „Dienstag, 25. August 2026".
 *
 * Der Wochentag steht vorn, weil er die Information ist, die ein Café
 * tatsächlich prüft. Eine Zahl allein lässt offen, ob der Liefertag im
 * Betriebsablauf passt.
 *
 * timeZone: 'UTC' ist hier kein Widerspruch zu Europe/Berlin, sondern die
 * Voraussetzung dafür: Ein Liefertag hat keine Uhrzeit. Er wird als
 * Mitternacht-UTC gelesen und in derselben Zone wieder ausgegeben, damit kein
 * Umrechnungsschritt ihn um einen Tag verschiebt.
 */
export function formatGermanDate(day: string): string {
  return GERMAN_DATE.format(pruefeTag(day));
}

const GERMAN_TIMESTAMP = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatGermanTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new InvalidArgumentError('Der Zeitpunkt muss ein ISO-8601-UTC-Zeitstempel sein.');
  }
  return GERMAN_TIMESTAMP.format(parsed);
}

const GERMAN_WEEKDAY = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long' });

const GERMAN_DAY_MONTH_YEAR = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const GERMAN_SHORT_DATE = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
});

/**
 * Nur der Wochentag: „Montag".
 *
 * Für die Wochenübersicht, in der der Wochentag die FÜHRENDE Angabe jeder
 * Zeile ist und das Datum die zweite. Ein Betrieb plant nach Wochentagen —
 * „Samstag" sagt mehr über den Tag aus als „29.08.".
 */
export function formatGermanWeekday(day: string): string {
  return GERMAN_WEEKDAY.format(pruefeTag(day));
}

/**
 * Der Tag ohne Wochentag: „24. August 2026".
 *
 * Für Zeitraumangaben, in denen zwei Daten nebeneinanderstehen. Mit
 * Wochentagen wäre „Montag, 24. August 2026 – Sonntag, 30. August 2026" eine
 * Überschrift, die man liest statt sie zu erfassen.
 */
export function formatGermanDayMonthYear(day: string): string {
  return GERMAN_DAY_MONTH_YEAR.format(pruefeTag(day));
}

const GERMAN_NUMERIC_DATE = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Der Tag als vollständige Zahl: „27.08.2026".
 *
 * Für Listen, in denen viele Tage UNTEREINANDER stehen und jeder für sich
 * eindeutig sein muss — die Bestellhistorie eines Kunden ist genau das. Der
 * ausgeschriebene Tag („Donnerstag, 27. August 2026") ist dort zehnmal
 * hintereinander eine Textwand, und formatGermanShortDate() lässt das Jahr
 * weg, weil die Wochenübersicht es in ihrer Überschrift trägt. Eine
 * Historie trägt es nirgends: Über einen Jahreswechsel hinweg wären „24.08."
 * und „24.08." zwei verschiedene Bestellungen mit demselben Datum.
 *
 * Dieselbe Schreibweise, die formatGermanTimestamp() für den Datumsteil
 * benutzt — damit sehen ein Liefertag und ein Zeitpunkt im selben
 * Adminbereich nicht verschieden aus.
 */
export function formatGermanNumericDate(day: string): string {
  return GERMAN_NUMERIC_DATE.format(pruefeTag(day));
}

/**
 * Der Tag als kurze Zahl: „24.08.".
 *
 * Für die Wochenzeile, in der der Wochentag bereits ausgeschrieben davorsteht
 * und das Datum ihn nur noch verankert. Ohne Jahr — die Woche steht
 * vollständig in der Überschrift darüber.
 */
export function formatGermanShortDate(day: string): string {
  return GERMAN_SHORT_DATE.format(pruefeTag(day));
}

/**
 * Die gemeinsame Prüfung ALLER Tagesformate dieser Datei.
 *
 * Form UND Existenz des Tages — dieselbe zweite Prüfung, die isCalendarDay()
 * in der Domäne vornimmt und aus demselben Grund: '2026-02-30' passt auf das
 * Muster, und JavaScript schriebe es still als „2. März" an. Vier Kopien
 * wären vier Gelegenheiten, dass eine davon das nicht tut.
 */
function pruefeTag(day: string): Date {
  if (!ISO_DAY.test(day)) {
    throw new InvalidArgumentError('Der Tag muss im Format JJJJ-MM-TT vorliegen.');
  }
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new InvalidArgumentError('Der Tag ist kein gültiger Kalendertag.');
  }
  return parsed;
}

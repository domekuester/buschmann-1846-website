import {
  MAX_LEAD_DAYS,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  cutoffExampleSentence,
  cutoffSentence,
  orderDaysSentence,
  type OrderPolicy,
} from '../domain/order-policy';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatGermanTimestamp } from './format';

/**
 * Bestellregeln — die Seite, auf der der Betrieb sagt, wann er Bestellungen
 * annimmt.
 *
 * SIE BEANTWORTET GENAU DREI FRAGEN, und der Betreiber soll nicht mehr als
 * diese drei verstehen müssen:
 *
 *   An welchen Wochentagen nehmen wir Bestellungen an?
 *   Wie viele Tage vorher ist Bestellschluss?
 *   Bis wie viel Uhr?
 *
 * SIE IST KEIN KALENDER. Es gibt hier keinen Feiertag, keinen einzelnen
 * Sperrtag, keine Betriebsferien, keine Kunden- und keine Produktregel —
 * nicht ausgeblendet, sondern nicht vorhanden. Wer einmal anfängt, einzelne
 * Tage zu pflegen, pflegt sie für immer.
 *
 * SIE TRÄGT KEIN SKRIPT. Kästchen, Zahlenfeld, Uhrzeitfeld und ein
 * Speichern-Knopf sind ein echtes `<form method="post">` — dieselbe Bauart
 * wie die Preisgruppen der Kundenseite. Ohne JavaScript bedienbar, ohne
 * Ausnahme in der CSP.
 *
 * KEINE FACHSPRACHE. Auf dieser Seite steht nirgends „lead_days", „Policy"
 * oder „Cutoff". Was hier steht, steht in Sätzen, die jemand am Tresen liest.
 *
 * DAS BEISPIEL IST DIE EIGENTLICHE ERKLÄRUNG. Eine Zahl und eine Uhrzeit
 * ergeben für sich genommen kein Bild; „Für Freitag, 28. August endet die
 * Bestellung am Donnerstag, 27. August um 12:00 Uhr" ergibt eines. Der Satz
 * wird aus der GESPEICHERTEN Regel gerechnet und mit derselben Funktion, die
 * auch Bestellungen annimmt oder ablehnt — er kann deshalb nicht etwas
 * anderes behaupten, als der Server tut.
 */

export interface AdminOrderPolicyPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  /** Die gespeicherte Regel — sie füllt das Formular vor. */
  readonly policy: OrderPolicy;
  /** Wann zuletzt gespeichert wurde; null heißt „noch nie geändert". */
  readonly updatedAt: string | null;
  /** Für das Beispiel: der Zeitpunkt des Seitenaufrufs. */
  readonly now: Date;
  /**
   * Die Rückmeldung des letzten Speicherversuchs, als CODE und nicht als
   * Text. Der Wert kommt aus der Adresszeile und wird deshalb NIEMALS
   * angezeigt, sondern in der festen Tabelle unten nachgeschlagen — dieselbe
   * Regel wie auf der Kundenseite.
   */
  readonly noticeCode: string | null;
}

const MELDUNGEN: Readonly<Record<string, string>> = {
  saved: 'Die Bestellregeln wurden gespeichert.',
  no_day:
    'Mindestens ein Bestelltag muss angehakt sein. Es wurde nichts gespeichert.',
  invalid_lead_days:
    `Der Vorlauf muss eine ganze Zahl zwischen 0 und ${MAX_LEAD_DAYS} sein. Es wurde nichts gespeichert.`,
  invalid_cutoff_time:
    'Die Uhrzeit muss im Format HH:MM angegeben sein. Es wurde nichts gespeichert.',
  invalid: 'Das Formular war nicht lesbar. Es wurde nichts gespeichert.',
  internal:
    'Die Bestellregeln konnten gerade nicht gespeichert werden. Bitte versuche es gleich noch einmal.',
};

export function renderAdminOrderPolicyPage(view: AdminOrderPolicyPageView): string {
  return renderAdminShell(
    'Bestellregeln — Buschmann 1846',
    view,
    'rules',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Bestellregeln</p>
      <h1>Bestellregeln</h1>
      <p class="bereichskopf__vorspann">An welchen Tagen wir Bestellungen annehmen — und bis wann.</p>
    </header>
    ${meldung(view.noticeCode)}
    ${zusammenfassung(view)}
    <form method="post" action="/api/admin/order-policy" class="regelform">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      ${bestelltage(view.policy)}
      ${bestellschluss(view)}
      <div class="regelform__fuss">
        <button type="submit" class="senden regelform__senden">Speichern</button>
      </div>
    </form>`,
  );
}

/**
 * Die Rückmeldung nach dem Speichern.
 *
 * role="status" und nicht role="alert": Der Vorgang ist abgeschlossen. Erfolg
 * und Fehlschlag sehen NICHT gleich aus — `.banner` ist im ganzen System die
 * Fehlerdarstellung mit Warndreieck, und „gespeichert" mit einem Warndreieck
 * davor widerspräche sich selbst. Dieselbe Unterscheidung wie auf der
 * Kundenseite.
 */
function meldung(code: string | null): string {
  if (code === null) return '';
  const text = Object.prototype.hasOwnProperty.call(MELDUNGEN, code) ? MELDUNGEN[code] : null;
  if (text === undefined || text === null) return '';

  const klasse = code === 'saved'
    ? 'kundenmeldung kundenmeldung--erfolg'
    : 'banner kundenmeldung';

  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}

/**
 * WAS GERADE GILT — in Sätzen, vor dem Formular.
 *
 * Ein Formular zeigt Kästchen und Zahlen; es sagt nicht, was daraus folgt.
 * Diese zwei bis drei Zeilen sind die Antwort auf „habe ich das richtig
 * eingestellt?", und sie kommen aus derselben Regel wie die Bestellprüfung.
 *
 * „NOCH NIE GEÄNDERT" IST EINE EIGENE AUSSAGE und nicht dasselbe wie ein
 * Zeitstempel vom Migrationstag: Sie sagt, dass hier noch niemand etwas
 * entschieden hat — und dass die Voreinstellung nichts verbietet.
 */
function zusammenfassung(view: AdminOrderPolicyPageView): string {
  const zeilen: string[] = [];

  const tage = orderDaysSentence(view.policy);
  zeilen.push(tage ?? 'Wir nehmen Bestellungen für alle Wochentage an.');

  const schluss = cutoffSentence(view.policy);
  zeilen.push(schluss ?? 'Es gibt zurzeit keinen Bestellschluss.');

  const beispiel = cutoffExampleSentence(view.policy, view.now);
  if (beispiel !== null) {
    zeilen.push(beispiel);
  }

  const stand = view.updatedAt === null
    ? 'Noch nie geändert.'
    : `Zuletzt geändert am ${formatGermanTimestamp(view.updatedAt)} Uhr.`;

  return `<section class="regelstand" aria-labelledby="regelstand-titel">
      <h2 id="regelstand-titel">Das gilt gerade</h2>
      ${zeilen.map((zeile) => `<p>${escapeHtml(zeile)}</p>`).join('\n      ')}
      <p class="regelstand__stand">${escapeHtml(stand)}</p>
    </section>`;
}

/**
 * Die sieben Kästchen.
 *
 * EIN NAME, SIEBEN WERTE. Ein nicht angehaktes Kästchen wird vom Browser gar
 * nicht mitgeschickt — was ankommt, IST die Liste der erlaubten Tage. Sieben
 * einzelne Felder mit „on"/fehlt wären dieselbe Information in umständlicher
 * und für den Server schwerer prüfbar.
 *
 * Montag zuerst: Ein Betrieb plant seine Woche ab Montag.
 */
function bestelltage(policy: OrderPolicy): string {
  const kaestchen = WEEKDAY_KEYS.map((key, index) => {
    const aktiv = policy.weekdays[index] === true;
    return `<label class="regeltag">
          <input type="checkbox" name="weekday" value="${key}"${aktiv ? ' checked' : ''}>
          <span>${WEEKDAY_LABELS[index]}</span>
        </label>`;
  }).join('\n        ');

  return `<fieldset class="regelblock">
      <legend>Bestelltage</legend>
      <p class="regelblock__hinweis">An welchen Wochentagen nehmen wir Bestellungen an?</p>
      <div class="regeltage">
        ${kaestchen}
      </div>
    </fieldset>`;
}

/**
 * Der Bestellschluss — ein Schalter, eine Zahl, eine Uhrzeit.
 *
 * DER SCHALTER STEHT VORN UND HEISST, WAS ER TUT. Ohne ihn wäre „0 Tage
 * vorher, 00:00 Uhr" der einzige Weg, den Bestellschluss abzuschalten — eine
 * Einstellung, die man rückwärts lesen müsste, um sie zu verstehen.
 *
 * DAS ZAHLENFELD IST EIN ZAHLENFELD (type="number", min/max/step). Das ist
 * kein Ersatz für die Serverprüfung und soll keiner sein: Es zeigt auf dem
 * Telefon die Zifferntastatur und fängt den Vertipper ab, bevor er zu einer
 * Fehlermeldung wird. Verlassen wird sich darauf niemand — der Endpunkt prüft
 * denselben Bereich noch einmal.
 *
 * DAS UHRZEITFELD IST type="time" MIT step="60". Ohne step liefern manche
 * Browser 'HH:MM:SS'; die gespeicherte Form ist aber 'HH:MM', und ein Feld,
 * das je nach Browser etwas anderes sendet, ist eine Fehlerquelle ohne
 * Gegenwert.
 */
function bestellschluss(view: AdminOrderPolicyPageView): string {
  const policy = view.policy;
  const beispiel = cutoffExampleSentence(policy, view.now);

  return `<fieldset class="regelblock">
      <legend>Bestellschluss</legend>

      <label class="regelschalter">
        <input type="checkbox" name="cutoff_enabled" value="1"${policy.cutoffEnabled ? ' checked' : ''}>
        <span>Bestellschluss verwenden</span>
      </label>
      <p class="regelblock__hinweis">
        Ohne Haken kann jederzeit für jeden Bestelltag bestellt werden — auch noch am selben Morgen.
      </p>

      <div class="regelfrist">
        <p class="regelfrist__satz">Bestellungen nehmen wir an bis spätestens</p>
        <div class="regelfrist__felder">
          <span class="feld feld--eng">
            <label for="regel-vorlauf">Tage vorher</label>
            <input
              type="number"
              id="regel-vorlauf"
              name="lead_days"
              value="${policy.leadDays}"
              min="0"
              max="${MAX_LEAD_DAYS}"
              step="1"
              inputmode="numeric"
            >
          </span>
          <span class="feld feld--eng">
            <label for="regel-uhrzeit">Uhrzeit</label>
            <input
              type="time"
              id="regel-uhrzeit"
              name="cutoff_time"
              value="${escapeHtml(policy.cutoffTime)}"
              step="60"
            >
          </span>
        </div>
        <p class="regelblock__hinweis">
          0 Tage heißt: noch am Produktionstag selbst, bis zu dieser Uhrzeit.
          Gezählt werden Kalendertage — ein Tag vor Montag ist der Sonntag.
        </p>
      </div>

      ${beispiel === null ? '' : `<p class="regelbeispiel"><strong>Beispiel:</strong> ${escapeHtml(beispiel)}</p>`}
    </fieldset>`;
}

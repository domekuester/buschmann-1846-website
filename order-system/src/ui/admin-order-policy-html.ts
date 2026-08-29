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
import type { EmailNotificationSettings } from '../domain/email-notification-settings';

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
  readonly notificationSettings?: EmailNotificationSettings;
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
  email_saved: 'Die E-Mail-Benachrichtigungen wurden gespeichert.',
  email_invalid: 'Bitte prüfe die E-Mail-Adressen. Es wurde nichts gespeichert.',
  email_too_many: 'Es können höchstens 10 Empfänger gespeichert werden. Es wurde nichts gespeichert.',
  email_recipient_required:
    'Bitte trage mindestens einen Empfänger ein oder schalte Betreiberbenachrichtigungen aus. Es wurde nichts gespeichert.',
  email_internal:
    'Die E-Mail-Benachrichtigungen konnten gerade nicht gespeichert werden. Bitte versuche es gleich noch einmal.',
};

export function renderAdminOrderPolicyPage(view: AdminOrderPolicyPageView): string {
  return renderAdminShell(
    'Einstellungen — Buschmann 1846',
    view,
    'settings',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Betrieb</p>
      <h1>Einstellungen</h1>
      <p class="bereichskopf__vorspann">Bestellannahme und Benachrichtigungen an einem ruhigen Ort.</p>
    </header>
    ${meldung(view.noticeCode)}
    <section class="einstellungsabschnitt" aria-labelledby="bestellregeln-titel">
      <h2 id="bestellregeln-titel">Bestellregeln</h2>
      <p class="einstellungsabschnitt__vorspann">An welchen Tagen wir Bestellungen annehmen — und bis wann.</p>
      ${zusammenfassung(view)}
      <form method="post" action="/api/admin/order-policy" class="regelform">
        <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
        ${bestelltage(view.policy)}
        ${bestellschluss(view)}
        <div class="regelform__fuss">
          <button type="submit" class="senden regelform__senden">Bestellregeln speichern</button>
        </div>
      </form>
    </section>
    ${emailSettings(view)}
    <script type="module" src="/assets/admin-settings.js"></script>`,
  );
}

function emailSettings(view: AdminOrderPolicyPageView): string {
  const settings = view.notificationSettings ?? {
    operatorNotificationsEnabled: false,
    customerConfirmationsEnabled: false,
    operatorRecipients: [],
    updatedAt: null,
  };
  const values = [...settings.operatorRecipients, ''];
  const rows = values.map((value, index) => recipientRow(value, index + 1)).join('\n');
  const updated = settings.updatedAt === null
    ? 'Noch nie geändert.'
    : `Zuletzt geändert am ${formatGermanTimestamp(settings.updatedAt)} Uhr.`;

  return `<section class="einstellungsabschnitt email-einstellungen" aria-labelledby="email-einstellungen-titel">
      <h2 id="email-einstellungen-titel">E-Mail-Benachrichtigungen</h2>
      <p class="einstellungsabschnitt__vorspann">Wer bei einer neuen Bestellung informiert wird.</p>
      <form method="post" action="/api/admin/email-notifications" class="regelform email-form">
        <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
        <fieldset class="regelblock">
          <legend>Neue Bestellungen</legend>
          <label class="regelschalter">
            <input type="checkbox" name="operator_notifications_enabled" value="1"${settings.operatorNotificationsEnabled ? ' checked' : ''}>
            <span>Neue Bestellungen an Betrieb senden</span>
          </label>
          <div class="email-empfaenger">
            <p class="email-empfaenger__titel">Empfänger</p>
            <p id="email-empfaenger-hinweis" class="regelblock__hinweis">Bis zu 10 E-Mail-Adressen.</p>
            <div class="email-empfaenger__liste" data-email-recipients>${rows}</div>
            <template data-email-recipient-template>${recipientRow('', 0)}</template>
            <button type="button" class="sekundaertaste email-empfaenger__mehr" data-add-email-recipient>
              + Weitere E-Mail-Adresse
            </button>
          </div>
        </fieldset>
        <fieldset class="regelblock">
          <legend>Bestellbestätigung</legend>
          <label class="regelschalter">
            <input type="checkbox" name="customer_confirmations_enabled" value="1"${settings.customerConfirmationsEnabled ? ' checked' : ''}>
            <span>Kunden erhalten eine Bestellbestätigung</span>
          </label>
          <p class="regelblock__hinweis">Nur wenn beim Kunden eine gültige E-Mail-Adresse hinterlegt ist.</p>
        </fieldset>
        <p class="regelstand__stand email-einstellungen__stand">${escapeHtml(updated)}</p>
        <div class="regelform__fuss">
          <button type="submit" class="senden regelform__senden">Benachrichtigungen speichern</button>
        </div>
      </form>
    </section>`;
}

function recipientRow(value: string, number: number): string {
  const suffix = number > 0 ? String(number) : 'neu';
  const label = number > 0 ? `Empfänger ${number}` : 'Empfänger';
  return `<div class="email-empfaenger__zeile">
              <label for="email-empfaenger-${suffix}">${label}</label>
              <input type="email" id="email-empfaenger-${suffix}" name="operator_recipient"
                value="${escapeHtml(value)}" maxlength="190" autocomplete="email"
                aria-describedby="email-empfaenger-hinweis">
            </div>`;
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

  const klasse = code === 'saved' || code === 'email_saved'
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

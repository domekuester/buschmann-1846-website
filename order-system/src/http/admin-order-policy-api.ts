import type { AppConfig } from '../config/app-config';
import {
  MAX_LEAD_DAYS,
  WEEKDAY_KEYS,
  isCutoffTime,
  type OrderPolicy,
  type WeekdayFlags,
} from '../domain/order-policy';
import { saveOrderPolicy } from '../infrastructure/d1/order-policy-repository';
import {
  ForbiddenError,
  UnauthenticatedError,
  assertCsrf,
  assertSameOrigin,
  requireRole,
} from './guard';
import { RequestError, readBody } from './json-body';
import { privateHeaders } from './security';

/**
 * POST /api/admin/order-policy
 *
 * Der fünfte schreibende Adminvorgang des Systems — und er folgt Zeile für
 * Zeile derselben Ordnung wie die vier davor:
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle — 'admin'. Ohne sie wird der Körper nicht gelesen.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist erst hier prüfbar.
 *   4. Anfrageform und Felder.
 *   5. Erst danach der Schreibvorgang.
 *
 * ER IST NUR EIN FORMULARENDPUNKT und hat keinen JSON-Zwilling: Es gibt
 * keinen Client, der ihn per fetch aufriefe, und einen zweiten Weg zu bauen,
 * den niemand benutzt, hieße, ihn auch absichern zu müssen, ohne dass ihn
 * jemand prüft.
 *
 * WAS DER KÖRPER TRAGEN DARF: den CSRF-Token, die angehakten Wochentage, den
 * Schalter für den Bestellschluss, den Vorlauf und die Uhrzeit. Sonst nichts.
 * In dieser Datei gibt es keine Zeile, die eine Rolle, eine Kennung, einen
 * Kunden oder ein Rückkehrziel läse — und was nicht gelesen wird, kann auch
 * nicht geschmuggelt werden.
 *
 * ER ÄNDERT KEINE EINZIGE BESTELLUNG. Diese Datei enthält kein UPDATE und
 * kein DELETE auf `orders`. Eine geänderte Regel gilt ab jetzt und für neue
 * Bestellungen; was bestellt ist, bleibt bestellt.
 */

/**
 * 1 KiB. Der Körper trägt einen Token, höchstens sieben kurze Wörter, eine
 * Zahl und eine Uhrzeit; eine echte Anfrage liegt weit darunter. Großzügig
 * gewählt: Sie soll nichts Echtes abweisen und alles Absurde.
 */
const MAX_BODY_BYTES = 1024;

/**
 * Die Rückmeldungen, die als Code in der Weiterleitung landen.
 *
 * Sie sind eine feste Aufzählung und keine freien Zeichenketten: Was in der
 * Adresszeile steht, schlägt die Seite in ihrer eigenen festen Tabelle nach.
 * Damit kann in der angezeigten Meldung nichts stehen, was nicht in einer
 * dieser beiden Dateien im Quelltext steht.
 */
type Notice =
  | 'saved'
  | 'no_day'
  | 'invalid_lead_days'
  | 'invalid_cutoff_time'
  | 'invalid'
  | 'internal';

export async function saveOrderPolicyEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  try {
    assertSameOrigin(request, config);

    const wache = await requireRole(db, config, request, now, 'admin', 'html');
    if (!wache.ok) {
      return wache.response;
    }

    /**
     * DER CONTENT-TYPE WIRD ERST HIER GEPRÜFT — nach der Wache. Ein Fremder
     * soll aus einer 415 nicht erfahren, welche Anfrageform dieser Endpunkt
     * erwartet.
     */
    if (!istFormular(request)) {
      throw new RequestError(415, 'unsupported_media_type');
    }

    const felder = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
    assertCsrf(request, wache.context, felder);

    const policy = leseRichtlinie(felder);

    await saveOrderPolicy(db, policy, now);
    return zurueck('saved');
  } catch (error) {
    if (error instanceof RequestError) {
      /**
       * Die 415 bleibt eine 415: Sie sagt einem maschinellen Aufrufer etwas
       * Richtiges und kann keinen Menschen verwirren, weil kein Formular
       * dieser Seite sie auslöst. Alles Übrige wird für den Browser zu einer
       * Weiterleitung mit Hinweis, statt zu JSON im Fenster.
       */
      if (error.status === 415) {
        return new Response(null, { status: 415, headers: privateHeaders() });
      }
      /**
       * DER FEHLERCODE SAGT, WELCHES FELD NICHT GEPASST HAT — und zwar in
       * Alltagssprache auf der Seite, nicht als Feldname hier. „Mindestens
       * ein Bestelltag muss angehakt sein" ist eine andere Auskunft als „Die
       * Uhrzeit muss im Format HH:MM angegeben sein", und ein Admin soll den
       * Unterschied lesen können, statt zu raten, was er falsch gemacht hat.
       */
      return zurueck(istNotice(error.code) ? error.code : 'invalid');
    }

    /**
     * DIE ABLEHNUNGEN DER WACHE GEHEN WEITER NACH OBEN.
     *
     * Ein fehlender Origin und ein falscher CSRF-Token sind keine
     * Bedienfehler, sondern der Abdruck einer Anfrage, die so nicht aus der
     * eigenen Seite kommen kann. Für diese Lage gibt es nichts zu erklären
     * und keinen Weg zurück anzubieten; sie gehört zur zentralen Fehlergrenze
     * mit ihrer knappen 403 ohne Begründung.
     */
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
      throw error;
    }

    /**
     * Ein unerwarteter Fehler wird für den Browser zu einer Seite und nicht
     * zu JSON. Der Fehler wird dabei NICHT angesehen: Der Hinweis ist eine
     * Konstante, und kein SQL-Fragment, kein Bindingname und kein Dateipfad
     * kann in ihn geraten.
     */
    return zurueck('internal');
  }
}

/**
 * Der einzige Content-Type, den dieser Endpunkt annimmt.
 *
 * EXAKT und nicht mit endsWith — dieselbe Regel wie bei den übrigen
 * Formularendpunkten. Der Zeichensatz darf angehängt sein, weil manche
 * Browser ihn setzen.
 */
function istFormular(request: Request): boolean {
  const typ = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return typ === 'application/x-www-form-urlencoded';
}

/**
 * Die vollständige Richtlinie aus dem Formular — oder ein RequestError.
 *
 * ES WIRD IMMER ALLES GELESEN, auch wenn der Bestellschluss ausgeschaltet
 * ist. Vorlauf und Uhrzeit werden trotzdem gespeichert und trotzdem geprüft:
 * Sie stehen im Formular, ein Admin kann sie einstellen, bevor er den Haken
 * setzt, und eine Zahl, die beim Speichern still verworfen würde, wäre eine
 * Eingabe ins Leere. Die CHECK-Bedingungen aus 0016 verlangen ohnehin gültige
 * Werte in beiden Spalten.
 *
 * ES WIRD NICHTS NORMALISIERT — kein trim, kein Auffüllen von '9:00' auf
 * '09:00', keine Umdeutung von 'Montag' auf 'monday'. Der Wert passt oder er
 * passt nicht.
 */
function leseRichtlinie(felder: URLSearchParams): OrderPolicy {
  return {
    weekdays: leseWochentage(felder),
    cutoffEnabled: leseSchalter(felder),
    leadDays: leseVorlauf(felder),
    cutoffTime: leseUhrzeit(felder),
  };
}

/**
 * Die angehakten Wochentage.
 *
 * EIN NICHT ANGEHAKTES KÄSTCHEN SCHICKT DER BROWSER NICHT MIT. Was ankommt,
 * IST damit die Liste der erlaubten Tage — es gibt keinen Wert „aus", den
 * jemand fälschen könnte, und keine Möglichkeit, einen Tag durch Weglassen
 * eines Feldes versehentlich anzulassen.
 *
 * EIN UNBEKANNTER WERT WIRD ABGELEHNT UND NICHT ÜBERGANGEN. 'montag',
 * 'Monday' oder 'freitag ' sind keine Wochentage dieses Formulars; sie still
 * zu verwerfen hieße, eine Anfrage teilweise auszuführen und dabei ein
 * anderes Ergebnis zu speichern, als der Absender geschickt hat.
 *
 * EIN DOPPELTER WERT EBENSO. 'monday' zweimal ist kein Formular dieser Seite;
 * ein Endpunkt, der Wiederholungen still zusammenfasst, lädt dazu ein,
 * Grenzen auszuprobieren.
 *
 * MINDESTENS EIN TAG. Sieben abgehakte Kästchen wären eine Regel, die jede
 * Bestellung ablehnt — das ist keine Bestellregel, sondern eine Schließung,
 * und die soll niemand aus Versehen mit einem Klick auf „Speichern"
 * herbeiführen.
 */
function leseWochentage(felder: URLSearchParams): WeekdayFlags {
  const werte = felder.getAll('weekday');
  const flags = [false, false, false, false, false, false, false];

  for (const wert of werte) {
    const index = WEEKDAY_KEYS.indexOf(wert as (typeof WEEKDAY_KEYS)[number]);
    if (index < 0 || flags[index] === true) {
      throw new RequestError(400, 'invalid');
    }
    flags[index] = true;
  }

  if (!flags.includes(true)) {
    throw new RequestError(400, 'no_day');
  }

  return flags as unknown as WeekdayFlags;
}

/**
 * Der Schalter für den Bestellschluss.
 *
 * Fehlt das Feld, ist der Haken nicht gesetzt — das ist die normale
 * Browser-Bedeutung eines Kästchens. Steht es genau einmal mit dem Wert '1'
 * da, ist er gesetzt. ALLES ANDERE WIRD ABGELEHNT: 'on', 'true', '0' oder ein
 * zweites Feld sind kein Formular dieser Seite.
 */
function leseSchalter(felder: URLSearchParams): boolean {
  const werte = felder.getAll('cutoff_enabled');
  if (werte.length === 0) {
    return false;
  }
  if (werte.length !== 1 || werte[0] !== '1') {
    throw new RequestError(400, 'invalid');
  }
  return true;
}

/**
 * Der Vorlauf in Kalendertagen.
 *
 * Erlaubt ist ausschließlich eine ganze Dezimalzahl von 0 bis MAX_LEAD_DAYS.
 * Kein trim, kein Vorzeichen, kein '1e1', kein '1.0', kein Leerraum:
 * Number() allein wäre hier zu nachsichtig — Number(' 1 ') ist 1, Number('')
 * ist 0 —, und aus einem Formular soll nichts durchkommen, was nur zufällig
 * wie eine Zahl aussieht. Dieselbe Strenge wie bei den Kennungen im Pfad.
 *
 * '00' wird ausdrücklich mit angenommen: Manche Browser füllen ein
 * Zahlenfeld so auf. Der Wert ist eindeutig null.
 */
function leseVorlauf(felder: URLSearchParams): number {
  const werte = felder.getAll('lead_days');
  if (werte.length !== 1) {
    throw new RequestError(400, 'invalid');
  }

  const wert = werte[0] ?? '';
  if (!/^[0-9]{1,2}$/.test(wert)) {
    throw new RequestError(400, 'invalid_lead_days');
  }

  const zahl = Number(wert);
  if (zahl > MAX_LEAD_DAYS) {
    throw new RequestError(400, 'invalid_lead_days');
  }
  return zahl;
}

/**
 * Die Uhrzeit des Bestellschlusses, 'HH:MM' Ortszeit.
 *
 * GEPRÜFT WIRD MIT isCutoffTime() AUS DER DOMÄNE — derselben Funktion, deren
 * Regel auch im CHECK von 0016 steht. Ein eigener regulärer Ausdruck an
 * dieser Stelle wäre eine dritte Fassung derselben Regel und damit die
 * Gelegenheit, dass eine davon '24:00' durchlässt.
 */
function leseUhrzeit(felder: URLSearchParams): string {
  const werte = felder.getAll('cutoff_time');
  if (werte.length !== 1) {
    throw new RequestError(400, 'invalid');
  }

  const wert = werte[0] ?? '';
  if (!isCutoffTime(wert)) {
    throw new RequestError(400, 'invalid_cutoff_time');
  }
  return wert;
}

const NOTICES: readonly string[] = [
  'saved', 'no_day', 'invalid_lead_days', 'invalid_cutoff_time', 'invalid', 'internal',
];

function istNotice(code: string): code is Notice {
  return NOTICES.includes(code);
}

/**
 * ZURÜCK AUF DIE REGELSEITE — und das ist die Stelle, an der ein Open
 * Redirect entstünde, wenn man sie falsch baute.
 *
 * DAS ZIEL IST EINE KONSTANTE IM QUELLTEXT. Nicht aus einem Formularfeld,
 * nicht aus einem Parameter, nicht aus dem Referer. Es gibt in diesem
 * Endpunkt keine Zeile, die ein Wunschziel des Aufrufers läse — und damit
 * auch nichts, das eine Allowlist prüfen müsste.
 *
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST — hier wäre das ein zweites Speichern.
 */
function zurueck(notice: Notice): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/settings?notice=${notice}` }),
  });
}

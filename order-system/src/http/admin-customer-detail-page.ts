import type { AppConfig } from '../config/app-config';
import { CUSTOMER_ORDER_HISTORY_LIMIT } from '../domain/customer-history';
import { loadAdminCustomerWorkspace } from '../infrastructure/d1/admin-customer-repository';
import { loadCustomerOrderHistory } from '../infrastructure/d1/customer-history-repository';
import { loadAssignablePriceGroups } from '../infrastructure/d1/customer-price-group-repository';
import { renderAdminCustomerDetailPage } from '../ui/admin-customer-detail-html';
import { renderNoticePage } from '../ui/notice-page-html';
import { requireRole } from './guard';
import { parseIdSegment } from './id-param';
import { pageHeaders } from './security';

/**
 * GET /admin/customers/:customerId — wer dieser Kunde ist und was er zuletzt
 * bestellt hat.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE AUF JEDER ANDEREN ADMINSEITE: erst die
 * Rolle, dann die Kennung, dann die Daten. Wer keinen Zugang hat, löst keine
 * einzige Abfrage aus — und erfährt insbesondere nicht, ob es den Kunden
 * gibt.
 *
 * DIE SEITE SCHREIBT NICHTS. Kein POST, kein Formular, keine Spalte. Sie hat
 * deshalb auch keine Origin- und keine CSRF-Prüfung: Beides gehört zu
 * zustandsverändernden Vorgängen, und der einzige, der Kunden betrifft, steht
 * unverändert in http/admin-customer-api.ts.
 *
 * ZWEI ABFRAGEN, UNABHÄNGIG VON DER ZAHL DER BESTELLUNGEN:
 *
 *   1. der Kunde samt Preisgruppe (ein LEFT JOIN, eine Zeile)
 *   2. seine letzten Bestellungen (eine Zeile je Bestellung, höchstens zehn)
 *
 * KEIN ZUGRIFF JE BESTELLUNG. Betrag, Stand und Zahlungsstand stehen in der
 * Bestellzeile selbst; es gibt in diesem Ablauf keine Schleife, die die
 * Datenbank ein drittes Mal fragt.
 *
 * SIE LAUFEN NEBENEINANDER, obwohl die zweite für einen Kunden, den es nicht
 * gibt, gar nicht nötig wäre. Das ist Absicht: Der Vorabtest wäre eine dritte
 * Datenbankrunde für den seltensten Fall, und eine Bestellabfrage auf eine
 * unbekannte Kennung liefert eine leere Liste — sie kann nichts verraten,
 * weil sie nichts findet. Dieselbe Bauart wie auf /admin/customers.
 */
export async function adminCustomerDetailPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  customerIdSegment: string,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) return wache.response;

  /**
   * Die Kennung wird GEPRÜFT, bevor sie an die Datenbank geht — und eine
   * ungültige Kennung ergibt dieselbe Antwort wie eine unbekannte. „Das ist
   * keine Zahl" und „diesen Kunden gibt es nicht" zu unterscheiden hieße,
   * einem Fremden die Form gültiger Kennungen mitzuteilen.
   */
  const customerId = parseIdSegment(customerIdSegment);
  if (customerId === null) return unbekannt();

  const [customers, orders, priceGroups] = await Promise.all([
    loadAdminCustomerWorkspace(db, customerId),
    loadCustomerOrderHistory(db, customerId, CUSTOMER_ORDER_HISTORY_LIMIT),
    loadAssignablePriceGroups(db),
  ]);
  const customer = customers[0] ?? null;

  if (customer === null) return unbekannt();

  return new Response(
    renderAdminCustomerDetailPage({
      loginIdentifier: wache.context.loginIdentifier,
      csrfToken: wache.context.csrfToken,
      customer,
      orders,
      orderLimit: CUSTOMER_ORDER_HISTORY_LIMIT,
      noticeCode: readNotice(request),
      priceGroups,
    }),
    { status: 200, headers: pageHeaders() },
  );
}

function readNotice(request: Request): string | null {
  const values = new URL(request.url).searchParams.getAll('notice');
  return values.length === 1 ? (values[0] ?? null) : null;
}

/**
 * Die Antwort auf einen Kunden, den es nicht gibt.
 *
 * ZEICHEN FÜR ZEICHEN DIESELBE SEITE, egal ob die Kennung unsinnig, gelöscht
 * oder nie vergeben war. Eine Unterscheidung wäre ein Verzeichnisdienst:
 * Wer der Reihe nach 1, 2, 3 durchprobiert, dürfte sonst an den
 * verschiedenen Antworten ablesen, wie viele Kunden es gibt.
 *
 * Sie nennt keine Tabelle, kein SQL und keine Kennung — der Text ist eine
 * Konstante und wird nicht aus der Anfrage gebildet.
 */
function unbekannt(): Response {
  return new Response(
    renderNoticePage(
      'Nicht gefunden',
      'Diesen Kunden gibt es nicht.',
      'Vielleicht stimmt der Link nicht mehr. Über „Kunden" im Menü findest du alle angelegten Kunden.',
    ),
    { status: 404, headers: pageHeaders() },
  );
}

const PFAD = /^\/admin\/customers\/([^/]+)$/;

/**
 * Gehört dieser Pfad zur Detailansicht — und welcher Kunde steht darin?
 *
 * Der Rückgabewert ist das ROHE Pfadsegment und noch keine Kundenkennung: Es
 * kommt vom Aufrufer und wird erst geprüft, nachdem feststeht, dass der
 * Aufrufer Admin ist. `[^/]+` sorgt dafür, dass ein Segment ein Segment
 * bleibt — '/admin/customers/1/etwas' passt nicht auf dieses Muster, und
 * '/admin/customers' ebenso wenig: Jene Route wird vorher als Gleichheit
 * erkannt.
 */
export function matchCustomerDetailPath(pathname: string): string | null {
  const treffer = PFAD.exec(pathname);
  if (treffer === null) {
    return null;
  }

  // Eine kaputte Prozentfolge soll eine Ablehnung ergeben und keine 500.
  try {
    return decodeURIComponent(treffer[1] ?? '');
  } catch {
    return '';
  }
}

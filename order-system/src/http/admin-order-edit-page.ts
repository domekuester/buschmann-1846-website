import type { AppConfig } from '../config/app-config';
import { isCalendarDay } from '../domain/clock';
import { OrderNumber } from '../domain/order-number';
import { canEditOrderItems, orderStatusLabel } from '../domain/order-status';
import { isPaid } from '../domain/payment-status';
import { findEditableOrder } from '../infrastructure/d1/admin-order-edit-repository';
import { formatEuro } from '../ui/format';
import {
  renderAdminOrderEditPage,
  toOrderEditItemView,
  type OrderEditItemView,
} from '../ui/admin-order-edit-html';
import { requireRole } from './guard';
import { pageHeaders, privateHeaders } from './security';

/**
 * GET /admin/orders/:orderNumber/bearbeiten
 *
 * Die einzige Seite des Systems, auf der Positionen einer bestehenden
 * Bestellung geändert werden — und sie ist rein LESEND. Beide
 * Schreibvorgänge stehen in http/admin-order-item-api.ts; diese Datei
 * enthält kein POST, kein Formularfeld und keine Origin- oder CSRF-Prüfung,
 * weil sie nichts verändert.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE AUF JEDER ANDEREN ADMINSEITE: erst die
 * Rolle, dann die Bestellnummer, dann die Daten. Ein Café löst hier keine
 * einzige Abfrage aus — und erfährt insbesondere nicht, ob es diese
 * Bestellung gibt.
 *
 * SIE GEHÖRT NEBEN /admin/orders/:nr/cancel und ist bewusst nach demselben
 * Muster gebaut: eine eigene, schmale Seite für einen einzelnen Vorgang,
 * erreichbar aus der Bestellliste. Eine allgemeine Bestelldetailseite gibt es
 * in dieser Phase nicht — sie wäre ein zweiter Lesebereich mit eigenem
 * Ansichtsmodell, eigener Prüfung und eigener Pflege, ohne dass jemand danach
 * gefragt hat.
 *
 * ZWEI ABFRAGEN, unabhängig von der Zahl der Positionen (siehe
 * admin-order-edit-repository.ts).
 */

const PFAD = /^\/admin\/orders\/([^/]+)\/bearbeiten$/;

/**
 * Gehört dieser Pfad zu dieser Seite — und welche Bestellung steht darin?
 *
 * Das Muster kann mit /admin/orders/:nr/cancel nicht kollidieren: Beide enden
 * auf ein festes, verschiedenes Segment, und ein Pfad kann nicht auf beide
 * passen. `[^/]+` sorgt dafür, dass ein Segment ein Segment bleibt.
 */
export function matchOrderEditPath(pathname: string): string | null {
  const treffer = PFAD.exec(pathname);
  if (treffer === null) {
    return null;
  }
  try {
    return decodeURIComponent(treffer[1] ?? '');
  } catch {
    return '';
  }
}

export async function adminOrderEditPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) return wache.response;

  /**
   * Eine formal unmögliche Bestellnummer ist dieselbe Antwort wie eine
   * unbekannte. „Das Format stimmt nicht" gegenüber „die gibt es nicht" wäre
   * eine Auskunft darüber, wie eine gültige Nummer aussieht.
   */
  const orderNumber = OrderNumber.parse(orderNumberSegment);
  if (orderNumber === null) return nichtGefunden();

  const order = await findEditableOrder(db, orderNumber.value);
  if (order === null) return nichtGefunden();

  /**
   * DIE STATUSREGEL STEHT IN DER DOMÄNE und wird hier nur gefragt. Sie wird
   * an genau zwei Stellen gefragt — hier und im Anwendungsfall —, und die
   * hier ist die HÖFLICHE: Sie verhindert, dass jemand vor einem Formular
   * steht, dessen Absenden der Server ablehnen würde. Die verbindliche
   * Prüfung ist die andere.
   */
  if (!canEditOrderItems(order.status)) {
    return zurueckZurListe(order.fulfillmentDate, 'edit_not_editable');
  }

  const items = order.items.map(toOrderEditItemView);

  return new Response(
    renderAdminOrderEditPage({
      csrfToken: wache.context.csrfToken,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      fulfillmentDate: order.fulfillmentDate,
      statusLabel: orderStatusLabel(order.status),
      totalLabel: formatEuro(order.totalCents),
      version: order.version,
      items,
      isPaid: isPaid(order.paymentStatus),
      confirmingCancellation: zuBestaetigende(request, items),
      noticeCode: hinweis(request),
      backHref: `/admin/orders?date=${order.fulfillmentDate}`,
    }),
    { status: 200, headers: pageHeaders() },
  );
}

/**
 * Welche Position gerade zur Bestätigung ansteht — aus `?stornieren=<id>`.
 *
 * DER WERT AUS DER QUERY WIRD NICHT BENUTZT, SONDERN NACHGESCHLAGEN. Er wählt
 * eine Position AUS DEN GELADENEN aus; er kann keine hinzufügen und keine
 * fremde benennen. Ein unbekannter, mehrfacher oder unsinniger Wert ergibt
 * schlicht keine Bestätigung — und eine bereits stornierte Position bekommt
 * keine zweite Rückfrage.
 */
function zuBestaetigende(
  request: Request,
  items: readonly OrderEditItemView[],
): OrderEditItemView | null {
  const werte = new URL(request.url).searchParams.getAll('stornieren');
  if (werte.length !== 1) return null;

  const id = Number(werte[0]);
  if (!Number.isInteger(id)) return null;

  return items.find((item) => item.id === id && !item.cancelled) ?? null;
}

/**
 * Der Hinweiscode aus der Query — ROH weitergereicht und erst in der
 * Oberfläche in einer festen Tabelle nachgeschlagen. Was nicht in dieser
 * Tabelle steht, erscheint nicht; damit kann in der Meldung nichts stehen,
 * was ein Aufrufer geschrieben hat.
 */
function hinweis(request: Request): string | null {
  const werte = new URL(request.url).searchParams.getAll('notice');
  return werte.length === 1 ? (werte[0] ?? null) : null;
}

function nichtGefunden(): Response {
  return new Response('Bestellung nicht gefunden.', { status: 404, headers: pageHeaders() });
}

/**
 * ZURÜCK IN DIE BESTELLLISTE — das Ziel ist eine Konstante im Quelltext, der
 * Tag kommt aus der BESTELLUNG IN D1. Es gibt hier keine Zeile, die ein
 * Wunschziel des Aufrufers läse; dieselbe Entscheidung wie bei jedem anderen
 * Rücksprung im Adminbereich.
 */
function zurueckZurListe(day: string, notice: string): Response {
  const date = isCalendarDay(day) ? `date=${day}&` : '';
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/orders?${date}notice=${notice}` }),
  });
}

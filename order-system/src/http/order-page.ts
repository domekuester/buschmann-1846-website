import { toCatalogView } from '../application/catalog-view';
import type { AppConfig } from '../config/app-config';
import { businessDay, plusDays } from '../domain/clock';
import { cutoffSentence, nextOrderableDay, orderDaysSentence } from '../domain/order-policy';
import { loadCustomerPriceBook } from '../infrastructure/d1/customer-price-book-repository';
import { loadOrderPolicy } from '../infrastructure/d1/order-policy-repository';
import { loadCatalog } from '../infrastructure/d1/product-repository';
import { renderOrderPage } from '../ui/order-page-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * Die Bestellseite.
 *
 * Ein einziger Roundtrip liefert alles: Café erkannt, Sortiment gerendert,
 * Liefertag vorbelegt, Absendekennung gesetzt, CSRF-Token mitgegeben. Danach
 * braucht die Seite bis zum Absenden keine Verbindung mehr — Mengen einstellen
 * ist reine DOM-Arbeit.
 *
 * DER KUNDE KOMMT AUS DER SITZUNG.
 *
 * In Phase 2 stand er im Link; wer den Link hatte, war das Café. Jetzt steht
 * er in der Sitzung, und die Sitzung wird bei JEDEM Aufruf frisch geprüft:
 * Rolle, Konto-Aktivität, Café-Aktivität. Ein deaktiviertes Café sieht diese
 * Seite deshalb nicht mehr — nicht erst beim Absenden, sondern sofort.
 *
 * Es gibt in dieser Datei keinen Parameter, über den sich der Kunde
 * beeinflussen ließe. Das ist keine Prüfung, die man vergessen könnte,
 * sondern ein fehlender Eingang.
 */
export async function orderPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'customer', 'html');
  if (!wache.ok) {
    return wache.response;
  }


  /**
   * Sortiment UND Preiswelt in einem Rutsch — beides hängt nicht voneinander
   * ab. Die Preiswelt kommt aus dem Kunden der SITZUNG; es gibt auf dieser
   * Seite keinen Parameter, mit dem sich eine andere wählen ließe.
   */
  const [catalog, priceBook, richtlinie] = await Promise.all([
    loadCatalog(db),
    loadCustomerPriceBook(db, wache.context.customer),
    loadOrderPolicy(db),
  ]);
  const today = businessDay(now);
  const morgen = plusDays(today, 1);
  const policy = richtlinie.policy;

  /**
   * WELCHE TAGE ÜBERHAUPT GEHEN — gerechnet mit derselben Richtlinie, die
   * auch der Bestell-Endpunkt anwendet.
   *
   * `fruehester` ist der erste mögliche Tag ab heute und wird zur unteren
   * Grenze des Datumsfeldes. Mit der Voreinstellung ist das schlicht heute,
   * also das bisherige Verhalten.
   *
   * VORBELEGT WIRD WEITERHIN LIEBER MORGEN als heute: Das ist der mit Abstand
   * häufigste Fall und spart einen Tap. Geht morgen nach der Richtlinie
   * nicht, rückt die Vorbelegung auf den nächsten Tag, der geht — eine
   * Vorbelegung, die der Server ablehnen würde, wäre eine Einladung zu einem
   * Fehlversuch.
   *
   * Findet die Suche gar nichts, bleibt es bei den bisherigen Werten. Die
   * Seite behauptet dann nichts Falsches: Der Hinweis unter dem Feld sagt,
   * dass zurzeit keine Bestellungen angenommen werden, und der Endpunkt
   * erklärt es beim Absenden noch einmal.
   */
  const fruehester = nextOrderableDay(policy, now);
  const vorbelegt = nextOrderableDay(policy, now, morgen) ?? fruehester ?? morgen;

  const html = renderOrderPage({
    customerName: wache.context.customer.name,

    /**
     * DIESELBE PREISWELT, DIE AUCH DIE BESTELLUNG BEPREIST.
     *
     * Die Seite rechnet nicht selbst und bekommt keine zweite Preisquelle:
     * toCatalogView fragt dasselbe CustomerPriceBook, das placeCafeOrder beim
     * Speichern befragt. Was hier steht, kann deshalb nicht aus einer anderen
     * Logik stammen als das, was gespeichert wird — es kann nur ÄLTER sein,
     * und genau dafür löst der Server beim Schreiben neu auf (§14).
     */
    products: toCatalogView(catalog, priceBook),

    /** Ob überhaupt Preise angezeigt werden können — kein Listencode, keine ID. */
    hasPriceGroup: priceBook.isResolvable(),

    /**
     * Serverseitig erzeugt, einmal je Seitenaufruf. Nicht im Client: Ein
     * Client, der bei jedem Klick eine neue Kennung erzeugte, hätte
     * lediglich zwei Kennungen für dieselbe Absicht und wäre gegen
     * Doppelklicks ungeschützt.
     */
    submissionId: crypto.randomUUID(),

    /**
     * Der Synchronizer-Token der Sitzung. Er steht LESBAR im Dokument, weil
     * das Client-Skript ihn zurücksenden muss — im Unterschied zum
     * Sitzungstoken, der HttpOnly im Cookie bleibt und hier nirgends
     * auftaucht.
     */
    csrfToken: wache.context.csrfToken,

    earliestDate: fruehester ?? today,

    /**
     * Der Wert steht sichtbar im Feld, in der Zusammenfassung und in der
     * Bestätigung, sodass ein abweichender Tag nicht übersehen werden kann.
     */
    defaultDate: vorbelegt,

    /**
     * DIESELBE RICHTLINIE, DIE AUCH DIE BESTELLUNG PRÜFT — und derselbe
     * Wortlaut. Die Seite formuliert nichts selbst; täte sie es, könnte sie
     * etwas anderes behaupten, als der Server tut.
     */
    orderDaysNotice: orderDaysSentence(policy),
    cutoffNotice: cutoffSentence(policy),
  });

  return new Response(html, { status: 200, headers: pageHeaders() });
}

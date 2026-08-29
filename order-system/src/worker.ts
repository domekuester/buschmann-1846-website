import { readAppConfig } from './config/app-config';
import { adminDashboardPage } from './http/admin-dashboard-page';
import { adminPage } from './http/admin-page';
import { adminProductionListPage } from './http/admin-production-list-page';
import { adminPickupListPage } from './http/admin-pickup-list-page';
import { adminCatalogPage } from './http/admin-catalog-page';
import { adminCustomersPage } from './http/admin-customers-page';
import {
  adminCustomerDetailPage,
  matchCustomerDetailPath,
} from './http/admin-customer-detail-page';
import { adminOrderPolicyPage } from './http/admin-order-policy-page';
import { saveOrderPolicyEndpoint } from './http/admin-order-policy-api';
import { saveEmailNotificationsEndpoint } from './http/admin-email-notifications-api';
import { changeOrderStatusEndpoint, matchOrderStatusPath } from './http/admin-order-api';
import {
  changeCustomerPriceGroupEndpoint,
  matchCustomerPriceListPath,
} from './http/admin-customer-api';
import {
  changeProductCatalogLinkEndpoint,
  matchProductCatalogLinkPath,
} from './http/admin-product-catalog-api';
import {
  matchCatalogProductCostPath,
  saveCatalogProductCostEndpoint,
} from './http/admin-product-cost-api';
import {
  createAdminProductEndpoint,
  matchAdminProductPath,
  updateAdminProductEndpoint,
} from './http/admin-product-api';
import {
  createAdminCustomerEndpoint,
  matchAdminCustomerPath,
  matchAdminCustomerPinPath,
  resetAdminCustomerPinEndpoint,
  updateAdminCustomerEndpoint,
} from './http/admin-customer-management-api';
import {
  matchOrderPaymentPath,
  recordOrderPaymentEndpoint,
} from './http/admin-payment-api';
import { loginPage, loginSubmit, logout } from './http/auth-routes';
import { requireSession } from './http/guard';
import { sessionInfo } from './http/session-api';
import { health } from './http/health';
import { toSafeResponse } from './http/error-boundary';
import { createOrder } from './http/order-api';
import { orderPage } from './http/order-page';
import { productionDay } from './http/production-api';
import { cancelOrderPage, matchCancelOrderPath } from './http/admin-cancel-page';
import { methodNotAllowed, notFound } from './http/responses';
import { privateHeaders } from './http/security';
import { createEnvironmentEmailSender } from './infrastructure/email/cloudflare-email-sender';

/**
 * Die äußere Hülle des Systems — und bewusst nicht mehr als das.
 *
 * Hier steht keine Geschäftslogik, keine Preisberechnung und keine
 * Validierung. Der Worker nimmt eine Anfrage entgegen, entscheidet über den
 * Pfad und gibt eine Antwort zurück. Alles Fachliche liegt in src/domain/ und
 * ist ohne Request, Worker-Kontext und D1 testbar; genau das prüft das
 * Vitest-Projekt "domain", das ohne Worker-Runtime läuft.
 *
 * Die Pfade, und jeder hat einen Grund:
 *
 *   GET  /api/health   unverändert aus Phase 1. Braucht als einziger KEINE
 *                      Auth-Konfiguration — sonst wäre nicht zu unterscheiden,
 *                      ob der Worker läuft oder nur falsch eingerichtet ist.
 *   GET  /login        die Loginseite. Ein echtes Formular, kein Skript.
 *   POST /login        die Anmeldung.
 *   POST /logout       die Abmeldung. Niemals GET — ein GET-Logout wird von
 *                      Link-Prefetch und Virenscannern ausgelöst.
 *   GET  /admin        die Admin-Shell. In Phase 3A absichtlich fast leer —
 *                      sie beweist die Auth-Grenze und sonst nichts.
 *   GET  /api/auth/session   wer bin ich. Für beide Rollen, mit einer
 *                      minimalen Antwort.
 *   GET  /api/admin/production-day
 *                      was ist für einen bestimmten Tag zu produzieren. Nur
 *                      für Administration, nur lesend, mit ausdrücklichem
 *                      Datum — kein implizites „heute".
 *   POST /api/admin/orders/:orderNumber/status
 *                      der Statuswechsel einer Bestellung. Der erste
 *                      SCHREIBENDE Adminvorgang und damit der erste mit
 *                      Origin-Prüfung und CSRF-Token im Adminbereich. Die
 *                      Bestellnummer steht im Pfad, weil sie die Bestellung
 *                      benennt — nicht, weil sie autorisiert: Sie ist
 *                      fortlaufend und damit erratbar (siehe
 *                      domain/order-number.ts).
 *   GET  /admin/dashboard
 *                      der Tagesüberblick. Dieselbe Tagesfrage wie /admin und
 *                      eine andere Antwort: Kennzahlen, Umsatz und offene
 *                      Beträge statt Backliste. Lesend; der Zahlungseintrag
 *                      ist ein eigener Endpunkt. Er hat AUSDRÜCKLICH KEINEN
 *                      JSON-Zwilling — Umsatzzahlen in einer zweiten Form
 *                      anzubieten, die niemand aufruft, hieße, sie ein
 *                      zweites Mal absichern zu müssen.
 *   POST /api/admin/orders/:orderNumber/payment
 *                      der Zahlungsstand einer Bestellung. Der vierte
 *                      schreibende Adminvorgang — Origin, Rolle, CSRF-Token,
 *                      danach 303 zurück auf das Dashboard desselben Tages.
 *                      Er schreibt AUSSCHLIESSLICH payment_status und
 *                      payment_recorded_at: keinen Betrag, keinen
 *                      Produktionsstatus, keinen Kunden.
 *   GET  /admin/customers
 *                      Kunden und ihre Preisgruppen. Lesend; der zugehörige
 *                      Schreibvorgang ist ein eigener Endpunkt.
 *   GET  /admin/customers/:customerId
 *                      wer dieser Kunde ist und was er zuletzt bestellt hat.
 *                      Rein lesend, admin only, zwei Abfragen — und
 *                      ausdrücklich OHNE Herstellkosten, Rohertrag und
 *                      Marge: Die Kundenhistorie ist Betrieb und kein
 *                      Controlling.
 *   POST /api/admin/customers/:customerId/price-list
 *                      die Zuordnung eines Kunden zu einer Preisgruppe. Der
 *                      zweite schreibende Adminvorgang — Origin, Rolle,
 *                      CSRF-Token, danach 303 zurück auf die Kundenliste. Er
 *                      wählt KEINEN Bestellpreis: Das bestehende Pricing
 *                      bleibt in dieser Phase unberührt.
 *   POST /api/admin/products/:productId/catalog-link
 *                      die Verknüpfung eines bestellbaren Produkts mit seinem
 *                      Katalogprodukt. Der dritte schreibende Adminvorgang —
 *                      Origin, Rolle, CSRF-Token, danach 303 zurück auf den
 *                      Katalog. Er schreibt AUSSCHLIESSLICH
 *                      products.catalog_product_id und keinen Preis: Welchen
 *                      Preis ein verknüpftes Produkt hat, entscheidet
 *                      unverändert der Resolver aus Phase 5C.
 *   POST /api/admin/catalog-products/:catalogProductId/cost
 *                      die internen Herstellkosten eines Katalogprodukts. Der
 *                      sechste schreibende Adminvorgang — Origin, Rolle,
 *                      CSRF-Token, danach 303 zurück auf den Katalog. Er
 *                      schreibt AUSSCHLIESSLICH
 *                      catalog_products.unit_cost_cents: kein Verkaufspreis,
 *                      keine Bestellung, kein Snapshot einer bestehenden
 *                      Position. Der Wert ist rein intern und erscheint auf
 *                      keiner kundenseitigen Oberfläche.
 *   GET  /admin/bestellregeln
 *                      an welchen Wochentagen bestellt werden kann und wann
 *                      Bestellschluss ist. Lesend; genau EINE Abfrage auf eine
 *                      Tabelle mit einer Zeile.
 *   POST /api/admin/order-policy
 *                      die Bestellregeln speichern. Der fünfte schreibende
 *                      Adminvorgang — Origin, Rolle, CSRF-Token, danach 303
 *                      zurück auf die Regelseite. Er fasst AUSSCHLIESSLICH
 *                      die eine Zeile in order_policy an: keine Bestellung
 *                      wird geändert, verschoben oder storniert.
 *   GET  /bestellen    die Bestellseite. Das Café kommt aus der Sitzung, nicht
 *                      mehr aus einem Link.
 *   POST /api/orders   die Bestellung. Sitzung, Origin und CSRF-Token.
 *
 * /assets/* taucht hier nicht auf: Diese Dateien liefert die Plattform aus,
 * bevor der Worker überhaupt erreicht wird (siehe wrangler.jsonc).
 *
 * DIE KONFIGURATION WIRD FRÜH GELESEN UND KANN WERFEN.
 *
 * readAppConfig prüft Pepper, Origin und Umgebung und bricht ab, wenn etwas
 * fehlt oder sich widerspricht. Der Aufruf steht INNERHALB des try, damit
 * daraus eine 500 ohne Details wird — und NACH /api/health, damit ein
 * falsch konfigurierter Worker immer noch sagen kann, dass er läuft.
 *
 * Der try/catch ist die einzige Fehlergrenze des Systems. Was hier ankommt,
 * kann ein D1-Fehler mit SQL-Fragment oder ein Stacktrace mit Dateipfaden
 * sein; toSafeResponse sorgt dafür, dass nichts davon den Worker verlässt.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = new Date();

    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET') {
          return methodNotAllowed('GET');
        }
        return await health(env.DB);
      }

      const config = readAppConfig(env);

      if (pathname === '/login') {
        if (request.method === 'GET' || request.method === 'HEAD') {
          return await loginPage(env.DB, config, request, now);
        }
        if (request.method === 'POST') {
          return await loginSubmit(env.DB, config, request, now);
        }
        return methodNotAllowed('GET, POST');
      }

      if (pathname === '/logout') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST');
        }
        return await logout(env.DB, config, request, now);
      }

      if (pathname === '/bestellen') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET');
        }
        return await orderPage(env.DB, config, request, now);
      }

      if (pathname === '/admin') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET');
        }
        return await adminDashboardPage(env.DB, config, request, now, 'overview');
      }

      if (pathname === '/admin/dashboard') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminDashboardPage(env.DB, config, request, now, 'legacy');
      }

      if (pathname === '/admin/orders') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminDashboardPage(env.DB, config, request, now, 'orders');
      }

      if (pathname === '/admin/production') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminPage(env.DB, config, request, now);
      }

      if (pathname === '/admin/production-list') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminProductionListPage(env.DB, config, request, now);
      }

      if (pathname === '/admin/abholliste') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminPickupListPage(env.DB, config, request, now);
      }

      if (pathname === '/admin/catalog') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminCatalogPage(env.DB, config, request, now);
      }

      if (pathname === '/admin/customers') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminCustomersPage(env.DB, config, request, now);
      }

      /**
       * Die Detailansicht EINES Kunden — die sechste Route mit einem
       * veränderlichen Pfadteil und die erste LESENDE unter ihnen.
       *
       * Sie steht unmittelbar hinter '/admin/customers' und kann damit nicht
       * kollidieren: Jener Pfad wird als Gleichheit erkannt und ist hier
       * bereits beantwortet; dieses Muster verlangt ein weiteres Segment.
       *
       * Die 405 trägt privateHeaders(), damit auch die abweisende Antwort
       * no-store trägt — wie bei jeder Adminroute.
       */
      const customerDetailSegment = matchCustomerDetailPath(pathname);
      if (customerDetailSegment !== null) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminCustomerDetailPage(
          env.DB,
          config,
          request,
          now,
          customerDetailSegment,
        );
      }

      if (pathname === '/admin/bestellregeln') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminOrderPolicyPage(env.DB, config, request, now);
      }

      if (pathname === '/admin/settings') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await adminOrderPolicyPage(env.DB, config, request, now);
      }

      /**
       * Der einzige schreibende Adminendpunkt OHNE veränderlichen Pfadteil:
       * Es gibt genau eine Bestellrichtlinie, und deshalb steht in diesem
       * Pfad keine Kennung, die man prüfen müsste.
       */
      if (pathname === '/api/admin/order-policy') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await saveOrderPolicyEndpoint(env.DB, config, request, now);
      }

      if (pathname === '/api/admin/email-notifications') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await saveEmailNotificationsEndpoint(env.DB, config, request, now);
      }

      if (pathname === '/api/admin/products') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await createAdminProductEndpoint(env.DB, config, request, now);
      }

      if (pathname === '/api/admin/customers') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await createAdminCustomerEndpoint(env.DB, config, request, now);
      }

      const cancelOrderNumber = matchCancelOrderPath(pathname);
      if (cancelOrderNumber !== null) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET', privateHeaders());
        }
        return await cancelOrderPage(env.DB, config, request, now, cancelOrderNumber);
      }

      if (pathname === '/api/auth/session') {
        if (request.method !== 'GET') {
          return methodNotAllowed('GET');
        }
        // Der einzige Endpunkt ohne Rollenvorgabe: „wer bin ich?" beantworten
        // beide Rollen für sich selbst. Eine Sitzung wird trotzdem verlangt.
        const wache = await requireSession(env.DB, config, request, now, 'api');
        return wache.ok ? sessionInfo(wache.context) : wache.response;
      }

      if (pathname === '/api/admin/production-day') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET');
        }
        return await productionDay(env.DB, config, request, now);
      }

      /**
       * Die einzige Route mit einem veränderlichen Pfadteil. Sie steht
       * deshalb nicht in der Kette der Gleichheitsvergleiche, sondern wird
       * gesondert erkannt — von der Datei, die auch den Endpunkt enthält.
       *
       * Die 405 trägt hier privateHeaders() und nicht die nackte Antwort aus
       * responses.ts: Jede Antwort dieses Endpunkts soll no-store tragen,
       * auch die abweisende.
       */
      const orderNumberSegment = matchOrderStatusPath(pathname);
      if (orderNumberSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await changeOrderStatusEndpoint(
          env.DB,
          config,
          request,
          now,
          orderNumberSegment,
        );
      }

      /**
       * Die zweite Route mit einem veränderlichen Pfadteil — erkannt von der
       * Datei, die auch den Endpunkt enthält. Die 405 trägt privateHeaders(),
       * damit auch die abweisende Antwort no-store trägt.
       */
      const customerIdSegment = matchCustomerPriceListPath(pathname);
      if (customerIdSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await changeCustomerPriceGroupEndpoint(
          env.DB,
          config,
          request,
          now,
          customerIdSegment,
        );
      }

      const managedCustomerPinIdSegment = matchAdminCustomerPinPath(pathname);
      if (managedCustomerPinIdSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await resetAdminCustomerPinEndpoint(
          env.DB,
          config,
          request,
          now,
          managedCustomerPinIdSegment,
        );
      }

      const managedCustomerIdSegment = matchAdminCustomerPath(pathname);
      if (managedCustomerIdSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await updateAdminCustomerEndpoint(
          env.DB,
          config,
          request,
          now,
          managedCustomerIdSegment,
        );
      }

      /**
       * Die dritte Route mit einem veränderlichen Pfadteil — erkannt von der
       * Datei, die auch den Endpunkt enthält. Die 405 trägt privateHeaders(),
       * damit auch die abweisende Antwort no-store trägt.
       */
      const productIdSegment = matchProductCatalogLinkPath(pathname);
      if (productIdSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await changeProductCatalogLinkEndpoint(
          env.DB,
          config,
          request,
          now,
          productIdSegment,
        );
      }

      const managedProductIdSegment = matchAdminProductPath(pathname);
      if (managedProductIdSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await updateAdminProductEndpoint(
          env.DB,
          config,
          request,
          now,
          managedProductIdSegment,
        );
      }

      /**
       * Die fünfte Route mit einem veränderlichen Pfadteil — erkannt von der
       * Datei, die auch den Endpunkt enthält. Sie kann mit
       * matchProductCatalogLinkPath nicht kollidieren: Jene beginnt mit
       * '/api/admin/products/', diese mit '/api/admin/catalog-products/', und
       * ein Pfad kann nicht auf beide passen.
       */
      const catalogProductIdSegment = matchCatalogProductCostPath(pathname);
      if (catalogProductIdSegment !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await saveCatalogProductCostEndpoint(
          env.DB,
          config,
          request,
          now,
          catalogProductIdSegment,
        );
      }

      /**
       * Die vierte Route mit einem veränderlichen Pfadteil — erkannt von der
       * Datei, die auch den Endpunkt enthält. Die 405 trägt privateHeaders(),
       * damit auch die abweisende Antwort no-store trägt.
       *
       * Sie steht NACH matchOrderStatusPath und kann mit ihr nicht
       * kollidieren: Beide Muster enden auf verschiedene feste Segmente
       * ('/status' und '/payment'), und ein Pfad kann nicht auf beide passen.
       */
      const paymentOrderNumber = matchOrderPaymentPath(pathname);
      if (paymentOrderNumber !== null) {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST', privateHeaders());
        }
        return await recordOrderPaymentEndpoint(
          env.DB,
          config,
          request,
          now,
          paymentOrderNumber,
        );
      }

      if (pathname === '/api/orders') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST');
        }
        return await createOrder(
          env.DB,
          config,
          request,
          now,
          createEnvironmentEmailSender(env),
        );
      }

      return notFound();
    } catch (error) {
      return toSafeResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

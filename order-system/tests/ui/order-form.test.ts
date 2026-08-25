import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initOrderForm } from '../../public/assets/order-form.js';
import { renderOrderPage } from '../../src/ui/order-page-html';

/**
 * Das Client-Skript gegen GENAU DAS HTML, das der Server ausliefert.
 *
 * Das Test-DOM wird nicht von Hand geschrieben, sondern aus renderOrderPage()
 * erzeugt. Ein handgeschriebenes Fragment bliebe grün, während die echte
 * Seite kaputt ist — etwa weil ein data-Attribut umbenannt wurde.
 */
/**
 * Der CSRF-Token der Sitzung. Er steht im Dokument, weil das Skript ihn
 * zurücksenden muss — der Sitzungstoken dagegen liegt HttpOnly im Cookie und
 * kommt in diesem Test nirgends vor, weil er im Browser nirgends vorkommt.
 */
const CSRF = 'C'.repeat(43);

function setUpPage(): void {
  document.documentElement.innerHTML = renderOrderPage({
    customerName: 'Testcafé Nord',
    products: [
      { id: 1, name: 'Beispiel Käsekuchen', description: 'Mit Sahne', unit: 'Stück', price: { kind: 'fixed', priceCents: 435 } },
      { id: 2, name: 'Beispiel Streuselblech', description: null, unit: 'Blech', price: { kind: 'fixed', priceCents: 280 } },
    ],
    submissionId: 'sub-0123-4567-89ab',
    csrfToken: CSRF,
    today: '2026-08-24',
    defaultDate: '2026-08-25',
    hasPriceGroup: true,
  })
    // Nur <html>-Inhalt; doctype und äußeres Tag gehören nicht in innerHTML.
    .replace(/^[\s\S]*?<html[^>]*>/, '')
    .replace(/<\/html>\s*$/, '');

  window.history.replaceState({}, '', '/bestellen');
}

function form(): HTMLFormElement {
  return document.querySelector('[data-order-form]') as HTMLFormElement;
}
function quantities(): HTMLInputElement[] {
  return [...document.querySelectorAll('[data-quantity]')] as HTMLInputElement[];
}
function stepper(row: number, direction: 1 | -1): HTMLButtonElement {
  const rows = document.querySelectorAll('[data-product-row]');
  return rows[row]?.querySelector(`[data-step="${direction}"]`) as HTMLButtonElement;
}
function submitButton(): HTMLButtonElement {
  return document.querySelector('[data-submit]') as HTMLButtonElement;
}
function text(selector: string): string {
  return (document.querySelector(selector) as HTMLElement | null)?.textContent?.trim() ?? '';
}
function visibleFormError(): string {
  const banner = document.querySelector('[data-form-error]') as HTMLElement;
  return banner.hidden ? '' : (banner.textContent ?? '').trim();
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CONFIRMATION = {
  order_number: 'BUS-2026-000001',
  fulfillment_date: '2026-08-25',
  total_cents: 1305,
  items: [{ name: 'Beispiel Käsekuchen', quantity: 3, unit: 'Stück' }],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setUpPage();
  fetchMock = vi.fn(async () => jsonResponse(201, CONFIRMATION));
  vi.stubGlobal('fetch', fetchMock);
  initOrderForm(document);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Mengensteuerung', () => {
  it('erhöht die Menge mit +', () => {
    stepper(0, 1).click();
    expect(quantities()[0]?.value).toBe('1');

    stepper(0, 1).click();
    stepper(0, 1).click();
    expect(quantities()[0]?.value).toBe('3');
  });

  it('verringert die Menge mit −', () => {
    stepper(0, 1).click();
    stepper(0, 1).click();
    stepper(0, -1).click();
    expect(quantities()[0]?.value).toBe('1');
  });

  it('geht nie unter 0', () => {
    stepper(0, -1).click();
    stepper(0, -1).click();
    expect(quantities()[0]?.value).toBe('0');
  });

  it('sperrt − bei 0 und gibt es darüber wieder frei', () => {
    expect(stepper(0, -1).disabled).toBe(true);

    stepper(0, 1).click();
    expect(stepper(0, -1).disabled).toBe(false);

    stepper(0, -1).click();
    expect(stepper(0, -1).disabled).toBe(true);
  });

  it('hält die Obergrenze ein', () => {
    const input = quantities()[0] as HTMLInputElement;
    input.value = '9999';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    stepper(0, 1).click();
    expect(input.value).toBe('9999');
  });

  it('ändert nur die Zeile, auf die getippt wurde', () => {
    stepper(1, 1).click();
    expect(quantities()[0]?.value).toBe('0');
    expect(quantities()[1]?.value).toBe('1');
  });

  it('normalisiert eine unsinnige Tastatureingabe', () => {
    const input = quantities()[0] as HTMLInputElement;

    for (const [eingabe, erwartet] of [['-5', '0'], ['2,5', '2'], ['abc', '0'], ['', '0'], ['99999', '9999']]) {
      input.value = eingabe as string;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      expect(input.value).toBe(erwartet);
    }
  });

  it('meldet jede Änderung an die Vorlesehilfe', () => {
    stepper(0, 1).click();
    expect(text('[data-live-region]')).toContain('Beispiel Käsekuchen');
    expect(text('[data-live-region]')).toContain('1');
  });

  it('hebt Zeilen mit Menge hervor — und nicht nur farblich', () => {
    const row = document.querySelectorAll('[data-product-row]')[0] as HTMLElement;
    expect(row.dataset['selected']).toBeUndefined();

    stepper(0, 1).click();
    expect(row.dataset['selected']).toBe('true');

    stepper(0, -1).click();
    expect(row.dataset['selected']).toBeUndefined();
  });
});

describe('Zusammenfassung', () => {
  it('beginnt bei null', () => {
    expect(text('[data-summary-total]')).toBe('0,00 €');
    expect(text('[data-summary-lines]')).toContain('Noch nichts');
  });

  it('rechnet die Zwischensumme mit', () => {
    stepper(0, 1).click();
    stepper(0, 1).click();
    stepper(0, 1).click();
    expect(text('[data-summary-total]')).toBe('13,05 €');
    expect(text('[data-summary-lines]')).toContain('1 Position');

    stepper(1, 1).click();
    expect(text('[data-summary-total]')).toBe('15,85 €');
    expect(text('[data-summary-lines]')).toContain('2 Positionen');
  });

  it('geht wieder auf null zurück', () => {
    stepper(0, 1).click();
    stepper(0, -1).click();
    expect(text('[data-summary-total]')).toBe('0,00 €');
  });
});

describe('Absenden verhindern', () => {
  it('sendet ohne Auswahl nichts und sagt warum', () => {
    submitButton().click();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(visibleFormError()).toContain('mindestens ein Produkt');
  });

  it('räumt die Meldung weg, sobald etwas ausgewählt ist', () => {
    submitButton().click();
    expect(visibleFormError()).not.toBe('');

    stepper(0, 1).click();
    expect(visibleFormError()).toBe('');
  });

  it('sendet ohne Liefertag nichts', () => {
    stepper(0, 1).click();
    (document.querySelector('#liefertag') as HTMLInputElement).value = '';

    submitButton().click();

    expect(fetchMock).not.toHaveBeenCalled();
    const feld = document.querySelector('[data-error-for="fulfillment_date"]') as HTMLElement;
    expect(feld.hidden).toBe(false);
  });
});

describe('Absenden', () => {
  async function submitWithThree(): Promise<void> {
    stepper(0, 1).click();
    stepper(0, 1).click();
    stepper(0, 1).click();
    submitButton().click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('schickt CSRF-Token, Kennung und nur Produkt-ID und Menge', async () => {
    await submitWithThree();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/orders');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe(CSRF);

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['submission_id']).toBe('sub-0123-4567-89ab');
    expect(body['fulfillment_date']).toBe('2026-08-25');
    expect(body['items']).toEqual([{ product_id: 1, quantity: 3 }]);
  });

  /** Der Client bestimmt keine Preise. Er sendet sie deshalb gar nicht erst. */
  it('sendet keinerlei Preisangabe', async () => {
    await submitWithThree();

    const raw = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string;
    for (const leak of ['price', 'cents', 'total', 'amount', 'customer']) {
      expect(raw.toLowerCase()).not.toContain(leak);
    }
  });

  it('lässt Positionen mit Menge 0 weg', async () => {
    stepper(0, 1).click();
    stepper(1, 1).click();
    stepper(1, -1).click();
    submitButton().click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.items).toEqual([{ product_id: 1, quantity: 1 }]);
  });

  it('schickt eine Notiz nur, wenn eine da ist', async () => {
    (document.querySelector('#notiz') as HTMLTextAreaElement).value = '  Bitte kühl stellen  ';
    await submitWithThree();

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.note).toBe('Bitte kühl stellen');
  });
});

describe('Erfolg', () => {
  async function succeed(status = 201): Promise<void> {
    fetchMock.mockResolvedValue(jsonResponse(status, CONFIRMATION));
    stepper(0, 1).click();
    submitButton().click();
    await vi.waitFor(() =>
      expect((document.querySelector('[data-confirmation]') as HTMLElement).hidden).toBe(false),
    );
  }

  it('zeigt die Bestellnummer', async () => {
    await succeed();
    expect(text('[data-confirmation]')).toContain('BUS-2026-000001');
  });

  it('zeigt den Liefertag ausgeschrieben', async () => {
    await succeed();
    expect(text('[data-confirmation]')).toContain('Dienstag, 25. August 2026');
  });

  it('zeigt, was tatsächlich bestellt wurde, und die Summe', async () => {
    await succeed();
    const bestaetigung = text('[data-confirmation]');
    expect(bestaetigung).toContain('Beispiel Käsekuchen');
    expect(bestaetigung).toContain('3');
    expect(bestaetigung).toContain('13,05 €');
  });

  it('sagt eindeutig, dass die Bestellung angekommen ist', async () => {
    await succeed();
    expect(text('[data-confirmation]')).toContain('angekommen');
  });

  it('nimmt das Formular und die Fußleiste aus dem Weg', async () => {
    await succeed();
    expect(form().hidden).toBe(true);
    expect((document.querySelector('[data-summary-bar]') as HTMLElement).hidden).toBe(true);
  });

  it('führt den Fokus zur Bestätigung', async () => {
    await succeed();
    expect(document.activeElement).toBe(document.querySelector('[data-confirmation]'));
  });

  /** 200 heißt „dieselbe Bestellung nochmal" — für das Café dasselbe Bild. */
  it('sieht bei einer wiederholten Absendung genauso aus', async () => {
    await succeed(200);
    expect(text('[data-confirmation]')).toContain('BUS-2026-000001');
  });
});

describe('Doppelklick', () => {
  it('sperrt den Button während des Absendens', async () => {
    let freigeben: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (freigeben = resolve)));

    stepper(0, 1).click();
    submitButton().click();

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().getAttribute('aria-busy')).toBe('true');
    expect(submitButton().textContent).toContain('Wird gesendet');

    freigeben(jsonResponse(201, CONFIRMATION));
  });

  it('löst bei einem zweiten Tippen keine zweite Anfrage aus', async () => {
    let freigeben: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (freigeben = resolve)));

    stepper(0, 1).click();
    submitButton().click();
    submitButton().click();
    submitButton().click();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    freigeben(jsonResponse(201, CONFIRMATION));
  });
});

describe('Fehler', () => {
  async function fail(response: Response | Error): Promise<void> {
    if (response instanceof Error) {
      fetchMock.mockRejectedValue(response);
    } else {
      fetchMock.mockResolvedValue(response);
    }
    stepper(0, 1).click();
    submitButton().click();
    await vi.waitFor(() => expect(visibleFormError()).not.toBe(''));
  }

  it('heftet einen Feldfehler an sein Feld', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        error: 'validation_failed',
        errors: { fulfillment_date: 'Der Liefertag darf nicht in der Vergangenheit liegen.' },
      }),
    );

    stepper(0, 1).click();
    submitButton().click();

    const feld = document.querySelector('[data-error-for="fulfillment_date"]') as HTMLElement;
    await vi.waitFor(() => expect(feld.hidden).toBe(false));

    expect(feld.textContent).toContain('Vergangenheit');
    expect(document.querySelector('#liefertag')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('sagt bei einem Serverfehler unmissverständlich, dass NICHT bestellt wurde', async () => {
    await fail(jsonResponse(500, { error: 'internal_error' }));
    // Groß-/Kleinschreibung offen gelassen: Die Betonung des „nicht" darf am
    // Text geändert werden, die Aussage nicht.
    expect(visibleFormError()).toMatch(/nicht bestätigt/i);
    expect(visibleFormError()).toMatch(/noch einmal senden|anrufen/i);
  });

  it('sagt dasselbe, wenn gar keine Verbindung zustande kommt', async () => {
    await fail(new TypeError('Failed to fetch'));
    expect(visibleFormError()).toMatch(/nicht bestätigt/i);
  });

  /**
   * 401 heißt: Die Sitzung gilt nicht mehr. Der gefährliche Zustand wäre
   * Ungewissheit — deshalb steht ausdrücklich da, dass NICHTS bestellt wurde.
   */
  it('sagt bei abgelaufener Sitzung, dass nichts bestellt wurde', async () => {
    await fail(jsonResponse(401, { error: 'unauthorized' }));

    const banner = visibleFormError();
    expect(banner).toContain('NICHT aufgenommen');
    expect(banner).toContain('neu anmelden');
  });

  /** 403 — Rolle, Origin oder CSRF-Token. Für das Café derselbe Zustand. */
  it('behandelt 403 wie eine abgelaufene Sitzung', async () => {
    await fail(jsonResponse(403, { error: 'forbidden' }));
    expect(visibleFormError()).toContain('NICHT aufgenommen');
  });

  it('zeigt niemals eine technische Meldung', async () => {
    await fail(jsonResponse(500, { error: 'internal_error', detail: 'D1_ERROR: near "SELECT"' }));

    const banner = visibleFormError();
    for (const leak of ['D1_ERROR', 'SELECT', 'internal_error', '500', 'undefined']) {
      expect(banner).not.toContain(leak);
    }
  });

  it('gibt den Button wieder frei, damit erneut gesendet werden kann', async () => {
    await fail(jsonResponse(500, { error: 'internal_error' }));

    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toContain('Bestellung senden');
  });

  it('behält die eingestellten Mengen', async () => {
    await fail(jsonResponse(500, { error: 'internal_error' }));
    expect(quantities()[0]?.value).toBe('1');
  });

  it('zeigt keine Bestätigung', async () => {
    await fail(jsonResponse(500, { error: 'internal_error' }));
    expect((document.querySelector('[data-confirmation]') as HTMLElement).hidden).toBe(true);
  });
});

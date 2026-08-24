/**
 * Das Verhalten der Bestellseite.
 *
 * Reines ES2022, kein Framework, kein Build-Schritt, kein Bundle. Der Browser
 * lädt diese Datei so, wie sie hier steht — es gibt keinen Zwischenschritt, in
 * dem etwas anderes daraus werden könnte.
 *
 * Die Aufgabenteilung mit dem Server ist streng:
 *
 *   Der Server bestimmt Preise, Kunde, Fulfillment-Typ, Status und
 *   Bestellnummer. Diese Datei berechnet eine Zwischensumme AUSSCHLIESSLICH
 *   zur Anzeige und sendet nichts davon mit — im Anfragekörper stehen nur
 *   Produkt-IDs, Mengen, Liefertag, Notiz und die Absendekennung.
 *
 *   Der KUNDE steht nicht im Körper und kann es nicht: Er kommt aus der
 *   Sitzung. Ein hier mitgesendetes customerId würde vom Server nicht
 *   gelesen — es gibt dort keine Stelle dafür.
 *
 * Geprüft wird sie in tests/ui/ gegen genau das HTML, das der Server
 * ausliefert — nicht gegen ein Testfragment.
 */

const MAX_QUANTITY = 9999;

/**
 * Alles, was das Formular an veränderlichem Zustand hat — an einer Stelle,
 * damit keine Funktion sich Elemente selbst zusammensucht.
 *
 * @typedef {{
 *   form: HTMLFormElement,
 *   root: Document,
 *   submitButton: HTMLButtonElement,
 *   summaryBar: HTMLElement,
 *   summaryLines: HTMLElement,
 *   summaryTotal: HTMLElement,
 *   confirmation: HTMLElement,
 *   formError: HTMLElement,
 *   liveRegion: HTMLElement,
 *   dateField: HTMLInputElement,
 *   noteField: HTMLTextAreaElement,
 *   quantities: HTMLInputElement[],
 *   submitting: boolean,
 * }} FormState
 */

/**
 * Die Bestätigung, wie der Server sie schickt.
 *
 * @typedef {{
 *   order_number?: string,
 *   fulfillment_date?: string,
 *   total_cents?: number,
 *   items?: { name: string, quantity: number, unit: string }[],
 * }} Confirmation
 */

/**
 * @param {Document} root
 */
export function initOrderForm(root) {
  const form = /** @type {HTMLFormElement | null} */ (root.querySelector('[data-order-form]'));
  if (form === null) return;

  /** @type {FormState} */
  const state = {
    form,
    root,
    submitButton: /** @type {HTMLButtonElement} */ (root.querySelector('[data-submit]')),
    summaryBar: /** @type {HTMLElement} */ (root.querySelector('[data-summary-bar]')),
    summaryLines: /** @type {HTMLElement} */ (root.querySelector('[data-summary-lines]')),
    summaryTotal: /** @type {HTMLElement} */ (root.querySelector('[data-summary-total]')),
    confirmation: /** @type {HTMLElement} */ (root.querySelector('[data-confirmation]')),
    formError: /** @type {HTMLElement} */ (root.querySelector('[data-form-error]')),
    liveRegion: /** @type {HTMLElement} */ (root.querySelector('[data-live-region]')),
    dateField: /** @type {HTMLInputElement} */ (root.querySelector('#liefertag')),
    noteField: /** @type {HTMLTextAreaElement} */ (root.querySelector('#notiz')),
    quantities: /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-quantity]')]),
    submitting: false,
  };

  for (const button of root.querySelectorAll('[data-step]')) {
    button.addEventListener('click', () => {
      const input = quantityOf(button);
      if (input === null) return;
      const step = Number(button.getAttribute('data-step'));
      setQuantity(state, input, readQuantity(input) + step, true);
    });
  }

  for (const input of state.quantities) {
    // 'input' für die laufende Eingabe, 'change' für das Verlassen des
    // Feldes. Nur eines von beiden würde entweder die Zusammenfassung
    // einfrieren oder eine halb getippte Zahl sofort umschreiben.
    input.addEventListener('input', () => refresh(state));
    input.addEventListener('change', () => setQuantity(state, input, readQuantity(input), false));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(state);
  });

  refresh(state);
}

/**
 * @param {Element} button
 * @returns {HTMLInputElement | null}
 */
function quantityOf(button) {
  return /** @type {HTMLInputElement | null} */ (
    button.closest('[data-product-row]')?.querySelector('[data-quantity]') ?? null
  );
}

/**
 * Liest die Menge als ganze Zahl im gültigen Bereich.
 *
 * Bewusst nicht über Number(): Number('') ist 0, Number('  2 ') ist 2 und
 * Number('2e3') ist 2000. Hier soll nur durchkommen, was jemand als Menge
 * eingetippt haben kann.
 *
 * @param {HTMLInputElement} input
 */
function readQuantity(input) {
  const digits = input.value.trim().match(/^\d+/);
  if (digits === null) return 0;
  return Math.min(Number(digits[0]), MAX_QUANTITY);
}

/**
 * @param {FormState} state
 * @param {HTMLInputElement} input
 * @param {number} value
 * @param {boolean} announce
 */
/**
 * @param {FormState} state
 * @param {HTMLInputElement} input
 * @param {number} value
 * @param {boolean} announce
 */
function setQuantity(state, input, value, announce) {
  const clamped = Math.max(0, Math.min(Math.trunc(value), MAX_QUANTITY));
  input.value = String(clamped);

  if (announce) {
    // Die Vorlesehilfe bekommt Produkt UND Menge. „3" allein wäre in einer
    // Liste von zwölf Produkten wertlos.
    const name = input.getAttribute('data-product-name') ?? '';
    const unit = input.getAttribute('data-product-unit') ?? '';
    state.liveRegion.textContent = `${name}: ${clamped} ${unit}`;
  }

  refresh(state);
}

/** Zusammenfassung, Steppertasten und Zeilenhervorhebung neu setzen. */
/** @param {FormState} state */
function refresh(state) {
  let lines = 0;
  let totalCents = 0;

  for (const input of state.quantities) {
    const quantity = readQuantity(input);
    const row = /** @type {HTMLElement | null} */ (input.closest('[data-product-row]'));
    const minus = /** @type {HTMLButtonElement | null} */ (
      row?.querySelector('[data-step="-1"]') ?? null
    );

    if (minus !== null) minus.disabled = quantity === 0;

    if (row !== null) {
      // Ein data-Attribut statt einer Klasse: Der Zustand steht damit im DOM
      // und ist prüfbar, ohne dass ein Test von einem Klassennamen abhängt.
      if (quantity > 0) row.dataset['selected'] = 'true';
      else delete row.dataset['selected'];
    }

    if (quantity > 0) {
      lines += 1;
      totalCents += quantity * Number(input.getAttribute('data-price-cents'));
    }
  }

  state.summaryLines.textContent =
    lines === 0 ? 'Noch nichts ausgewählt' : lines === 1 ? '1 Position' : `${lines} Positionen`;
  state.summaryTotal.textContent = formatEuro(totalCents);

  if (lines > 0) hide(state.formError);
}

/**
 * Absenden.
 *
 * Der Doppelklick-Schutz beginnt hier — mit einem sofortigen `submitting`,
 * bevor irgendetwas Asynchrones passiert. Der Server hat seinen eigenen
 * Schutz über die Absendekennung; dieser hier erspart dem Café lediglich das
 * Warten auf eine Antwort, die es ohnehin nicht anders sähe.
 */
/** @param {FormState} state */
async function submit(state) {
  if (state.submitting) return;

  const items = collectItems(state);
  if (items.length === 0) {
    show(state.formError, 'Bitte mindestens ein Produkt auswählen.');
    state.quantities[0]?.focus();
    return;
  }

  if (state.dateField.value === '') {
    showFieldError(state, 'fulfillment_date', 'Bitte einen Liefertag auswählen.');
    return;
  }

  clearErrors(state);
  setSubmitting(state, true);

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Der Sitzungstoken liegt HttpOnly im Cookie und ist hier unsichtbar
        // — der Browser schickt ihn von sich aus mit. Was dieses Skript
        // beitragen muss, ist der CSRF-Token: der Nachweis, dass die Anfrage
        // von dieser Seite kommt und nicht von einer fremden.
        'x-csrf-token': state.form.getAttribute('data-csrf') ?? '',
      },
      body: JSON.stringify({
        submission_id: state.form.getAttribute('data-submission-id'),
        fulfillment_date: state.dateField.value,
        note: state.noteField.value.trim() || null,
        items,
      }),
    });

    // 201 neu angelegt, 200 dieselbe Bestellung noch einmal. Für das Café ist
    // beides derselbe Erfolg, und das ist beabsichtigt.
    if (response.status === 201 || response.status === 200) {
      showConfirmation(state, await response.json());
      return;
    }

    if (response.status === 422) {
      const body = await response.json();
      showValidationErrors(state, body?.errors ?? {});
      setSubmitting(state, false);
      return;
    }

    // 401 die Sitzung ist abgelaufen oder widerrufen, 403 Rolle, Origin oder
    // CSRF-Token stimmen nicht. Für das Café ist beides derselbe Zustand:
    // neu anmelden. Der Text sagt ausdrücklich, dass NICHTS bestellt wurde —
    // der gefährliche Zustand wäre Ungewissheit.
    if (response.status === 401 || response.status === 403) {
      show(
        state.formError,
        'Die Anmeldung gilt nicht mehr. Die Bestellung wurde NICHT aufgenommen — ' +
          'bitte neu anmelden.',
      );
      setSubmitting(state, false);
      return;
    }

    throw new Error('unerwartete Antwort');
  } catch {
    /**
     * Der gefährliche Zustand wäre: „Das Café weiß nicht, ob die Bestellung
     * angekommen ist." Deshalb steht hier keine vage Entschuldigung, sondern
     * eine Aussage — und die Mengen bleiben stehen, damit ein zweiter Versuch
     * ein Tap ist.
     */
    show(
      state.formError,
      'Die Bestellung wurde NICHT bestätigt. Bitte noch einmal senden — ' +
        'oder kurz bei Buschmann 1846 anrufen.',
    );
    setSubmitting(state, false);
  }
}

/**
 * @param {FormState} state
 * @returns {{ product_id: number, quantity: number }[]}
 */
function collectItems(state) {
  const items = [];
  for (const input of state.quantities) {
    const quantity = readQuantity(input);
    // Menge 0 heißt „nicht bestellt" und wird gar nicht erst gesendet.
    if (quantity > 0) {
      items.push({ product_id: Number(input.getAttribute('data-product-id')), quantity });
    }
  }
  return items;
}

/**
 * @param {FormState} state
 * @param {boolean} submitting
 */
function setSubmitting(state, submitting) {
  state.submitting = submitting;
  state.submitButton.disabled = submitting;
  state.submitButton.setAttribute('aria-busy', String(submitting));
  state.submitButton.textContent = submitting ? 'Wird gesendet …' : 'Bestellung senden';
}

/**
 * @param {FormState} state
 * @param {Confirmation} data
 */
function showConfirmation(state, data) {
  const lines = (data?.items ?? [])
    .map((item) => `<li>${escapeHtml(String(item.quantity))} × ${escapeHtml(String(item.name))}</li>`)
    .join('');

  state.confirmation.innerHTML = `
    <p class="bestaetigung__ok">Bestellung ist angekommen.</p>
    <p class="bestaetigung__nummer">${escapeHtml(String(data?.order_number ?? ''))}</p>
    <p class="bestaetigung__label">Liefertag</p>
    <p class="bestaetigung__tag">${escapeHtml(formatGermanDate(String(data?.fulfillment_date ?? '')))}</p>
    <ul class="bestaetigung__positionen">${lines}</ul>
    <p class="bestaetigung__summe">Summe ${escapeHtml(formatEuro(Number(data?.total_cents ?? 0)))}</p>
    <p class="bestaetigung__text">Wir haben deine Bestellung erhalten.</p>
    <button type="button" class="senden senden--zweit" data-restart>Neue Bestellung</button>
  `;

  state.form.hidden = true;
  state.summaryBar.hidden = true;
  state.confirmation.hidden = false;
  state.confirmation.focus();

  // Neu laden statt Formular zurücksetzen: Eine neue Bestellung braucht eine
  // neue Absendekennung, und die kommt vom Server.
  state.confirmation
    .querySelector('[data-restart]')
    ?.addEventListener('click', () => window.location.reload());
}

/**
 * @param {FormState} state
 * @param {Record<string, string>} errors
 */
function showValidationErrors(state, errors) {
  let firstField = null;

  for (const [field, message] of Object.entries(errors)) {
    // 'items.0.quantity' wird an der Produktliste angezeigt, nicht an einem
    // Feld, das es im Formular nicht gibt.
    const target = field.startsWith('items') ? 'items' : field;
    const shown = showFieldError(state, target, String(message));
    if (shown && firstField === null) firstField = target;
  }

  if (firstField === null) {
    show(state.formError, Object.values(errors)[0] ?? 'Bitte die Eingaben prüfen.');
  }
}

/**
 * @param {FormState} state
 * @param {string} field
 * @param {string} message
 * @returns {boolean} ob es für dieses Feld eine Anzeigestelle gab
 */
function showFieldError(state, field, message) {
  const target = /** @type {HTMLElement | null} */ (
    state.root.querySelector(`[data-error-for="${field}"]`)
  );

  if (target === null) {
    show(state.formError, message);
    return false;
  }

  show(target, message);

  const input = field === 'fulfillment_date' ? state.dateField : field === 'note' ? state.noteField : null;
  if (input !== null) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  return true;
}

/** @param {FormState} state */
function clearErrors(state) {
  hide(state.formError);
  for (const node of state.root.querySelectorAll('[data-error-for]')) {
    hide(/** @type {HTMLElement} */ (node));
  }
  state.dateField.removeAttribute('aria-invalid');
  state.noteField.removeAttribute('aria-invalid');
}

/**
 * @param {HTMLElement} element
 * @param {string} message
 */
function show(element, message) {
  element.textContent = message;
  element.hidden = false;
}

/** @param {HTMLElement} element */
function hide(element) {
  element.textContent = '';
  element.hidden = true;
}

/**
 * Dieselbe zeichenbasierte Rechnung wie in src/ui/format.ts.
 *
 * Bewusst doppelt und nicht geteilt: Worker und Browser laden keinen
 * gemeinsamen Modulbaum, und ein Bundler, der das ermöglichte, wäre ein
 * Build-Schritt für zwölf Zeilen. Beide Fassungen sind einzeln getestet, und
 * ein Auseinanderlaufen fiele in tests/ui/ sofort auf — dort wird die
 * Anzeige des Clients gegen erwartete Zeichenketten geprüft.
 */
/**
 * @param {number} cents
 * @returns {string}
 */
function formatEuro(cents) {
  const safe = Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : 0;
  const euros = String(Math.floor(safe / 100));
  const rest = String(safe % 100).padStart(2, '0');

  let grouped = '';
  for (let i = 0; i < euros.length; i += 1) {
    if (i > 0 && (euros.length - i) % 3 === 0) grouped += '.';
    grouped += euros[i];
  }
  return `${grouped},${rest} €`;
}

const GERMAN_DATE = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * @param {string} day
 * @returns {string}
 */
function formatGermanDate(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? day : GERMAN_DATE.format(parsed);
}

/**
 * Die Bestätigung ist die einzige Stelle, an der der Client HTML zusammensetzt
 * — und die Werte darin kommen aus einer Antwort des eigenen Servers. Trotzdem
 * wird escaped: Ein Produktname mit spitzer Klammer ist kein Angriff, aber
 * eine kaputte Anzeige, und die Regel „hier wird nie roher Text eingesetzt"
 * hält länger als die Kenntnis darüber, woher die Daten stammen.
 */
/** @type {Record<string, string>} */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => /** @type {string} */ (HTML_ESCAPES[char]));
}

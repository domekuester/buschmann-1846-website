import { escapeHtml } from './format';

export interface CustomerAccountRequestPageView {
  readonly values: Readonly<Record<string, string>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly success: boolean;
}

export function renderCustomerAccountRequestPage(view: CustomerAccountRequestPageView): string {
  const content = view.success
    ? `<div class="kontoanfrage__erfolg" role="status">
        <p class="kontoanfrage__kicker">Anfrage eingegangen</p>
        <h1>Vielen Dank.</h1>
        <p>Ihre Kundenanfrage ist bei Buschmann eingegangen.<br>Wir prüfen Ihre Angaben und melden uns bei Ihnen.</p>
        <a class="kontoanfrage__zurueck" href="/login">Zurück zur Anmeldung</a>
      </div>`
    : form(view);

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Kundenkonto anfragen — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="anmeldeseite kontoanfrageseite">
<main id="inhalt" class="anmeldung kontoanfrage">
  <section class="anmeldung__markenfeld" aria-labelledby="markenname">
    <div class="anmeldung__marke">
      <p class="marke" id="markenname">Buschmann <span>1846</span></p>
      <span class="anmeldung__goldlinie" aria-hidden="true"></span>
      <p class="anmeldung__herkunft">Düsseldorfer Pâtisserie. Seit 1846.</p>
    </div>
  </section>
  <section class="anmeldung__zugang kontoanfrage__zugang" aria-labelledby="kontoanfrage-titel">
    <div class="anmeldung__inhalt kontoanfrage__inhalt">
      ${content}
    </div>
  </section>
</main>
</body>
</html>
`;
}

function form(view: CustomerAccountRequestPageView): string {
  const hasErrors = Object.keys(view.errors).length > 0;
  return `<p class="kontoanfrage__kicker">Kundenkonto</p>
      <h1 id="kontoanfrage-titel">Kundenkonto anfragen</h1>
      <p class="anmeldung__vorspann">Schick uns kurz deine Kontaktdaten. Buschmann prüft die Anfrage und richtet passende Konditionen persönlich ein.</p>
      ${hasErrors ? '<p class="banner anmeldung__fehler" role="alert">Die Anfrage wurde noch nicht gesendet. Bitte prüfe die Angaben.</p>' : ''}
      <form method="post" action="/konto-anfragen" class="anmeldung__formular kontoanfrage__formular">
        ${input(view, 'name', 'Name / Firma', 120, true, 'organization')}
        ${input(view, 'contact_person', 'Ansprechpartner', 120, false, 'name')}
        ${input(view, 'email', 'E-Mail', 190, true, 'email', 'email')}
        ${input(view, 'phone', 'Telefon', 40, true, 'tel', 'tel')}
        ${input(view, 'street', 'Straße / Hausnummer', 160, false, 'street-address')}
        <div class="kontoanfrage__adresszeile">
          ${input(view, 'postal_code', 'PLZ', 10, false, 'postal-code', 'text', 'numeric')}
          ${input(view, 'city', 'Ort', 100, false, 'address-level2')}
        </div>
        ${textarea(view)}
        <div class="formular-falle" aria-hidden="true">
          <label for="website">Website</label>
          <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
        </div>
        <p class="kontoanfrage__datenschutz">Mit dem Absenden werden deine Angaben zur Bearbeitung der Anfrage verwendet. Mehr dazu im <a href="/datenschutz/">Datenschutz</a>.</p>
        <button type="submit" class="senden senden--breit">Anfrage senden</button>
      </form>
      <p class="kontoanfrage__zurueck"><a href="/login">Zurück zur Anmeldung</a></p>`;
}

function input(
  view: CustomerAccountRequestPageView,
  name: string,
  label: string,
  max: number,
  required: boolean,
  autocomplete: string,
  type = 'text',
  inputmode: string | null = null,
): string {
  const error = view.errors[name] ?? null;
  const id = `anfrage-${name.replaceAll('_', '-')}`;
  return `<div class="feld${error === null ? '' : ' feld--fehler'}">
          <label for="${id}">${escapeHtml(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label>
          <input id="${id}" name="${name}" type="${type}" maxlength="${max}" autocomplete="${autocomplete}" value="${escapeHtml(view.values[name] ?? '')}"${inputmode === null ? '' : ` inputmode="${inputmode}"`}${required ? ' required' : ''}${error === null ? '' : ` aria-invalid="true" aria-describedby="${id}-fehler"`}>
          ${error === null ? '' : `<span class="feldfehler" id="${id}-fehler">${escapeHtml(error)}</span>`}
        </div>`;
}

function textarea(view: CustomerAccountRequestPageView): string {
  const error = view.errors['message'] ?? null;
  return `<div class="feld${error === null ? '' : ' feld--fehler'}">
          <label for="anfrage-message">Nachricht</label>
          <textarea id="anfrage-message" name="message" maxlength="1000" rows="4"${error === null ? '' : ' aria-invalid="true" aria-describedby="anfrage-message-fehler"'}>${escapeHtml(view.values['message'] ?? '')}</textarea>
          ${error === null ? '' : `<span class="feldfehler" id="anfrage-message-fehler">${escapeHtml(error)}</span>`}
        </div>`;
}

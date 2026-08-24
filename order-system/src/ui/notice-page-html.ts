import { escapeHtml } from './format';

/**
 * Die schlichten Hinweisseiten: „das darfst du nicht" und „diesen Link gibt
 * es nicht".
 *
 * Sie teilen sich ein Gerüst mit der Loginseite — dieselbe Marke, dieselbe
 * Zurückhaltung —, und wie dort steht die Begründung im Quelltext und nicht
 * als HTML-Kommentar in der ausgelieferten Seite.
 *
 * DER TEXT NENNT KEINE INTERNA. Er sagt nicht „diese Seite ist Admins
 * vorbehalten", weil das die Auskunft wäre, dass es Adminseiten gibt und wo
 * sie liegen. Er sagt, was zu tun ist.
 */
export function renderNoticePage(title: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="anmeldeseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
</header>
<main id="inhalt" class="anmeldung">
  <h1>${escapeHtml(heading)}</h1>
  <p class="anmeldung__vorspann">${escapeHtml(body)}</p>
</main>
</body>
</html>
`;
}

/**
 * Die Antwort auf einen Zugriff, für den die Anmeldung nicht reicht.
 *
 * Zeichen für Zeichen dieselbe Seite, egal welche Rolle fehlt und welche
 * Route gemeint war. Eine Unterscheidung wäre eine Landkarte.
 */
export function renderForbiddenPage(): string {
  return renderNoticePage(
    'Kein Zugriff',
    'Dieser Bereich ist für dich nicht freigegeben.',
    'Wenn das nicht stimmen kann, melde dich kurz bei Buschmann 1846 — dann klären wir das.',
  );
}

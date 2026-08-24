import { escapeHtml } from './format';

/**
 * Die Admin-Shell von Phase 3A.
 *
 * SIE IST ABSICHTLICH FAST LEER. Ihr einziger Zweck ist der Nachweis, dass
 * die Auth-Grenze trägt: Ein Admin kommt herein, ein Café nicht. Es gibt kein
 * Dashboard, keine Tagesansicht, keine Bestellungen, keine Produkte, keine
 * Zahlen — all das ist Phase 3B und würde hier nur eine Oberfläche erzeugen,
 * die niemand geprüft hat.
 *
 * Was hier nicht steht, kann auch nicht versehentlich falsch stehen.
 *
 * Angezeigt wird die KENNUNG des Angemeldeten. Auf einem Gerät, das sich
 * mehrere Leute teilen, ist das der Unterschied zwischen „ich arbeite als
 * ich" und „ich arbeite als irgendwer" — und es ist die einzige Information,
 * die eine leere Shell überhaupt anbieten kann.
 *
 * Das Abmeldeformular ist ein echtes `<form method="post">` mit dem
 * CSRF-Token der Sitzung. Kein Link: Ein GET-Logout wird von Link-Prefetch,
 * Bildvorschau und Virenscannern ausgelöst und meldet dann jemanden ab, der
 * nichts getan hat.
 */
export interface AdminPageView {
  /** Die Kennung des angemeldeten Admins — kein Geheimnis. */
  loginIdentifier: string;
  /** Der Synchronizer-Token dieser Sitzung, für das Abmeldeformular. */
  csrfToken: string;
}

export function renderAdminPage(view: AdminPageView): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Administration — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="anmeldeseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
</header>

<main id="inhalt" class="anmeldung">
  <h1>Administration</h1>

  <p class="anmeldung__vorspann">
    Angemeldet als <strong>${escapeHtml(view.loginIdentifier)}</strong>
  </p>

  <p>Adminbereich ist bereit.</p>

  <form method="post" action="/logout" class="anmeldung__formular">
    <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
    <button type="submit" class="senden senden--breit senden--zweit">Abmelden</button>
  </form>
</main>
</body>
</html>
`;
}

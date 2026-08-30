import { escapeHtml } from './format';

/**
 * Die Loginseite.
 *
 * Sie ist die einzige Seite, die ein Café und ein Buschmann-Mitarbeiter
 * gemeinsam sehen — und sie fragt nicht, wer von beiden gerade davorsteht.
 * Die Rolle steht am Konto; eine Auswahl im Formular wäre ein überflüssiger
 * Tap und zugleich eine Auskunft darüber, welche Rollen es gibt.
 *
 * OHNE JAVASCRIPT. Ein echtes `<form method="post">`, eine serverseitig
 * gerenderte Fehlermeldung, ein 303-Redirect. Es gibt kein Login-Skript, und
 * deshalb lädt die Seite auch keines: Ein fehlgeschlagener Skript-Download
 * würde sonst die Anmeldung verhindern — bei genau der Verbindung, bei der
 * das Café ohnehin schon Ärger hat.
 *
 * Zwei Felder, eine Schaltfläche. Kein „Angemeldet bleiben" (die Sitzung
 * läuft 30 Tage), kein Social Login, kein CAPTCHA, kein „Passwort vergessen"
 * — Letzteres, weil es dahinter noch nichts gibt und ein Link ins Leere
 * schlimmer ist als kein Link.
 *
 * KEINE HTML-KOMMENTARE IM AUSGELIEFERTEN MARKUP.
 *
 * Die Erklärungen stehen hier oben in TypeScript und nicht als `<!-- -->` in
 * der Seite, und das ist keine Formsache: Ein HTML-Kommentar geht mit an den
 * Browser. Eine Begründung, die von PIN und Admin-Passwort spricht, erzählte
 * jedem Besucher der Loginseite, dass es zwei Kontoarten gibt und welche
 * Form ihre Geheimnisse haben. Das ist wenig, aber es ist umsonst
 * hergegeben — und die Tests dieser Datei bestehen darauf.
 *
 * DIE EINZELENTSCHEIDUNGEN, die sonst als Kommentar im Markup stünden:
 *
 *   Fehlermeldung ÜBER den Feldern — nach einem Fehlversuch liegt der Blick
 *   oben, und eine Meldung unter der Schaltfläche wäre auf einem Telefon
 *   außerhalb des sichtbaren Bereichs. `role="alert"` sagt sie an, ohne den
 *   Fokus zu verschieben.
 *
 *   KEIN `inputmode="numeric"` am Geheimnisfeld — es nimmt eine 8-stellige
 *   PIN und ein 16-Zeichen-Passwort auf. Die Zifferntastatur wäre für das
 *   Café bequem und für den Admin eine Sperre; die Alternative wäre, vorher
 *   nach der Rolle zu fragen.
 *
 *   `autocomplete="current-password"` bleibt — der Passwortmanager ist für
 *   einen Admin die beste verfügbare Sicherheitsmaßnahme und erspart dem
 *   Café den Zettel neben der Kasse. Ein Abschalten täuschte Sicherheit vor,
 *   die es nicht gibt.
 *
 *   Die Felder werden nach einem Fehlversuch NICHT vorbelegt. Bequemer wäre
 *   es; die Seite steht aber auf einem geteilten Tresengerät, und der letzte
 *   fehlgeschlagene Kundencode geht den Nächsten nichts an.
 */

/**
 * Die eine Meldung für alle sechs Ablehnungsgründe: unbekannte Kennung,
 * falsches Passwort, falsche PIN, deaktiviertes Konto, deaktiviertes Café,
 * gesperrtes Konto.
 *
 * Das ist eine bewusst schlechtere Auskunft für den ehrlichen Fall. Ein Café,
 * dessen Zugang deaktiviert wurde, erfährt den Grund nicht aus der Seite —
 * deshalb nennt der Hilfetext darunter den WEG statt des Grundes.
 */
export const GENERIC_LOGIN_ERROR = 'Anmeldung nicht möglich. Bitte Zugangsdaten prüfen.';

export interface LoginPageView {
  errorMessage: string | null;
}

export function renderLoginPage(view: LoginPageView): string {
  const fehler = view.errorMessage;
  const fehlerMarkup = fehler === null
    ? ''
    : `<p class="banner anmeldung__fehler" id="login-fehler" role="alert">${escapeHtml(fehler)}</p>`;
  const fehlerVerweis = fehler === null ? '' : '\n        aria-describedby="login-fehler"';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Anmeldung — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css?v=8b2b-4">
</head>
<body class="anmeldeseite">
<main id="inhalt" class="anmeldung">
  <section class="anmeldung__markenfeld" aria-labelledby="markenname">
    <div class="anmeldung__marke">
      <p class="marke" id="markenname">Buschmann <span>1846</span></p>
      <span class="anmeldung__goldlinie" aria-hidden="true"></span>
      <p class="anmeldung__herkunft">Düsseldorfer Pâtisserie. Seit 1846.</p>
    </div>
  </section>

  <section class="anmeldung__zugang" aria-labelledby="anmeldung-titel">
    <div class="anmeldung__inhalt">
      <h1 id="anmeldung-titel">Willkommen</h1>
      <p class="anmeldung__vorspann">Mit Kundencode oder E-Mail anmelden.</p>

      ${fehlerMarkup}

      <form method="post" action="/login" class="anmeldung__formular">
        <div class="feld">
          <label for="kennung">Kundencode oder E-Mail</label>
          <input
            type="text"
            id="kennung"
            name="identifier"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            required${fehlerVerweis}
          >
        </div>

        <div class="feld">
          <label for="geheimnis">PIN oder Passwort</label>
          <input
            type="password"
            id="geheimnis"
            name="secret"
            autocomplete="current-password"
            required
          >
        </div>

        <button type="submit" class="senden senden--breit">Anmelden</button>
      </form>

      <p class="anmeldung__preishinweis">
        Nach der Anmeldung siehst du automatisch die Preise für dein Kundenkonto.
      </p>
      <div class="anmeldung__kontoanfrage">
        <p>Noch kein Kundenkonto?</p>
        <a href="/konto-anfragen">Kundenkonto anfragen</a>
      </div>
      <p class="anmeldung__hilfe">Zugang verloren? Bitte melde dich bei Buschmann 1846.</p>
    </div>
  </section>
</main>
</body>
</html>
`;
}

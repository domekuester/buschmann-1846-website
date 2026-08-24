/**
 * Die Auth-Konfiguration als Teil von Env — von Hand deklariert, nicht von
 * `wrangler types` erzeugt.
 *
 * Der Grund steht in wrangler.jsonc: Diese drei Werte stehen bewusst NICHT in
 * der eingecheckten Wrangler-Konfiguration. Lokal kommen sie aus .dev.vars
 * (nicht in Git), produktiv aus Cloudflare-Secrets. `wrangler types` kann sie
 * deshalb in einem frischen Klon nicht kennen — diese Datei schon.
 *
 * Alle drei sind OPTIONAL typisiert, und das ist keine Nachlässigkeit: Sie
 * können zur Laufzeit tatsächlich fehlen. Ein `AUTH_PEPPER: string` würde
 * behaupten, dass der Wert immer da ist, und genau die Prüfung überflüssig
 * erscheinen lassen, die readAppConfig zum Fail-Closed-Verhalten braucht.
 */
declare global {
  interface Env {
    /** Serverseitiges Geheimnis der Credential-Verifikation. Niemals in Git. */
    AUTH_PEPPER?: string | undefined;

    /** Der erwartete First-Party-Origin, z. B. 'https://buschmann1846.de'. */
    APP_ORIGIN?: string | undefined;

    /** Genau 'development' schaltet die Entwicklungspolicy frei. Sonst nichts. */
    ENVIRONMENT?: string | undefined;
  }
}

export {};

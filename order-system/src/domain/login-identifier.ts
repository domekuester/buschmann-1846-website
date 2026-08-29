/**
 * Die Normalisierung der Login-Kennung.
 *
 * Café und Admin benutzen dasselbe Feld: Ein Café tippt einen Kundencode
 * ('CAFE27'), ein Admin eine E-Mail-Adresse. Intern zählt ausschließlich das
 * Ergebnis dieser Funktion — es ist der Wert, unter dem der Account in D1
 * steht.
 *
 * Damit entscheidet diese Datei, WELCHER Account gemeint ist. Sie hat deshalb
 * genau drei Eigenschaften, und jede davon ist getestet:
 *
 *   EINDEUTIG    Zwei Eingaben führen zum selben Account, oder sie führen es
 *                nicht. Es gibt kein „ungefähr".
 *   STABIL       normalize(normalize(x)) === normalize(x). Ohne diese
 *                Eigenschaft wäre ein bei der Provisionierung geschriebener
 *                Wert nicht zwingend gleich dem beim Login berechneten, und
 *                der Account wäre unauffindbar.
 *   WORTKARG     Sie wirft nie und liefert null. Ein Formfehler ist an dieser
 *                Stelle noch keine Auskunft wert.
 *
 * KEINE FUZZY-MATCHES. Punkte in E-Mail-Adressen werden nicht entfernt,
 * '+tag'-Suffixe nicht abgeschnitten, Tippfehler nicht nachgesehen. Jede
 * dieser Bequemlichkeiten wäre eine Annahme darüber, wie ein fremder
 * Mailserver Adressen behandelt — und im Zweifel eine Anmeldung als jemand
 * anderes.
 */

/** Dieselbe Obergrenze wie bei Customer.email — die Spalte fasst nicht mehr. */
const MAX_LENGTH = 190;

/**
 * Der erlaubte Zeichenvorrat, als ALLOWLIST.
 *
 * Er deckt beide Formen ab: Kundencodes (Buchstaben, Ziffern, Bindestrich,
 * Unterstrich) und E-Mail-Adressen (zusätzlich Punkt, Klammeraffe, Plus).
 *
 * Eine Allowlist und keine Blocklist, und das ist der eigentliche Zweck
 * dieser Zeile. Ein kyrillisches 'а' (U+0430) sieht aus wie ein lateinisches
 * 'a' und wäre sonst ein zweiter Account, den niemand vom ersten
 * unterscheiden kann. Dasselbe gilt für griechische, armenische und
 * mathematische Doppelgänger — es sind zu viele, um sie aufzuzählen, und
 * genau deshalb wird stattdessen aufgezählt, was erlaubt ist.
 *
 * Die Allowlist ist zugleich der Grund, warum die Idempotenz hält: Über
 * diesem Vorrat sind NFKC und toLowerCase die Identität. Weder entsteht ein
 * kombinierendes Zeichen noch ein Großbuchstabe, wenn man die Normalisierung
 * ein zweites Mal anwendet.
 *
 * Der Preis: Eine internationalisierte E-Mail-Adresse wird abgelehnt. Das ist
 * hinnehmbar, weil Buschmann die Accounts selbst anlegt — und es ist eine
 * Ablehnung, kein stiller Fehlgriff.
 */
const ALLOWED = /^[a-z0-9._@+-]+$/;

export function normalizeLoginIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    /**
     * NFKC zuerst: Es fasst Vollbreitenzeichen ('ＣＡＦＥ'), Ligaturen und
     * Kompatibilitätsformen auf ihre gewöhnliche Schreibweise zusammen. Ohne
     * diesen Schritt wären 'CAFE27' und 'ＣＡＦＥ２７' zwei Accounts.
     */
    .normalize('NFKC')

    /**
     * Formatzeichen (Kategorie Cf) entfernen — Zero-Width Space, Zero-Width
     * Joiner, Links-Rechts-Markierungen, BOM. Sie sind unsichtbar: Eine
     * Kennung mit einem davon sähe im Formular exakt aus wie eine ohne. Wer
     * sie aus einer Chatnachricht kopiert, soll sich trotzdem anmelden können.
     */
    .replace(/\p{Cf}/gu, '')

    /**
     * Nur außen trimmen, und zwar jede Art von Whitespace — auch das
     * geschützte Leerzeichen und die schmalen Varianten, die beim Kopieren
     * aus einem Textdokument entstehen. Innen wird NICHT entfernt: 'CAFE 27'
     * ist keine Kennung mit einem Leerzeichen zu viel, sondern etwas anderes.
     */
    .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')

    /**
     * toLowerCase() und ausdrücklich NICHT toLocaleLowerCase(): In türkischem
     * Locale wird aus 'I' ein 'ı' (dotless i). Derselbe Kundencode führte dann
     * je nach Serverlocale zu einem anderen Account.
     */
    .toLowerCase();

  if (normalized.length === 0 || normalized.length > MAX_LENGTH) {
    return null;
  }

  /**
   * Die Allowlist steht am ENDE, nicht am Anfang: Sie soll das Ergebnis
   * prüfen, nicht die Eingabe. 'ＣＡＦＥ２７' besteht vor NFKC aus lauter
   * unerlaubten Zeichen und ist danach eine gültige Kennung.
   *
   * Steuerzeichen und Zeilenumbrüche fallen hier mit durch — sie stehen nicht
   * im Vorrat und brauchen keine eigene Prüfung.
   */
  return ALLOWED.test(normalized) ? normalized : null;
}

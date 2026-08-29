/**
 * Ein Vergleich, der nicht beim ersten Unterschied aufhört.
 *
 * `a === b` bricht ab, sobald sich ein Zeichen unterscheidet. Die Laufzeit
 * verriete damit, wie viele Zeichen am Anfang übereinstimmen — und wer raten
 * darf, kann sich Zeichen für Zeichen an ein Geheimnis herantasten. Hier wird
 * über ALLE Zeichen ein Oder gebildet und erst am Ende einmal verglichen.
 *
 * Der Längenvergleich vorab ist unkritisch: Bei Verifier, CSRF-Token und
 * Sitzungshash ist die Länge durch die Form festgelegt und damit keine
 * Auskunft.
 *
 * Die Funktion liegt hier und nicht in credential.ts, weil sie an zwei
 * Stellen gebraucht wird — für den Credential-Verifier und für den
 * CSRF-Token. Zwei Fassungen wären zwei Gelegenheiten, versehentlich `===` zu
 * schreiben.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let unterschied = 0;
  for (let i = 0; i < a.length; i += 1) {
    unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return unterschied === 0;
}

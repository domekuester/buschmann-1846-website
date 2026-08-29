/**
 * WAS IM TERMINAL STEHT, WENN ETWAS SCHIEFGEHT.
 *
 * Eine Vorführung wird nicht von einem Entwickler gestartet, sondern von
 * jemandem, der gleich einen Kunden begrüßt. Ein Stacktrace ist in dieser
 * Lage keine Information, sondern ein Schrecken. Deshalb bekommt jeder
 * Abbruch drei Zeilen: was nicht ging, was zu tun ist, und — ganz unten und
 * eingerückt — die technische Ursache für den Fall, dass doch jemand
 * nachsieht.
 */

/** Die Ausgabe eines fehlgeschlagenen Kindprozesses, so knapp wie möglich. */
function ursache(fehler) {
  if (fehler === null || fehler === undefined) {
    return null;
  }

  /**
   * execFileSync hängt stdout und stderr an den Fehler. Wranglers eigentliche
   * Meldung steht dort, nicht in error.message („Command failed …").
   */
  const stderr = typeof fehler.stderr === 'string' ? fehler.stderr.trim() : '';
  const stdout = typeof fehler.stdout === 'string' ? fehler.stdout.trim() : '';
  const text = stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : String(fehler.message ?? fehler);

  const zeilen = text
    .split('\n')
    .map((z) => z.trimEnd())
    .filter((z) => z.length > 0);

  // Mehr als zwölf Zeilen liest in dieser Lage niemand.
  const gekuerzt = zeilen.length > 12 ? [...zeilen.slice(0, 12), '…'] : zeilen;
  return gekuerzt.length > 0 ? gekuerzt.join('\n') : null;
}

export function meldeFehler(ueberschrift, fehler, hinweise = []) {
  const teile = ['', `❌  ${ueberschrift}`, ''];

  for (const hinweis of hinweise) {
    teile.push(`    ${hinweis}`);
  }
  if (hinweise.length > 0) {
    teile.push('');
  }

  const details = ursache(fehler);
  if (details !== null) {
    teile.push('    Technische Ursache:');
    for (const zeile of details.split('\n')) {
      teile.push(`      ${zeile}`);
    }
    teile.push('');
  }

  process.stderr.write(`${teile.join('\n')}\n`);
}

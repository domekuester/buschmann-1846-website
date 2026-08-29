import { InvalidArgumentError } from './errors';

/**
 * Zählt Zeichen, nicht UTF-16-Codeeinheiten. „Straße" hat sechs Zeichen, und
 * eine Längengrenze soll das Gleiche bedeuten wie in der Eingabemaske —
 * nicht das, was die interne Kodierung gerade daraus macht.
 */
export function charLength(value: string): number {
  return [...value].length;
}

/** Ein Pflichtfeld: getrimmt, nicht leer, nicht zu lang. */
export function requireText(value: string, maxLength: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new InvalidArgumentError(`${label} darf nicht leer sein.`);
  }
  if (charLength(trimmed) > maxLength) {
    throw new InvalidArgumentError(`${label} ist zu lang.`);
  }
  return trimmed;
}

/**
 * Ein optionales Feld: leer und fehlend sind dasselbe, nämlich null. Sonst
 * hätte ein Datensatz zwei Arten von „nichts angegeben", und jede spätere
 * Abfrage müsste beide kennen.
 */
export function optionalText(
  value: string | null | undefined,
  maxLength: number,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (charLength(trimmed) > maxLength) {
    throw new InvalidArgumentError(`${label} ist zu lang.`);
  }
  return trimmed;
}

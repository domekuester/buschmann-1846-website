/**
 * Die zwei Fehlerarten der Domäne — und der Unterschied zwischen ihnen ist
 * kein Stilfrage, sondern entscheidet, was die HTTP-Grenze später tut:
 *
 *   ValidationError      → fehlerhafte Eingabe, gehört als 422 zurück an das
 *                          Café, mit einer Meldung je Feld.
 *   InvalidArgumentError → verletzte Invariante, also ein Programmierfehler.
 *                          Gehört als 500 ins Log und nie in eine Oberfläche.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Eine Invariante wurde verletzt. Das ist ein Programmierfehler, keine
 * Nutzereingabe — die Eingabeprüfung hätte vorher greifen müssen.
 */
export class InvalidArgumentError extends DomainError {}

/**
 * Fehlerhafte Nutzereingabe. Trägt eine Zuordnung Feldname → Meldung, damit
 * eine spätere Oberfläche den Hinweis an das richtige Feld heften kann.
 * Es werden immer ALLE Fehler gesammelt, nie nur der erste.
 */
export class ValidationError extends DomainError {
  readonly errors: Readonly<Record<string, string>>;

  constructor(
    errors: Record<string, string>,
    message = 'Die Eingabe ist unvollständig oder fehlerhaft.',
  ) {
    super(message);
    this.errors = { ...errors };
  }

  static field(field: string, message: string): ValidationError {
    return new ValidationError({ [field]: message });
  }

  hasError(field: string): boolean {
    return field in this.errors;
  }

  fieldCount(): number {
    return Object.keys(this.errors).length;
  }
}

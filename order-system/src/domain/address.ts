import { requireText } from './text';

/**
 * Postanschrift. Alle drei Teile sind Pflicht, geprüft wird nur Vorhandensein
 * und Länge — nicht das Format. Adressformate sind international uneinheitlich;
 * eine Regex hier würde irgendwann eine gültige Adresse ablehnen und dafür
 * keinen Fehler verhindern.
 */
export class Address {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;

  constructor(street: string, postalCode: string, city: string) {
    this.street = requireText(street, 160, 'Die Straße');
    this.postalCode = requireText(postalCode, 10, 'Die Postleitzahl');
    this.city = requireText(city, 100, 'Der Ort');
  }

  /** Die Form, in der die Adresse als Snapshot in eine Bestellung geht. */
  toSingleLine(): string {
    return `${this.street}, ${this.postalCode} ${this.city}`;
  }
}

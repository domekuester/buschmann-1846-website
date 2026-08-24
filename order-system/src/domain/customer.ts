import type { Address } from './address';
import { InvalidArgumentError } from './errors';
import { requiresAddress, type FulfillmentType } from './fulfillment-type';
import { optionalText, requireText } from './text';

/**
 * Bewusst streng, aber ohne Anspruch auf Vollständigkeit: Verlangt wird ein
 * lokaler Teil, ein Klammeraffe, ein Punkt in der Domain und keine
 * Leerzeichen. Eine E-Mail-Regex nach RFC 5322 wäre unlesbar und würde reale
 * Adressen trotzdem falsch beurteilen. Ob die Adresse existiert, kann
 * ohnehin nur ein Versand feststellen — und der ist Phase 2.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export interface CustomerData {
  id: number;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  deliveryAddress: Address | null;
  isActive: boolean;
  defaultFulfillment: FulfillmentType;
  internalNote: string | null;
}

/**
 * Ein Geschäftskunde (Café) oder ein Privat-/Sonderkunde.
 *
 * Datenminimierung ist hier Voreinstellung, nicht Bequemlichkeit: Pflicht ist
 * ausschließlich der Kunden- oder Cafénname. Ansprechpartner, E-Mail und
 * Telefon sind optional, weil ein Café zur Bestellung keinen
 * personenbezogenen Kontakt braucht.
 *
 * internalNote ist ein Feld für BETRIEBLICHE Hinweise („Lieferung an der
 * Rückseite", „Kühlkette beachten") — niemals für Angaben über Personen und
 * niemals für besondere Datenkategorien.
 *
 * Kunden werden deaktiviert, nicht gelöscht, solange Bestellungen bestehen.
 */
export class Customer {
  readonly id: number;
  readonly name: string;
  readonly contactPerson: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly deliveryAddress: Address | null;
  readonly isActive: boolean;
  readonly defaultFulfillment: FulfillmentType;
  readonly internalNote: string | null;

  constructor(data: CustomerData) {
    if (!Number.isInteger(data.id) || data.id <= 0) {
      throw new InvalidArgumentError('Die Kunden-ID ist ungültig.');
    }

    this.id = data.id;
    this.name = requireText(data.name, 120, 'Der Kundenname');
    this.contactPerson = optionalText(data.contactPerson, 120, 'Der Ansprechpartner');
    this.phone = optionalText(data.phone, 40, 'Die Telefonnummer');
    this.internalNote = optionalText(data.internalNote, 1000, 'Die interne Notiz');

    const email = optionalText(data.email, 190, 'Die E-Mail-Adresse');
    if (email !== null && !EMAIL.test(email)) {
      throw new InvalidArgumentError('Die E-Mail-Adresse ist ungültig.');
    }
    this.email = email;

    if (requiresAddress(data.defaultFulfillment) && data.deliveryAddress === null) {
      throw new InvalidArgumentError('Ein Kunde mit Standardlieferung braucht eine Lieferadresse.');
    }

    this.deliveryAddress = data.deliveryAddress;
    this.isActive = data.isActive;
    this.defaultFulfillment = data.defaultFulfillment;
  }

  /** Eine Lieferung ist möglich, sobald eine Adresse hinterlegt ist. */
  canBeDeliveredTo(): boolean {
    return this.deliveryAddress !== null;
  }
}

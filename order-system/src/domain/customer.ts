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
  /**
   * Die zugeordnete Preisgruppe — oder nichts.
   *
   * OPTIONAL IM TYP UND NULL ALS VOREINSTELLUNG, und das ist beides
   * Absicht. Optional, weil jede bestehende Stelle, die einen Kunden baut,
   * das ohne Änderung weiter tun können soll — ein Pflichtfeld hätte hier
   * bedeutet, dass Aufrufer, die von Preisgruppen nichts wissen, sich
   * trotzdem für eine entscheiden müssen. Und NULL, weil „noch nicht
   * zugeordnet" der wahrheitsgemäße Zustand jedes Kunden ist, den niemand
   * bewusst zugeordnet hat.
   */
  priceListId?: number | null;
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
  /**
   * Die Preisgruppe dieses Kunden — die einzige Neuerung aus Phase 5B.
   *
   * SIE WIRD NIEMALS GERATEN. Nicht aus dem Namen („Café" ⇒ Gastronomie),
   * nicht aus der E-Mail-Domain, nicht aus dem bisherigen Bestellumfang. Eine
   * Preisgruppe ist eine kaufmännische Entscheidung, die ein Mensch trifft;
   * in dieser Klasse gibt es dafür keine Ableitung und keinen Standardwert
   * außer „nicht zugeordnet".
   *
   * SIE BERECHNET AUCH NICHTS. Der Kunde weiß, WELCHER Preiswelt er
   * angehört, und nicht, was ein Produkt darin kostet.
   */
  readonly priceListId: number | null;

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

    /**
     * Eine Preislisten-ID ist entweder eine echte Zeilenkennung oder gar
     * nichts. `undefined` und `null` bedeuten dasselbe — „nicht zugeordnet" —,
     * und alles andere muss eine positive ganze Zahl sein. Dass die Zeile
     * auch EXISTIERT, kann diese Klasse nicht wissen; das prüft der
     * Anwendungsfall gegen die Datenbank, und der Fremdschlüssel hält es
     * darunter noch einmal fest.
     */
    const priceListId = data.priceListId ?? null;
    if (priceListId !== null && (!Number.isInteger(priceListId) || priceListId <= 0)) {
      throw new InvalidArgumentError('Die Preislisten-ID des Kunden ist ungültig.');
    }
    this.priceListId = priceListId;
  }

  /** Eine Lieferung ist möglich, sobald eine Adresse hinterlegt ist. */
  canBeDeliveredTo(): boolean {
    return this.deliveryAddress !== null;
  }
}

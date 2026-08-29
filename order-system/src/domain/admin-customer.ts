import { Address } from './address';
import { Customer } from './customer';
import { InvalidArgumentError, ValidationError } from './errors';
import { isFulfillmentType, type FulfillmentType } from './fulfillment-type';
import { normalizeLoginIdentifier } from './login-identifier';
import { charLength } from './text';

export const ADMIN_PRICE_GROUPS = ['gastro', 'private'] as const;
export type AdminPriceGroupCode = (typeof ADMIN_PRICE_GROUPS)[number];

export interface AdminCustomerRawInput {
  readonly name: unknown;
  readonly customerCode: unknown;
  readonly contactPerson: unknown;
  readonly email: unknown;
  readonly phone: unknown;
  readonly deliveryStreet: unknown;
  readonly deliveryPostalCode: unknown;
  readonly deliveryCity: unknown;
  readonly priceGroup: unknown;
  readonly fulfillment: unknown;
  readonly isActive: unknown;
  readonly internalNote: unknown;
}

export interface AdminCustomerInput {
  readonly name: string;
  readonly customerCode: string;
  readonly contactPerson: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly deliveryAddress: Address | null;
  readonly priceGroupCode: AdminPriceGroupCode;
  readonly defaultFulfillment: FulfillmentType;
  readonly isActive: boolean;
  readonly internalNote: string | null;
}

export interface AdminCustomerView extends Omit<AdminCustomerInput, 'priceGroupCode'> {
  readonly id: number;
  readonly priceGroupCode: AdminPriceGroupCode | null;
  readonly updatedAt: string;
}

export function parseAdminCustomerInput(raw: AdminCustomerRawInput): AdminCustomerInput {
  const errors: Record<string, string> = {};
  const name = required(raw.name, 120, 'name', 'Bitte gib einen Kundennamen ein.', errors);
  const customerCodeRaw = required(
    raw.customerCode,
    190,
    'customer_code',
    'Bitte gib einen Kundencode ein.',
    errors,
  );
  const customerCode = normalizeLoginIdentifier(customerCodeRaw);
  if (customerCode === null) {
    errors['customer_code'] = 'Der Kundencode darf nur Buchstaben, Ziffern sowie . _ @ + - enthalten.';
  }

  const contactPerson = optional(raw.contactPerson, 120, 'contact_person', errors);
  const email = optional(raw.email, 190, 'email', errors);
  const phone = optional(raw.phone, 40, 'phone', errors);
  const internalNote = optional(raw.internalNote, 1000, 'internal_note', errors);

  const fulfillmentRaw = text(raw.fulfillment);
  const fulfillment = isFulfillmentType(fulfillmentRaw) ? fulfillmentRaw : null;
  if (fulfillment === null) errors['fulfillment'] = 'Bitte wähle Lieferung oder Abholung.';

  const priceGroupRaw = text(raw.priceGroup);
  const priceGroupCode = (ADMIN_PRICE_GROUPS as readonly string[]).includes(priceGroupRaw ?? '')
    ? priceGroupRaw as AdminPriceGroupCode
    : null;
  if (priceGroupCode === null) errors['price_group'] = 'Bitte wähle eine gültige Preisgruppe.';

  const isActive = checkbox(raw.isActive, errors);
  const deliveryAddress = address(raw, errors);
  if (fulfillment === 'delivery' && deliveryAddress === null) {
    errors['delivery_address'] = 'Für eine Lieferung wird eine vollständige Lieferadresse benötigt.';
  }

  if (Object.keys(errors).length === 0) {
    try {
      new Customer({
        id: 1,
        name,
        contactPerson,
        email,
        phone,
        deliveryAddress,
        isActive,
        defaultFulfillment: fulfillment as FulfillmentType,
        internalNote,
      });
    } catch (error) {
      if (error instanceof InvalidArgumentError && error.message.includes('E-Mail')) {
        errors['email'] = 'Bitte gib eine gültige E-Mail-Adresse ein.';
      } else {
        errors['customer'] = 'Die Kundenangaben passen nicht zusammen.';
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors, 'Der Kunde wurde nicht gespeichert. Bitte prüfe die Angaben.');
  }

  return {
    name,
    customerCode: customerCode as string,
    contactPerson,
    email,
    phone,
    deliveryAddress,
    priceGroupCode: priceGroupCode as AdminPriceGroupCode,
    defaultFulfillment: fulfillment as FulfillmentType,
    isActive,
    internalNote,
  };
}

export function parseCustomerPin(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{8}$/.test(value)) {
    throw ValidationError.field('pin', 'Die neue PIN muss genau acht Ziffern haben.');
  }
  return value;
}

function address(
  raw: Pick<AdminCustomerRawInput, 'deliveryStreet' | 'deliveryPostalCode' | 'deliveryCity'>,
  errors: Record<string, string>,
): Address | null {
  const parts = [text(raw.deliveryStreet), text(raw.deliveryPostalCode), text(raw.deliveryCity)] as const;
  if (parts.some((part) => part === null)) {
    errors['delivery_address'] = 'Die Lieferadresse ist nicht lesbar.';
    return null;
  }
  const street = (parts[0] ?? '').trim();
  const postalCode = (parts[1] ?? '').trim();
  const city = (parts[2] ?? '').trim();
  if (street === '' && postalCode === '' && city === '') return null;
  if (street === '' || postalCode === '' || city === '') {
    errors['delivery_address'] = 'Bitte fülle Straße, Postleitzahl und Ort vollständig aus.';
    return null;
  }
  try {
    return new Address(street, postalCode, city);
  } catch {
    errors['delivery_address'] = 'Bitte prüfe die Lieferadresse.';
    return null;
  }
}

function required(
  value: unknown,
  max: number,
  field: string,
  message: string,
  errors: Record<string, string>,
): string {
  const parsed = text(value);
  const trimmed = parsed?.trim() ?? '';
  if (trimmed === '' || charLength(trimmed) > max) {
    errors[field] = trimmed === '' ? message : `Die Angabe darf höchstens ${max} Zeichen lang sein.`;
  }
  return trimmed;
}

function optional(
  value: unknown,
  max: number,
  field: string,
  errors: Record<string, string>,
): string | null {
  const parsed = text(value);
  if (parsed === null) {
    errors[field] = 'Die Angabe ist nicht lesbar.';
    return null;
  }
  const trimmed = parsed.trim();
  if (charLength(trimmed) > max) errors[field] = `Die Angabe darf höchstens ${max} Zeichen lang sein.`;
  return trimmed === '' ? null : trimmed;
}

function checkbox(value: unknown, errors: Record<string, string>): boolean {
  if (value === '' || value === null || value === undefined) return false;
  if (value === '1') return true;
  errors['is_active'] = 'Der Kundenstatus ist nicht lesbar.';
  return false;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

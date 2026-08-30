import { ValidationError } from './errors';
import { normalizeLoginIdentifier } from './login-identifier';
import { charLength } from './text';

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const LIMITS = {
  name: 120,
  contactPerson: 120,
  email: 190,
  phone: 40,
  street: 160,
  postalCode: 10,
  city: 100,
  message: 1000,
} as const;

export interface CustomerAccountRequestRawInput {
  readonly name: unknown;
  readonly contactPerson: unknown;
  readonly email: unknown;
  readonly phone: unknown;
  readonly street: unknown;
  readonly postalCode: unknown;
  readonly city: unknown;
  readonly message: unknown;
}

export interface CustomerAccountRequestInput {
  readonly name: string;
  readonly contactPerson: string | null;
  readonly email: string;
  readonly phone: string;
  readonly street: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  readonly message: string | null;
}

export type CustomerAccountRequestStatus = 'pending' | 'converted' | 'rejected';

export interface CustomerAccountRequestView extends CustomerAccountRequestInput {
  readonly id: number;
  readonly status: CustomerAccountRequestStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly processedAt: string | null;
  readonly linkedCustomerName: string | null;
  readonly rejectionNote: string | null;
}

export function parseCustomerAccountRequest(
  raw: CustomerAccountRequestRawInput,
): CustomerAccountRequestInput {
  const errors: Record<string, string> = {};
  const name = required(raw.name, LIMITS.name, 'name', 'Bitte gib deinen Namen oder deine Firma ein.', errors);
  const phone = required(raw.phone, LIMITS.phone, 'phone', 'Bitte gib eine Telefonnummer ein.', errors);
  const emailRaw = required(raw.email, LIMITS.email, 'email', 'Bitte gib eine E-Mail-Adresse ein.', errors);
  const email = normalizeLoginIdentifier(emailRaw);
  if (email === null || !EMAIL.test(email)) {
    errors['email'] = 'Bitte gib eine gültige E-Mail-Adresse ein.';
  }

  const contactPerson = optional(raw.contactPerson, LIMITS.contactPerson, 'contact_person', errors);
  const street = optional(raw.street, LIMITS.street, 'street', errors);
  const postalCode = optional(raw.postalCode, LIMITS.postalCode, 'postal_code', errors);
  const city = optional(raw.city, LIMITS.city, 'city', errors);
  const message = optional(raw.message, LIMITS.message, 'message', errors);

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors, 'Die Anfrage wurde noch nicht gesendet. Bitte prüfe die Angaben.');
  }

  return {
    name,
    contactPerson,
    email: email as string,
    phone,
    street,
    postalCode,
    city,
    message,
  };
}

export function hasFilledAccountRequestHoneypot(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() !== '';
}

function required(
  value: unknown,
  max: number,
  field: string,
  missingMessage: string,
  errors: Record<string, string>,
): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (parsed === '') errors[field] = missingMessage;
  else if (charLength(parsed) > max) errors[field] = `Die Angabe darf höchstens ${max} Zeichen lang sein.`;
  return parsed;
}

function optional(
  value: unknown,
  max: number,
  field: string,
  errors: Record<string, string>,
): string | null {
  if (typeof value !== 'string') {
    errors[field] = 'Die Angabe ist nicht lesbar.';
    return null;
  }
  const parsed = value.trim();
  if (charLength(parsed) > max) errors[field] = `Die Angabe darf höchstens ${max} Zeichen lang sein.`;
  return parsed === '' ? null : parsed;
}

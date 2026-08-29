import type { CatalogPrice } from './catalog-pricing';
import { ValidationError } from './errors';
import { parseUnitCost } from './product-cost';
import { charLength } from './text';

export const ADMIN_PRICE_TYPES = ['none', 'fixed', 'from', 'range', 'on_request'] as const;
export type AdminPriceType = (typeof ADMIN_PRICE_TYPES)[number];

export const ADMIN_PRICE_TYPE_LABELS: Readonly<Record<AdminPriceType, string>> = {
  none: 'Nicht hinterlegt',
  fixed: 'Festpreis',
  from: 'Ab-Preis',
  range: 'Preisspanne',
  on_request: 'Preis auf Anfrage',
};

export interface AdminProductRawInput {
  readonly name: unknown;
  readonly unit: unknown;
  readonly isActive: unknown;
  readonly gastroPriceType: unknown;
  readonly gastroPrice: unknown;
  readonly gastroMaxPrice: unknown;
  readonly privatePriceType: unknown;
  readonly privatePrice: unknown;
  readonly privateMaxPrice: unknown;
  readonly unitCost: unknown;
}

export interface AdminProductInput {
  readonly name: string;
  readonly unit: string;
  /** May be forced false when neither price list contains an exact price. */
  readonly isActive: boolean;
  readonly gastroPrice: CatalogPrice | null;
  readonly privatePrice: CatalogPrice | null;
  readonly unitCostCents: number | null;
}

export interface AdminProductView extends AdminProductInput {
  readonly id: number;
  readonly orderableProductId: number | null;
  readonly updatedAt: string;
}

export function parseAdminProductInput(raw: AdminProductRawInput): AdminProductInput {
  const errors: Record<string, string> = {};
  const name = required(raw.name, 120, 'name', 'Bitte gib einen Produktnamen ein.', errors);
  const unit = required(raw.unit, 120, 'unit', 'Bitte gib eine Einheit oder ein Format ein.', errors);
  const requestedActive = checkbox(raw.isActive, errors);

  const gastroPrice = price(
    raw.gastroPriceType,
    raw.gastroPrice,
    raw.gastroMaxPrice,
    'gastro',
    errors,
  );
  const privatePrice = price(
    raw.privatePriceType,
    raw.privatePrice,
    raw.privateMaxPrice,
    'private',
    errors,
  );

  let unitCostCents: number | null = null;
  const rawCost = text(raw.unitCost);
  if (rawCost === null) {
    errors['unit_cost'] = 'Die Herstellkosten sind nicht lesbar.';
  } else {
    const parsed = parseUnitCost(rawCost);
    if (parsed.kind === 'invalid') {
      errors['unit_cost'] = 'Bitte gib die Herstellkosten als Euro-Betrag ein, zum Beispiel 8,50.';
    } else {
      unitCostCents = parsed.kind === 'cleared' ? null : parsed.cents;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors, 'Das Produkt wurde nicht gespeichert. Bitte prüfe die Angaben.');
  }

  const hasFixedPrice = gastroPrice?.type === 'fixed' || privatePrice?.type === 'fixed';
  return {
    name,
    unit,
    isActive: requestedActive && hasFixedPrice,
    gastroPrice,
    privatePrice,
    unitCostCents,
  };
}

function price(
  rawType: unknown,
  rawAmount: unknown,
  rawMaximum: unknown,
  prefix: 'gastro' | 'private',
  errors: Record<string, string>,
): CatalogPrice | null {
  const type = text(rawType);
  const amount = text(rawAmount);
  const maximum = text(rawMaximum);
  const typeField = `${prefix}_price_type`;
  const amountField = `${prefix}_price`;

  if (type === null || !(ADMIN_PRICE_TYPES as readonly string[]).includes(type)) {
    errors[typeField] = 'Bitte wähle eine gültige Preisform.';
    return null;
  }
  if (amount === null || maximum === null) {
    errors[amountField] = 'Der Preis ist nicht lesbar.';
    return null;
  }

  if (type === 'none' || type === 'on_request') {
    if (amount.trim() !== '' || maximum.trim() !== '') {
      errors[amountField] = type === 'on_request'
        ? 'Bei „Preis auf Anfrage“ darf kein fester Betrag stehen.'
        : 'Ohne Preisform darf kein Betrag stehen.';
    }
    return type === 'none' ? null : { type: 'on_request' };
  }

  const lower = requiredCents(amount, amountField, errors);
  if (type === 'fixed') {
    if (maximum.trim() !== '') {
      errors[amountField] = 'Ein Festpreis braucht keinen zweiten Betrag.';
    }
    return lower === null ? null : { type: 'fixed', priceCents: lower };
  }
  if (type === 'from') {
    if (maximum.trim() !== '') {
      errors[amountField] = 'Ein Ab-Preis braucht nur den unteren Betrag.';
    }
    return lower === null ? null : { type: 'from', minPriceCents: lower };
  }

  const upper = requiredCents(maximum, amountField, errors);
  if (lower !== null && upper !== null && lower > upper) {
    errors[amountField] = 'Bei einer Preisspanne muss der obere Betrag mindestens so hoch sein wie der untere.';
  }
  return lower === null || upper === null
    ? null
    : { type: 'range', minPriceCents: lower, maxPriceCents: upper };
}

function requiredCents(
  value: string,
  field: string,
  errors: Record<string, string>,
): number | null {
  const parsed = parseUnitCost(value);
  if (parsed.kind !== 'amount') {
    errors[field] = 'Bitte gib den Preis als Euro-Betrag ein, zum Beispiel 24,00.';
    return null;
  }
  return parsed.cents;
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

function checkbox(value: unknown, errors: Record<string, string>): boolean {
  if (value === '' || value === undefined || value === null) return false;
  if (value === '1') return true;
  errors['is_active'] = 'Der Produktstatus ist nicht lesbar.';
  return false;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

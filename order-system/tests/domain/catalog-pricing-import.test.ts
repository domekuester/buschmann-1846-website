import { describe, expect, it } from 'vitest';
import {
  buildCatalogImportSql,
  buildCatalogImportStatements,
  validateCatalogPricing,
} from '../../scripts/catalog-pricing.mjs';
import { importValidatedCatalog } from '../../scripts/import-local-catalog-pricing.mjs';

const LISTS = [
  { code: 'gastro', label: 'Gastronomie' },
  { code: 'private', label: 'Privatkunden' },
];

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1,
    price_lists: LISTS,
    products: [
      {
        source_key: 'fixture:kuchen:ring',
        name: 'Fiktiver Kuchen',
        variant: 'Ring',
        unit: '26 cm Ring',
        category: 'Kuchen',
        sort_order: 10,
        prices: {
          gastro: { type: 'fixed', price_cents: 2100 },
          private: { type: 'fixed', price_cents: 3900 },
        },
        ...overrides,
      },
    ],
  };
}

describe('validateCatalogPricing', () => {
  it('behält Einheit und Variante und führt zwei Preislisten an einem Produkt', () => {
    const catalog = validateCatalogPricing(fixture());
    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0]).toMatchObject({
      source_key: 'fixture:kuchen:ring',
      variant: 'Ring',
      unit: '26 cm Ring',
      prices: {
        gastro: { type: 'fixed', price_cents: 2100 },
        private: { type: 'fixed', price_cents: 3900 },
      },
    });
  });

  it.each([
    [{ type: 'fixed', price_cents: 2100 }, { type: 'fixed', price_cents: 2100 }],
    [{ type: 'from', min_price_cents: 5500 }, { type: 'from', min_price_cents: 5500 }],
    [{ type: 'range', min_price_cents: 300, max_price_cents: 450 }, { type: 'range', min_price_cents: 300, max_price_cents: 450 }],
    [{ type: 'on_request' }, { type: 'on_request' }],
  ])('bewahrt die Preisart %j unverändert', (input, expected) => {
    const catalog = validateCatalogPricing(fixture({ prices: { private: input } }));
    expect(catalog.products[0]?.prices.private).toEqual(expected);
  });

  it.each([
    { type: 'fixed', price_cents: 4.35 },
    { type: 'fixed', price_cents: -1 },
    { type: 'from', min_price_cents: 4.35 },
    { type: 'range', min_price_cents: 450, max_price_cents: 300 },
    { type: 'on_request', price_cents: 0 },
    { type: 'fixed', min_price_cents: 2100 },
  ])('lehnt verfälschte oder ungültige Preisangaben ab: %j', (price) => {
    expect(() => validateCatalogPricing(fixture({ prices: { private: price } }))).toThrow();
  });

  it('lässt einen fehlenden Gastro- oder Privatpreis wirklich absent', () => {
    const withoutGastro = validateCatalogPricing(fixture({ prices: { private: { type: 'fixed', price_cents: 3900 } } }));
    const withoutPrivate = validateCatalogPricing(fixture({ prices: { gastro: { type: 'fixed', price_cents: 2100 } } }));
    expect(withoutGastro.products[0]?.prices).not.toHaveProperty('gastro');
    expect(withoutPrivate.products[0]?.prices).not.toHaveProperty('private');
  });

  it('bewahrt eine in der Quelle fehlende Einheit als null', () => {
    const catalog = validateCatalogPricing(fixture({ unit: null }));
    expect(catalog.products[0]?.unit).toBeNull();
  });

  it('lehnt unbekannte Preislisten ab', () => {
    expect(() => validateCatalogPricing(fixture({ prices: { wholesale: { type: 'fixed', price_cents: 2100 } } }))).toThrow(/wholesale/);
  });

  it.each([
    { source_key: '' },
    { name: '   ' },
    { unit: '' },
    { variant: '' },
    { sort_order: 1.5 },
  ])('lehnt ein leeres oder strukturell ungültiges Produkt ab: %j', (bad) => {
    expect(() => validateCatalogPricing(fixture(bad))).toThrow();
  });

  it('lehnt doppelte source_keys ab, statt Varianten zusammenzuführen', () => {
    const input = fixture() as { products: unknown[] };
    input.products.push({
      ...(input.products[0] as object),
      name: 'Fiktiver Kuchen — andere Variante',
    });
    expect(() => validateCatalogPricing(input)).toThrow(/source_key/);
  });

  it('erzeugt einen vollständigen D1-Batch und dieselbe lokale SQL-Datei', () => {
    const catalog = validateCatalogPricing(fixture());
    const statements = buildCatalogImportStatements(catalog, '2026-08-25T12:00:00.000Z');
    const sql = buildCatalogImportSql(catalog, '2026-08-25T12:00:00.000Z');
    expect(statements).toHaveLength(4);
    expect(sql).toBe(`${statements.join('\n')}\n`);
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });

  it('schreibt im Dry Run nichts', async () => {
    let executions = 0;
    const result = await importValidatedCatalog(
      validateCatalogPricing(fixture()),
      'dry-run',
      async () => { executions += 1; },
    );
    expect(executions).toBe(0);
    expect(result).toEqual({ products: 1, prices: 2, written: false });
  });
});

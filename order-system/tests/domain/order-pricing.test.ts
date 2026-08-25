import { describe, expect, it } from 'vitest';
import type { CatalogPrice } from '../../src/domain/catalog-pricing';
import { InvalidArgumentError } from '../../src/domain/errors';
import { CustomerPriceBook } from '../../src/domain/order-pricing';

/**
 * Der Preisauflöser — die EINZIGE Stelle im System, die entscheidet, welchen
 * Preis ein Kunde für ein Produkt bekommt.
 *
 * Diese Datei ist die Prüfung von §6 des Auftrags: fixed wird bestellt, from
 * und range und on_request NICHT — und zwar nicht „vorerst nicht", sondern
 * ohne dass es im Typ einen Weg gäbe, daraus einen Betrag zu machen.
 */

const GASTRO = 1;
const PRIVAT = 2;

function buch(prices: Record<number, CatalogPrice>, priceListId = GASTRO): CustomerPriceBook {
  return CustomerPriceBook.forPriceList(priceListId, new Map(Object.entries(prices).map(([id, p]) => [Number(id), p])));
}

describe('CustomerPriceBook — fixed', () => {
  it('gibt den exakten Preis der zugewiesenen Preisliste', () => {
    const preis = buch({ 1: { type: 'fixed', priceCents: 3250 } }).priceFor(1);

    expect(preis.kind).toBe('fixed');
    if (preis.kind !== 'fixed') throw new Error('unerreichbar');
    expect(preis.unitPrice.cents).toBe(3250);
    expect(preis.priceListId).toBe(GASTRO);
  });

  it('liefert für dasselbe Produkt je Preisliste einen anderen Preis', () => {
    const gastro = buch({ 1: { type: 'fixed', priceCents: 1000 } }, GASTRO).priceFor(1);
    const privat = buch({ 1: { type: 'fixed', priceCents: 1500 } }, PRIVAT).priceFor(1);

    expect(gastro.kind === 'fixed' && gastro.unitPrice.cents).toBe(1000);
    expect(privat.kind === 'fixed' && privat.unitPrice.cents).toBe(1500);
  });

  it('nimmt einen Preis von 0 Cent an — geschenkt ist ein Preis, fehlend ist keiner', () => {
    const preis = buch({ 1: { type: 'fixed', priceCents: 0 } }).priceFor(1);
    expect(preis.kind === 'fixed' && preis.unitPrice.cents).toBe(0);
  });
});

describe('CustomerPriceBook — nicht direkt bestellbar', () => {
  it('macht aus „from" keinen Preis — der Mindestpreis ist NICHT der Endpreis', () => {
    const preis = buch({ 1: { type: 'from', minPriceCents: 5500 } }).priceFor(1);

    expect(preis.kind).toBe('price_not_fixed');
    if (preis.kind !== 'price_not_fixed') throw new Error('unerreichbar');
    expect(preis.catalogPrice).toEqual({ type: 'from', minPriceCents: 5500 });
    // Der entscheidende Nachweis: An diesem Ergebnis hängt KEIN Geldbetrag.
    expect(preis).not.toHaveProperty('unitPrice');
  });

  it('macht aus „range" keinen Preis — weder min noch max', () => {
    const preis = buch({ 1: { type: 'range', minPriceCents: 5500, maxPriceCents: 7500 } }).priceFor(1);

    expect(preis.kind).toBe('price_not_fixed');
    expect(preis).not.toHaveProperty('unitPrice');
  });

  it('macht aus „on_request" keinen Preis', () => {
    const preis = buch({ 1: { type: 'on_request' } }).priceFor(1);

    expect(preis.kind).toBe('price_not_fixed');
    expect(preis).not.toHaveProperty('unitPrice');
  });

  it('meldet ein Produkt ohne Preis in dieser Liste als nicht bepreist — nicht als 0 €', () => {
    const preis = buch({ 1: { type: 'fixed', priceCents: 1000 } }).priceFor(2);

    expect(preis.kind).toBe('product_not_priced');
    expect(preis).not.toHaveProperty('unitPrice');
  });
});

describe('CustomerPriceBook — Kunde ohne gültige Preiswelt', () => {
  it('löst für einen Kunden ohne Preisgruppe NICHTS auf', () => {
    expect(CustomerPriceBook.unassigned().priceFor(1)).toEqual({ kind: 'price_list_unassigned' });
  });

  it('löst für eine inaktive Preisliste NICHTS auf — kein Rückfall auf eine andere', () => {
    expect(CustomerPriceBook.inactive(GASTRO).priceFor(1)).toEqual({ kind: 'price_list_inactive' });
  });

  it('kennt für einen nicht zugeordneten Kunden keinen einzigen Preis', () => {
    expect(CustomerPriceBook.unassigned().hasAnyPrice()).toBe(false);
    expect(CustomerPriceBook.inactive(GASTRO).hasAnyPrice()).toBe(false);
  });

  it('sagt, dass eine Preiswelt überhaupt auflösbar ist', () => {
    expect(buch({ 1: { type: 'fixed', priceCents: 100 } }).isResolvable()).toBe(true);
    expect(CustomerPriceBook.unassigned().isResolvable()).toBe(false);
    expect(CustomerPriceBook.inactive(GASTRO).isResolvable()).toBe(false);
  });
});

describe('CustomerPriceBook — Datenintegrität', () => {
  it('lehnt eine unplausible Preislisten-ID ab', () => {
    expect(() => CustomerPriceBook.forPriceList(0, new Map())).toThrow(InvalidArgumentError);
    expect(() => CustomerPriceBook.forPriceList(1.5, new Map())).toThrow(InvalidArgumentError);
    expect(() => CustomerPriceBook.inactive(-1)).toThrow(InvalidArgumentError);
  });

  it('lehnt einen negativen Katalogpreis ab, statt ihn zu verrechnen', () => {
    expect(() => buch({ 1: { type: 'fixed', priceCents: -1 } }).priceFor(1)).toThrow(InvalidArgumentError);
  });

  it('lehnt einen Katalogpreis mit Nachkommastellen ab', () => {
    expect(() => buch({ 1: { type: 'fixed', priceCents: 4.35 } }).priceFor(1)).toThrow(InvalidArgumentError);
  });

  it('lehnt einen unplausibel großen Katalogpreis ab', () => {
    expect(() => buch({ 1: { type: 'fixed', priceCents: 10_000_000_000 } }).priceFor(1)).toThrow(
      InvalidArgumentError,
    );
  });

  it('ist gegen eine nachträglich veränderte Preisliste unempfindlich', () => {
    const preise = new Map<number, CatalogPrice>([[1, { type: 'fixed', priceCents: 1000 }]]);
    const buchung = CustomerPriceBook.forPriceList(GASTRO, preise);

    preise.set(1, { type: 'fixed', priceCents: 9999 });

    const preis = buchung.priceFor(1);
    expect(preis.kind === 'fixed' && preis.unitPrice.cents).toBe(1000);
  });
});

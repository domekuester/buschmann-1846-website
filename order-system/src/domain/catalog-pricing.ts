export type CatalogPrice =
  | { readonly type: 'fixed'; readonly priceCents: number }
  | { readonly type: 'from'; readonly minPriceCents: number }
  | { readonly type: 'range'; readonly minPriceCents: number; readonly maxPriceCents: number }
  | { readonly type: 'on_request' };

export interface AdminCatalogProduct {
  readonly name: string;
  readonly variant: string | null;
  readonly unit: string;
  readonly gastroPrice: CatalogPrice | null;
  readonly privatePrice: CatalogPrice | null;
}

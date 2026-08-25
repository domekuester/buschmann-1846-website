const PRICE_LISTS = new Map([
  ['gastro', 'Gastronomie'],
  ['private', 'Privatkunden'],
]);

const PRICE_TYPES = new Set(['fixed', 'from', 'range', 'on_request']);

export function validateCatalogPricing(input) {
  const root = record(input, 'Die Katalogdatei');
  if (root.schema_version !== 1) fail('schema_version muss 1 sein.');

  const lists = array(root.price_lists, 'price_lists');
  if (lists.length !== PRICE_LISTS.size) fail('price_lists muss genau gastro und private enthalten.');
  const seenLists = new Set();
  const normalizedLists = lists.map((value, index) => {
    const list = record(value, `price_lists[${index}]`);
    const code = text(list.code, 30, `price_lists[${index}].code`);
    const label = text(list.label, 80, `price_lists[${index}].label`);
    if (!PRICE_LISTS.has(code)) fail(`Unbekannte Price List: ${code}`);
    if (seenLists.has(code)) fail(`Doppelte Price List: ${code}`);
    if (PRICE_LISTS.get(code) !== label) fail(`Falsches Label für Price List ${code}.`);
    seenLists.add(code);
    return { code, label };
  });
  for (const code of PRICE_LISTS.keys()) {
    if (!seenLists.has(code)) fail(`Price List fehlt: ${code}`);
  }

  const products = array(root.products, 'products');
  const seenKeys = new Set();
  const normalizedProducts = products.map((value, index) => {
    const product = record(value, `products[${index}]`);
    const sourceKey = text(product.source_key, 160, `products[${index}].source_key`);
    if (seenKeys.has(sourceKey)) fail(`Doppelter source_key: ${sourceKey}`);
    seenKeys.add(sourceKey);

    const pricesInput = record(product.prices, `products[${index}].prices`);
    const prices = {};
    for (const [code, value] of Object.entries(pricesInput)) {
      if (!PRICE_LISTS.has(code)) fail(`Unbekannte Price List: ${code}`);
      prices[code] = price(value, `products[${index}].prices.${code}`);
    }
    if (Object.keys(prices).length === 0) fail(`products[${index}] braucht mindestens einen Preis.`);

    return {
      source_key: sourceKey,
      name: text(product.name, 160, `products[${index}].name`),
      variant: nullableText(product.variant, 240, `products[${index}].variant`),
      unit: text(product.unit, 120, `products[${index}].unit`),
      category: nullableText(product.category, 120, `products[${index}].category`),
      sort_order: integer(product.sort_order, `products[${index}].sort_order`),
      prices,
    };
  });

  return { schema_version: 1, price_lists: normalizedLists, products: normalizedProducts };
}

export function buildCatalogImportSql(catalog, timestamp) {
  return `${buildCatalogImportStatements(catalog, timestamp).join('\n')}\n`;
}

export function buildCatalogImportStatements(catalog, timestamp) {
  const now = text(timestamp, 40, 'timestamp');
  const statements = [];

  for (const product of catalog.products) {
    statements.push(
      `INSERT INTO catalog_products
         (source_key, name, variant, unit, category, is_active, sort_order, created_at, updated_at)
       VALUES (${sql(product.source_key)}, ${sql(product.name)}, ${sql(product.variant)}, ${sql(product.unit)},
               ${sql(product.category)}, 1, ${product.sort_order}, ${sql(now)}, ${sql(now)})
       ON CONFLICT(source_key) DO UPDATE SET
         name = excluded.name,
         variant = excluded.variant,
         unit = excluded.unit,
         category = excluded.category,
         is_active = 1,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at;`,
      `DELETE FROM catalog_product_prices
        WHERE product_id = (SELECT id FROM catalog_products WHERE source_key = ${sql(product.source_key)});`,
    );

    for (const [code, value] of Object.entries(product.prices)) {
      const columns = priceColumns(value);
      statements.push(
        `INSERT INTO catalog_product_prices
           (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at)
         SELECT p.id, l.id, ${sql(value.type)}, ${sql(columns.fixed)}, ${sql(columns.min)}, ${sql(columns.max)},
                ${sql(now)}, ${sql(now)}
           FROM catalog_products p, price_lists l
          WHERE p.source_key = ${sql(product.source_key)} AND l.code = ${sql(code)};`,
      );
    }
  }

  return statements;
}

function price(input, path) {
  const value = record(input, path);
  const type = value.type;
  if (typeof type !== 'string' || !PRICE_TYPES.has(type)) fail(`${path}.type ist ungültig.`);

  const allowed = {
    fixed: new Set(['type', 'price_cents']),
    from: new Set(['type', 'min_price_cents']),
    range: new Set(['type', 'min_price_cents', 'max_price_cents']),
    on_request: new Set(['type']),
  }[type];
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key} gehört nicht zur Preisart ${type}.`);
  }

  if (type === 'fixed') return { type, price_cents: cents(value.price_cents, `${path}.price_cents`) };
  if (type === 'from') return { type, min_price_cents: cents(value.min_price_cents, `${path}.min_price_cents`) };
  if (type === 'range') {
    const min = cents(value.min_price_cents, `${path}.min_price_cents`);
    const max = cents(value.max_price_cents, `${path}.max_price_cents`);
    if (min > max) fail(`${path}: min_price_cents darf max_price_cents nicht überschreiten.`);
    return { type, min_price_cents: min, max_price_cents: max };
  }
  return { type: 'on_request' };
}

function priceColumns(value) {
  if (value.type === 'fixed') return { fixed: value.price_cents, min: null, max: null };
  if (value.type === 'from') return { fixed: null, min: value.min_price_cents, max: null };
  if (value.type === 'range') return { fixed: null, min: value.min_price_cents, max: value.max_price_cents };
  return { fixed: null, min: null, max: null };
}

function record(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} muss ein Objekt sein.`);
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) fail(`${path} muss eine Liste sein.`);
  return value;
}

function text(value, max, path) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    fail(`${path} muss nichtleerer Text mit höchstens ${max} Zeichen sein.`);
  }
  return value.trim();
}

function nullableText(value, max, path) {
  if (value === undefined || value === null) return null;
  return text(value, max, path);
}

function integer(value, path) {
  if (!Number.isInteger(value) || value < 0) fail(`${path} muss eine nichtnegative Ganzzahl sein.`);
  return value;
}

function cents(value, path) {
  if (!Number.isInteger(value) || value < 0 || value > 9_999_999_999) {
    fail(`${path} muss ein nichtnegativer INTEGER-Centbetrag sein.`);
  }
  return value;
}

function sql(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function fail(message) {
  throw new Error(message);
}

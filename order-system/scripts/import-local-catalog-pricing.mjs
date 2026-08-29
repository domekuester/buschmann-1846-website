import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildCatalogImportSql, validateCatalogPricing } from './catalog-pricing.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');

export async function runCatalogImport({ source, mode, persistTo = null, execute = executeLocal }) {
  const raw = await readFile(source, 'utf8');
  const catalog = validateCatalogPricing(JSON.parse(raw));
  return importValidatedCatalog(catalog, mode, (sql) => execute(sql, persistTo));
}

export async function importValidatedCatalog(catalog, mode, execute) {
  const priceCount = catalog.products.reduce((sum, product) => sum + Object.keys(product.prices).length, 0);

  if (mode === 'local') {
    const sql = buildCatalogImportSql(catalog, new Date().toISOString());
    await execute(sql);
  } else if (mode !== 'dry-run') {
    throw new Error('Modus muss dry-run oder local sein.');
  }

  return { products: catalog.products.length, prices: priceCount, written: mode === 'local' };
}

async function executeLocal(sql, persistTo = null) {
  const directory = await mkdtemp(join(tmpdir(), 'buschmann-catalog-import-'));
  const sqlPath = join(directory, 'catalog-import.sql');
  try {
    await writeFile(sqlPath, sql, { encoding: 'utf8', mode: 0o600 });
    const args = ['wrangler', 'd1', 'execute', 'DB', '--local', `--file=${sqlPath}`];
    if (persistTo !== null) args.push(`--persist-to=${persistTo}`);
    const result = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args,
      { cwd: projectDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.status !== 0) {
      throw new Error('Der lokale D1-Import ist fehlgeschlagen. Prüfe Migration und lokale D1.');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  let mode = null;
  let source = resolve(projectDirectory, 'source-data/derived/catalog-pricing.json');
  let persistTo = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run' || arg === '--local') {
      if (mode !== null) throw new Error('Genau einen Modus angeben: --dry-run oder --local.');
      mode = arg.slice(2);
    } else if (arg === '--source') {
      const next = args[index + 1];
      if (!next) throw new Error('--source braucht einen Pfad.');
      source = resolve(projectDirectory, next);
      index += 1;
    } else if (arg === '--persist-to') {
      const next = args[index + 1];
      if (!next) throw new Error('--persist-to braucht einen Pfad.');
      persistTo = resolve(projectDirectory, next);
      index += 1;
    } else {
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }
  if (mode === null) throw new Error('Modus fehlt: --dry-run oder --local.');
  return { source, mode, persistTo };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runCatalogImport(parseArgs(process.argv.slice(2)));
    const action = result.written ? 'lokal importiert' : 'validiert, nichts geschrieben';
    process.stdout.write(`Katalog: ${result.products} Produkte, ${result.prices} Preise — ${action}.\n`);
  } catch (error) {
    process.stderr.write(`Katalogimport abgebrochen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}\n`);
    process.exitCode = 1;
  }
}

import { describe, expect, it } from 'vitest';
import {
  REQUIRED_SECRET_NAMES,
  checkAssetReferences,
  checkCanonicalCatalogSource,
  checkNoCommittedSecrets,
  checkWranglerConfig,
  referencedAssets,
} from '../../scripts/release-guard.mjs';

/**
 * Die Konfigurations- und Quellsicherheitsprüfungen des Release-Gates.
 *
 * Auch hier gilt, was schon für die Migrationserwartungen gilt: Eine Prüfung,
 * die selbst ungeprüft ist, ist eine Behauptung. Jede Funktion hier hat einen
 * Test für den guten UND für den schlechten Fall — sonst wäre nicht gezeigt,
 * dass sie überhaupt anschlagen kann.
 */

describe('REQUIRED_SECRET_NAMES', () => {
  it('nennt genau die drei Werte, die readAppConfig verlangt', () => {
    expect([...REQUIRED_SECRET_NAMES].sort()).toEqual([
      'APP_ORIGIN',
      'AUTH_PEPPER',
      'ENVIRONMENT',
    ]);
  });
});

describe('checkWranglerConfig', () => {
  const gut = {
    name: 'buschmann-order-system',
    main: 'src/worker.ts',
    d1_databases: [{ binding: 'DB', database_name: 'x', migrations_dir: 'migrations' }],
    assets: { directory: './public' },
  };

  it('nimmt die Konfiguration ohne vars an', () => {
    expect(checkWranglerConfig(gut)).toEqual([]);
  });

  it('LEHNT AB, wenn AUTH_PEPPER als eingecheckte var dasteht', () => {
    const befunde = checkWranglerConfig({ ...gut, vars: { AUTH_PEPPER: 'irgendwas' } });
    expect(befunde.join(' ')).toMatch(/AUTH_PEPPER/);
  });

  it('LEHNT AB, wenn ENVIRONMENT als eingecheckte var dasteht', () => {
    // Ein eingechecktes ENVIRONMENT wäre der Standardwert jedes Deployments —
    // und development schaltet Cookies ohne Secure frei.
    expect(checkWranglerConfig({ ...gut, vars: { ENVIRONMENT: 'development' } }).join(' ')).toMatch(
      /ENVIRONMENT/,
    );
  });

  it('verlangt ein D1-Binding namens DB', () => {
    expect(
      checkWranglerConfig({ ...gut, d1_databases: [{ binding: 'ANDERS' }] }).join(' '),
    ).toMatch(/DB/);
  });

  it('verlangt einen Worker-Einstiegspunkt', () => {
    const { main: _main, ...ohne } = gut;
    expect(checkWranglerConfig(ohne).join(' ')).toMatch(/main/);
  });

  it('verlangt ein Asset-Verzeichnis', () => {
    const { assets: _assets, ...ohne } = gut;
    expect(checkWranglerConfig(ohne).join(' ')).toMatch(/assets/i);
  });
});

describe('referencedAssets', () => {
  it('findet Stylesheets und Skripte im gerenderten HTML', () => {
    const quelle = `<link rel="stylesheet" href="/assets/app.css">
      <script type="module" src="/assets/print.js"></script>`;
    expect(referencedAssets(quelle).sort()).toEqual(['app.css', 'print.js']);
  });

  it('nennt jede Datei nur einmal', () => {
    expect(referencedAssets('/assets/a.css /assets/a.css')).toEqual(['a.css']);
  });

  it('findet nichts, wo nichts ist', () => {
    expect(referencedAssets('kein asset hier')).toEqual([]);
  });
});

describe('checkAssetReferences', () => {
  it('ist zufrieden, wenn jede referenzierte Datei existiert', () => {
    expect(checkAssetReferences(['app.css', 'app.js'], ['app.css', 'app.js', 'robots.txt'])).toEqual(
      [],
    );
  });

  it('meldet eine referenzierte Datei, die es nicht gibt — ein 404 im Betrieb', () => {
    expect(checkAssetReferences(['fehlt.css'], ['app.css']).join(' ')).toMatch(/fehlt\.css/);
  });
});

describe('checkNoCommittedSecrets', () => {
  it('ist zufrieden, wenn .dev.vars nicht in Git steht', () => {
    expect(checkNoCommittedSecrets([])).toEqual([]);
  });

  it('LEHNT AB, wenn .dev.vars eingecheckt ist', () => {
    expect(checkNoCommittedSecrets(['order-system/.dev.vars']).join(' ')).toMatch(/\.dev\.vars/);
  });

  it('erlaubt ausdrücklich die Vorlage .dev.vars.example', () => {
    expect(checkNoCommittedSecrets(['order-system/.dev.vars.example'])).toEqual([]);
  });

  it('LEHNT AB, wenn eine Preislisten-Quelle eingecheckt ist', () => {
    expect(checkNoCommittedSecrets(['order-system/source-data/preise.pdf']).join(' ')).toMatch(
      /source-data/,
    );
  });

  it('erlaubt ausschließlich den normalisierten kanonischen Katalog unter source-data', () => {
    expect(
      checkNoCommittedSecrets([
        'order-system/source-data/derived/catalog-pricing.json',
      ]),
    ).toEqual([]);
    expect(
      checkNoCommittedSecrets([
        'source-data/derived/catalog-pricing.json',
      ]),
    ).toEqual([]);
    expect(
      checkNoCommittedSecrets([
        'order-system/source-data/derived/anderer-katalog.json',
      ]).join(' '),
    ).toMatch(/source-data/);
  });
});

describe('checkCanonicalCatalogSource', () => {
  it('LEHNT AB, wenn der kanonische Katalog fehlt', () => {
    expect(checkCanonicalCatalogSource({ exists: false, ignored: false }).join(' ')).toMatch(/fehlt/i);
  });

  it('LEHNT AB, wenn der kanonische Katalog ignoriert ist', () => {
    expect(checkCanonicalCatalogSource({ exists: true, ignored: true }).join(' ')).toMatch(/ignoriert/i);
  });

  it('akzeptiert einen vorhandenen, nicht ignorierten kanonischen Katalog', () => {
    expect(checkCanonicalCatalogSource({ exists: true, ignored: false })).toEqual([]);
  });
});

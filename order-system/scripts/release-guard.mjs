#!/usr/bin/env node
/**
 * Die Konfigurations- und Quellsicherheitsprüfung des Release-Gates.
 *
 * Sie beantwortet Fragen, die kein Unit-Test stellt, weil sie nicht den Code
 * betreffen, sondern das ARTEFAKT:
 *
 *   Steht ein Geheimnis in Git?
 *   Steht ein Wert in wrangler.jsonc, der in Produktion gefährlich wäre?
 *   Verweist eine ausgelieferte Seite auf eine Datei, die es nicht gibt?
 *
 * KEIN NETZZUGRIFF, KEIN CLOUDFLARE-ZUGRIFF, KEINE DATENBANK. Dieses Skript
 * liest Dateien und fragt Git. Es kann eine Produktionsumgebung nicht
 * erreichen.
 *
 * Die Prüffunktionen sind rein und einzeln getestet
 * (tests/domain/release-guard.test.ts); hier unten steht nur das Einsammeln.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die drei Werte, die src/config/app-config.ts verlangt.
 *
 * Sie stehen hier als Prüfliste und nicht als Dokumentation: Käme ein
 * vierter dazu, ohne dass ihn jemand ins Runbook schreibt, wäre das ein
 * Deployment, dem beim Start etwas fehlt.
 */
export const REQUIRED_SECRET_NAMES = Object.freeze(['AUTH_PEPPER', 'APP_ORIGIN', 'ENVIRONMENT']);
export const CANONICAL_CATALOG_SOURCE = 'source-data/derived/catalog-pricing.json';

/**
 * Was in der eingecheckten Wrangler-Konfiguration stehen muss — und was
 * ausdrücklich nicht.
 *
 * Der wichtige Teil ist die zweite Hälfte. `vars` in wrangler.jsonc ist
 * eingecheckt und wäre damit der Standardwert JEDES Deployments. Ein dort
 * hinterlegtes ENVIRONMENT=development schaltete die Entwicklungspolicy frei
 * — Sitzungscookies ohne Secure, in Produktion. Ein dort hinterlegter
 * AUTH_PEPPER wäre ein Geheimnis in Git.
 */
export function checkWranglerConfig(config) {
  const befunde = [];

  if (typeof config.main !== 'string' || config.main.length === 0) {
    befunde.push('wrangler-Konfiguration: "main" (Worker-Einstiegspunkt) fehlt.');
  }

  if (typeof config.assets?.directory !== 'string') {
    befunde.push('wrangler-Konfiguration: "assets.directory" fehlt — die statischen Dateien würden nicht ausgeliefert.');
  }

  const bindings = (config.d1_databases ?? []).map((d) => d.binding);
  if (!bindings.includes('DB')) {
    befunde.push(`wrangler-Konfiguration: D1-Binding "DB" fehlt (gefunden: ${bindings.join(', ') || 'keines'}).`);
  }

  for (const name of REQUIRED_SECRET_NAMES) {
    if (config.vars !== undefined && Object.hasOwn(config.vars, name)) {
      befunde.push(
        `wrangler-Konfiguration: ${name} steht als "vars"-Eintrag in einer EINGECHECKTEN Datei. ` +
          'Dieser Wert gehört in ein Cloudflare Secret bzw. in die Deployment-Umgebung, niemals ins Repository.',
      );
    }
  }

  return befunde;
}

/** Die Dateinamen unter /assets/, auf die gerendertes HTML verweist. */
export function referencedAssets(quelltext) {
  const treffer = quelltext.matchAll(/\/assets\/([A-Za-z0-9._-]+\.[A-Za-z0-9]+)/g);
  return [...new Set([...treffer].map((t) => t[1]))];
}

/** Eine referenzierte, aber nicht vorhandene Datei ist im Betrieb ein 404. */
export function checkAssetReferences(referenziert, vorhanden) {
  return referenziert
    .filter((datei) => !vorhanden.includes(datei))
    .map((datei) => `Ausgeliefertes HTML verweist auf /assets/${datei}, die Datei fehlt in public/assets/.`);
}

/**
 * Dateien, die niemals in Git gehören.
 *
 * `.dev.vars.example` ist die ausdrückliche Ausnahme: Sie enthält
 * ausschließlich erkennbare Platzhalter und dokumentiert, welche Werte eine
 * lokale .dev.vars braucht. Der Prefix-Vergleich muss sie deshalb
 * ausklammern — sonst schlüge die Prüfung genau auf die Datei an, die es
 * geben soll.
 */
export function checkNoCommittedSecrets(getrackteDateien) {
  const befunde = [];

  for (const datei of getrackteDateien) {
    const basis = datei.split('/').pop() ?? datei;

    if (basis === '.dev.vars' || (basis.startsWith('.dev.vars.') && basis !== '.dev.vars.example')) {
      befunde.push(`Geheimnisdatei ist eingecheckt: ${datei}`);
    }

    const istKanonischerKatalog =
      datei === CANONICAL_CATALOG_SOURCE || datei === `order-system/${CANONICAL_CATALOG_SOURCE}`;
    if (datei.includes('source-data/') && !istKanonischerKatalog) {
      befunde.push(`Nicht erlaubte Quelldatei ist für Git sichtbar: ${datei}`);
    }
  }

  return befunde;
}

export function checkCanonicalCatalogSource({ exists, ignored }) {
  const befunde = [];

  if (!exists) {
    befunde.push(`Kanonischer Demo-Katalog fehlt: ${CANONICAL_CATALOG_SOURCE}`);
  }
  if (ignored) {
    befunde.push(`Kanonischer Demo-Katalog wird von Git ignoriert: ${CANONICAL_CATALOG_SOURCE}`);
  }

  return befunde;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitPathIsIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', path], { stdio: 'ignore' });
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && error.status === 1) {
      return false;
    }
    throw error;
  }
}

/** JSONC → JSON: Kommentare und abschließende Kommata entfernen. */
function parseJsonc(text) {
  const ohneKommentare = text
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(ohneKommentare.replace(/,(\s*[}\]])/g, '$1'));
}

function main() {
  const befunde = [];
  let schritt = 0;
  const melde = (text) => process.stdout.write(`  ${++schritt}. ${text}\n`);

  process.stdout.write('release:guard — Konfiguration, Geheimnisse, Auslieferungsartefakte\n\n');

  melde('wrangler.jsonc …');
  befunde.push(...checkWranglerConfig(parseJsonc(readFileSync('wrangler.jsonc', 'utf8'))));

  melde('Keine Geheimnisse in Git …');
  const getrackt = git(['ls-files']).split('\n').filter(Boolean);
  const sichtbareQuelldateien = git([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'source-data',
  ])
    .split('\n')
    .filter(Boolean);
  befunde.push(...checkNoCommittedSecrets([...new Set([...getrackt, ...sichtbareQuelldateien])]));

  melde('Kanonischer Demo-Katalog versionierbar …');
  const catalogSource = 'source-data/derived/catalog-pricing.json';
  befunde.push(
    ...checkCanonicalCatalogSource({
      exists: existsSync(catalogSource),
      ignored: gitPathIsIgnored(catalogSource),
    }),
  );

  melde('Statische Dateien vollständig …');
  const html = readdirSync('src/ui')
    .filter((n) => n.endsWith('.ts'))
    .map((n) => readFileSync(join('src/ui', n), 'utf8'))
    .join('\n');
  const vorhanden = readdirSync('public/assets');
  befunde.push(...checkAssetReferences(referencedAssets(html), vorhanden));

  melde('Arbeitsbaum ohne Whitespace-Fehler …');
  try {
    execFileSync('git', ['diff', '--check'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    befunde.push('git diff --check meldet Whitespace-Fehler im Arbeitsbaum.');
  }

  process.stdout.write('\n');
  if (befunde.length > 0) {
    process.stderr.write('RELEASE-GUARD FEHLGESCHLAGEN\n');
    for (const befund of befunde) {
      process.stderr.write(`  ✗ ${befund}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `✅ Konfiguration vollständig · keine Geheimnisse in Git · alle referenzierten Assets vorhanden.\n` +
      `   Benötigte Produktionswerte (nur Namen): ${REQUIRED_SECRET_NAMES.join(', ')}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

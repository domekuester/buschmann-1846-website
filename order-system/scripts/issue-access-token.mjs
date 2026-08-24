#!/usr/bin/env node
/**
 * Stellt einen Zugangstoken für ein Café aus.
 *
 * Das Skript SCHREIBT NICHT in eine Datenbank. Es erzeugt Token und Hash und
 * gibt beides samt fertigem INSERT aus — angewendet wird es von Hand, bewusst
 * und mit Blick darauf, gegen welche Datenbank. Ein Werkzeug, das selbst
 * schreiben kann, schreibt irgendwann versehentlich in die falsche.
 *
 * DER KLARTEXT ERSCHEINT GENAU EINMAL. Er steht danach nirgends mehr — nicht
 * in der Datenbank, nicht in einer Datei. Geht er verloren, wird ein neuer
 * ausgestellt und der alte widerrufen.
 *
 *   node scripts/issue-access-token.mjs --customer 1
 *   node scripts/issue-access-token.mjs --customer 1 --host bestellen.buschmann1846.de
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += ALPHABET[c & 0b111111];
  }
  return out;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const customerId = Number(arg('customer'));
if (!Number.isInteger(customerId) || customerId <= 0) {
  console.error('Aufruf: node scripts/issue-access-token.mjs --customer <id> [--host <domain>]');
  process.exit(1);
}

const host = arg('host', '127.0.0.1:8787');
const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = await sha256Hex(token);
const now = new Date().toISOString();
const scheme = host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https';

console.log(`
────────────────────────────────────────────────────────────────────────
 Zugang für Kunde ${customerId}

 Link — EINMALIG SICHTBAR, danach nicht wiederherstellbar:

   ${scheme}://${host}/o/${token}

 In die Datenbank kommt ausschließlich der Hash:

   INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at)
   VALUES (${customerId}, '${hash}', 1, '${now}');

 Lokal anwenden:

   npx wrangler d1 execute DB --local --command "<das INSERT von oben>"

 Widerrufen (später, bei Verlust oder Rotation):

   UPDATE customer_access_tokens
      SET is_active = 0, revoked_at = '<Zeitpunkt>'
    WHERE token_hash = '${hash}';
────────────────────────────────────────────────────────────────────────
`);

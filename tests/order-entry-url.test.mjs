import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOrderEntryUrl } from '../assets/js/order-entry.js';

test('local website entry opens the isolated order-system demo', () => {
  assert.equal(
    resolveOrderEntryUrl({ hostname: '127.0.0.1', port: '8000' }),
    'http://127.0.0.1:8790/bestellen',
  );
});

test('GitHub Pages preserves the page-relative static preview link', () => {
  assert.equal(
    resolveOrderEntryUrl({ hostname: 'domekuester.github.io', port: '' }),
    null,
  );
});

test('the future public website uses the same-origin customer route', () => {
  assert.equal(
    resolveOrderEntryUrl({ hostname: 'buschmann1846.de', port: '' }),
    '/bestellen',
  );
});

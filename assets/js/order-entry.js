const LOCAL_ORDER_ORIGIN = 'http://127.0.0.1:8790';
const PUBLIC_ORDER_PATH = '/bestellen';

export function resolveOrderEntryUrl({ hostname, port }) {
  const isLocalWebsite = (hostname === '127.0.0.1' || hostname === 'localhost')
    && port !== '8790';

  if (isLocalWebsite) return `${LOCAL_ORDER_ORIGIN}${PUBLIC_ORDER_PATH}`;
  if (hostname === 'github.io' || hostname.endsWith('.github.io')) return null;

  return PUBLIC_ORDER_PATH;
}

if (typeof document !== 'undefined') {
  const resolvedUrl = resolveOrderEntryUrl(window.location);

  if (resolvedUrl !== null) {
    document.querySelectorAll('[data-order-entry]').forEach((link) => {
      link.href = resolvedUrl;
    });
  }
}

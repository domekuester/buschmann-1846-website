import { describe, expect, it } from 'vitest';
import {
  RequestError,
  assertAnnouncedSizeOk,
  readBody,
} from '../../src/http/json-body';

const URL = 'http://127.0.0.1:8787/test';

describe('begrenztes Lesen von Request-Körpern', () => {
  it('lehnt ein eindeutig zu großes Content-Length ab, ohne den Stream zu lesen', () => {
    const request = new Request(URL, {
      method: 'POST',
      headers: { 'content-length': '101' },
      body: new ReadableStream<Uint8Array>(),
    });

    expect(() => assertAnnouncedSizeOk(request, 100)).toThrowError(RequestError);
    expect(request.bodyUsed).toBe(false);
  });

  it('liest einen gültigen mehrteiligen UTF-8-Körper unverändert', async () => {
    const encoder = new TextEncoder();
    const request = streamRequest([
      encoder.encode('name=Fiktive+'),
      encoder.encode('Pâtisserie'),
    ]);

    expect(await readBody(request, 100)).toBe('name=Fiktive+Pâtisserie');
  });

  it('bricht einen zu großen Stream ohne Content-Length kontrolliert ab', async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const request = streamRequest([
      encoder.encode('x'.repeat(60)),
      encoder.encode('y'.repeat(60)),
      encoder.encode('dieser Teil darf nicht mehr nötig sein'),
    ], () => { cancelled = true; });

    await expect(readBody(request, 100)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
    expect(cancelled).toBe(true);
  });

  it('vertraut einer zu kleinen Content-Length-Angabe nicht', async () => {
    const request = streamRequest([new TextEncoder().encode('x'.repeat(101))], undefined, '10');
    assertAnnouncedSizeOk(request, 100);

    await expect(readBody(request, 100)).rejects.toMatchObject({ status: 413 });
  });

  it('weist ungültiges UTF-8 als kontrolliert fehlerhafte Anfrage ab', async () => {
    const request = streamRequest([new Uint8Array([0xc3, 0x28])]);

    await expect(readBody(request, 100)).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
    });
  });
});

function streamRequest(
  chunks: readonly Uint8Array[],
  onCancel?: (() => void) | undefined,
  contentLength?: string | undefined,
): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel?.();
    },
  });
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (contentLength !== undefined) headers.set('content-length', contentLength);
  return new Request(URL, { method: 'POST', headers, body });
}

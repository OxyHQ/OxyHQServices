import type { IncomingMessage } from 'http';

/**
 * Read a bounded prefix of a response body as a UTF-8 string, settling exactly
 * once. The single shared reader for the link-preview pipeline: the HTML scrape
 * passes `stopMarker: '</head>'` to early-stop once the document head closes,
 * the oEmbed JSON read omits the marker.
 *
 * Semantics (preserved verbatim from the two original readers):
 *  - a single `settled` guard across `data` / `end` / `error`,
 *  - on the byte cap OR the stop marker, destroy the stream and RESOLVE the
 *    buffer read so far (never reject) so the parser always receives what was
 *    read,
 *  - `end` resolves the full buffer; `error` rejects,
 *  - the marker match is case-insensitive and boundary-safe: a small carryover
 *    (marker length − 1 bytes) from the previous chunk is searched together with
 *    the current chunk so a marker split across the chunk boundary is still
 *    detected. `</head>` is pure ASCII, so a `latin1` decode preserves bytes 1:1.
 */
export function readBoundedBody(
  response: IncomingMessage,
  options: { maxBytes: number; stopMarker?: string },
): Promise<string> {
  const { maxBytes, stopMarker } = options;
  const marker = stopMarker?.toLowerCase();
  const carrySize = marker ? marker.length - 1 : 0;

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;
    let carry: Buffer = Buffer.alloc(0);

    const finish = (): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    response.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalSize += chunk.length;
      chunks.push(chunk);

      if (marker) {
        const window = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
        if (window.toString('latin1').toLowerCase().includes(marker)) {
          finish();
          return;
        }
        carry = window.length > carrySize ? window.subarray(window.length - carrySize) : window;
      }

      if (totalSize > maxBytes) {
        finish();
      }
    });
    response.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    response.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

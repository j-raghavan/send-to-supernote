/**
 * FetchHttpClient (F5) — the SOLE `fetch` in the entire source tree.
 *
 * This is the one and only network seam (I-2/D-3): all HTTP goes through the
 * HttpClient port, and the only real implementation is here. A structural
 * tripwire test asserts no other `fetch(` exists in src. Body/header encoding
 * is the pure, covered `encodeRequest`; this file only performs the `fetch`
 * call and parses the response. Coverage-excluded (architecture §9.3): a thin
 * `fetch` shell with no decision logic.
 */
/* c8 ignore start */
import type { HttpClient, HttpRequest, HttpResponse } from '@shared/ports';
import { encodeRequest } from '@domain/http-encoding';

export class FetchHttpClient implements HttpClient {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const encoded = encodeRequest(req.body, req.headers ?? {});
    const response = await fetch(req.url, {
      method: req.method,
      headers: encoded.headers,
      ...(encoded.body !== undefined ? { body: encoded.body as BodyInit } : {}),
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = await parseJsonSafely(response);
      return json !== undefined ? { status: response.status, json } : { status: response.status };
    }
    // Non-JSON: on a failure, capture the body text (e.g. the S3 XML error) so the
    // delivery adapter can promote AWS's `<Code>` into an actionable message.
    if (!response.ok) {
      const bodyText = await safeText(response);
      return bodyText !== undefined
        ? { status: response.status, bodyText }
        : { status: response.status };
    }
    return { status: response.status };
  }

  async getBytes(url: string): Promise<{ status: number; bytes?: Uint8Array }> {
    const response = await fetch(url);
    if (!response.ok) {
      return { status: response.status };
    }
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  }
}

/** Parse a JSON body (caller has already checked the content-type); tolerate empty/invalid. */
async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Read an error body as text; tolerate an unreadable/empty body (returns undefined). */
async function safeText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    // Bound it — an error body is small. The cap is generous enough to retain
    // S3's full `<CanonicalRequest>` (it trails `StringToSignBytes` in the XML,
    // so a tight cap would clip it) without letting an unexpected body bloat.
    return text.length > 0 ? text.slice(0, 8192) : undefined;
  } catch {
    return undefined;
  }
}
/* c8 ignore stop */

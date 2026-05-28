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

    const json = await parseJsonSafely(response);
    return json !== undefined ? { status: response.status, json } : { status: response.status };
  }
}

/** Parse a JSON body when present; tolerate empty/non-JSON (e.g. the S3 PUT 200). */
async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
/* c8 ignore stop */

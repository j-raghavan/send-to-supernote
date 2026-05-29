/**
 * HTTP request body/header encoding (F5) — pure decision logic, no `fetch`.
 *
 * Decides how an HttpRequest body is encoded on the wire so the FetchHttpClient
 * adapter stays a thin `fetch` shell: a JSON object becomes a JSON string with a
 * JSON content-type; raw bytes (Uint8Array/ArrayBuffer) pass through unchanged
 * (the S3 PUT — F5-FR2); FormData passes through (the Private Cloud multipart
 * POST — F8). The caller-supplied headers win over the inferred content-type.
 */

export type EncodedBody = string | Uint8Array | ArrayBuffer | FormData | undefined;

export interface EncodedRequest {
  headers: Record<string, string>;
  body: EncodedBody;
}

function isBytes(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

/**
 * Encode a request body and merge headers. JSON content-type is only inferred
 * for plain objects and is not added when the caller already set Content-Type
 * (e.g. the S3 PUT sets application/pdf) or when the body is bytes/FormData.
 */
export function encodeRequest(body: unknown, headers: Record<string, string> = {}): EncodedRequest {
  if (body === undefined || body === null) {
    return { headers: { ...headers }, body: undefined };
  }
  if (isBytes(body) || isFormData(body)) {
    // Raw bytes (S3 PUT) and FormData (multipart) are sent as-is; the browser
    // sets the multipart boundary for FormData, so we never force its type.
    return { headers: { ...headers }, body };
  }
  if (typeof body === 'string') {
    return { headers: { ...headers }, body };
  }
  // Plain JSON object: serialize and default the content type if unset.
  const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
  const merged = hasContentType
    ? { ...headers }
    : { ...headers, 'Content-Type': 'application/json' };
  return { headers: merged, body: JSON.stringify(body) };
}

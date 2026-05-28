/**
 * Delivery domain (F2/F5/F8) — API profile (host/headers as DATA, not code) and
 * the response-envelope normalizer.
 *
 * Reverse-engineered endpoints are breakable, and two reference hosts exist
 * (`cloud.supernote.com` vs `viewer.supernote.com`) with different headers
 * (R-8); the working host/header set is pinned by the F5-FR1 spike and stored,
 * not hardcoded (ADR-0003). Both targets share the login flow but differ in
 * base URL and response envelope: public Cloud returns `{success, ...}`, Private
 * Cloud returns `{success, ...}` for auth/upload but `{code, data:{...}}` for
 * list/capacity. A single normalizer recognizes both (spec Interfaces).
 */

/** Header set sent alongside `x-access-token` on API calls (R-8). */
export interface ApiHeaders {
  version?: string;
  equipmentNo?: string;
  channel?: string;
}

/**
 * The pinned API profile: base URL + path prefix + header set + countryCode.
 * Public Cloud uses an empty prefix (`/file/...`); Private Cloud prefixes `/api`.
 */
export interface ApiProfile {
  /** Origin, e.g. `https://cloud.supernote.com` or `http://192.168.x.x:8080`. */
  baseUrl: string;
  /** Path prefix before the shared endpoint paths ('' for public, '/api' for private). */
  pathPrefix: string;
  /** Extra headers required by the chosen host (version/equipmentNo/channel). */
  headers: ApiHeaders;
  /** Whether this profile's list/etc. responses use the `{code, data}` envelope. */
  usesCodeEnvelope: boolean;
}

/** Default public Cloud profile (host pinned by the F5-FR1 spike; this is the assumption). */
export const DEFAULT_PUBLIC_PROFILE: ApiProfile = {
  baseUrl: 'https://cloud.supernote.com',
  pathPrefix: '',
  headers: {},
  usesCodeEnvelope: false,
};

/** Build a Private Cloud profile for a user-configured base URL (F8). */
export function privateCloudProfile(baseUrl: string): ApiProfile {
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    pathPrefix: '/api',
    headers: {},
    usesCodeEnvelope: true,
  };
}

/** Join a profile's base URL + prefix + endpoint path into an absolute URL. */
export function endpointUrl(profile: ApiProfile, path: string): string {
  const base = profile.baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${profile.pathPrefix}${normalizedPath}`;
}

/** Canonical, normalized view of any Supernote response envelope. */
export interface NormalizedEnvelope {
  /** True when the application-level call succeeded (`success` OR an OK `code`). */
  success: boolean;
  /** Application error code, e.g. `"E0401"` for an expired/invalid token. */
  errorCode?: string;
  /** Human-readable error message, if present. */
  errorMsg?: string;
  /** The payload: the envelope itself (public) or its `data` field (private `{code,data}`). */
  payload: Record<string, unknown>;
}

const OK_CODE = 0;
const SUCCESS_CODE = 200;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Normalize either envelope shape into a single canonical result. Recognizes
 * `success` truthiness OR an OK `code` (0 or 200), and surfaces `errorCode`
 * (e.g. `E0401`) from either shape. For `{code, data}`, the payload is `data`.
 */
export function normalizeEnvelope(body: unknown): NormalizedEnvelope {
  const root = asRecord(body);

  // `{code, data:{...}}` (Private Cloud list/capacity).
  if ('code' in root && typeof root.code === 'number') {
    const code = root.code;
    return {
      success: code === OK_CODE || code === SUCCESS_CODE,
      ...(asOptionalString(root.errorCode) !== undefined
        ? { errorCode: asOptionalString(root.errorCode)! }
        : {}),
      ...(asOptionalString(root.msg ?? root.errorMsg) !== undefined
        ? { errorMsg: asOptionalString(root.msg ?? root.errorMsg)! }
        : {}),
      payload: asRecord(root.data),
    };
  }

  // `{success, errorCode?, ...}` (public Cloud + Private Cloud auth/upload/finish).
  return {
    success: root.success === true,
    ...(asOptionalString(root.errorCode) !== undefined
      ? { errorCode: asOptionalString(root.errorCode)! }
      : {}),
    ...(asOptionalString(root.errorMsg) !== undefined
      ? { errorMsg: asOptionalString(root.errorMsg)! }
      : {}),
    payload: root,
  };
}

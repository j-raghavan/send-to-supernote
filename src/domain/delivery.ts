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
 * Both public and private endpoints live under `/api` (confirmed by the spike).
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

/**
 * Candidate public-API hosts (R-8). The F5-FR1 spike pins which one the user's
 * account actually accepts; both are declared statically in the manifest
 * (F1-FR3) and the resolved choice is stored under `supernote.apiHost`.
 */
export type PublicHost = 'cloud' | 'viewer';

export const DEFAULT_PUBLIC_HOST: PublicHost = 'viewer';

/**
 * Default public profile, pinned by the F5-FR1 live spike (2026-05-28):
 * `cloud.supernote.com` now returns HTTP 403 `CSRF_TOKEN_EXPIRED`, while
 * `viewer.supernote.com` accepts the nonce + login flow and returns a token.
 * All public endpoints live under `/api` (the host without `/api` returns 404);
 * no extra headers were needed for nonce/login. Pinned by the spike — never
 * hardcoded in logic.
 */
export const DEFAULT_PUBLIC_PROFILE: ApiProfile = {
  baseUrl: 'https://viewer.supernote.com',
  pathPrefix: '/api',
  headers: {},
  usesCodeEnvelope: false,
};

/**
 * The `cloud.supernote.com` variant — currently CSRF-gated (HTTP 403), kept as
 * a fallback in case Ratta reopens it. Same `/api` prefix and envelope.
 */
export const CLOUD_PUBLIC_PROFILE: ApiProfile = {
  baseUrl: 'https://cloud.supernote.com',
  pathPrefix: '/api',
  headers: {},
  usesCodeEnvelope: false,
};

/** Resolve the public profile for a pinned host (defaulting to `viewer`). */
export function resolvePublicProfile(host: PublicHost = DEFAULT_PUBLIC_HOST): ApiProfile {
  return host === 'cloud' ? CLOUD_PUBLIC_PROFILE : DEFAULT_PUBLIC_PROFILE;
}

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

/** Application error codes that mean the token is invalid/expired (F2-FR4). */
export const AUTH_ERROR_CODES: ReadonlySet<string> = new Set(['E0401']);

const HTTP_UNAUTHORIZED = 401;

/**
 * Detect an auth failure on any authenticated call: a transport `401` OR an
 * application-level auth error code (e.g. `E0401`) returned at HTTP 200 (spec
 * Interfaces; F2-FR4 / F5-FR4 / F8-FR6). Both must be treated equivalently.
 */
export function isAuthFailure(httpStatus: number, env: NormalizedEnvelope): boolean {
  if (httpStatus === HTTP_UNAUTHORIZED) {
    return true;
  }
  return env.errorCode !== undefined && AUTH_ERROR_CODES.has(env.errorCode);
}

/** A folder/file entry as returned by `list/query` (both targets, normalized). */
export interface Folder {
  id: string;
  name: string;
  isFolder: boolean;
}

/** The Document/ folder name both targets resolve their default destination from. */
export const DOCUMENT_FOLDER_NAME = 'Document';

/** Root directory id (both targets use "0"). */
export const ROOT_DIRECTORY_ID = '0';

/**
 * Normalize an `isFolder` value across targets: public Cloud uses a boolean,
 * Private Cloud uses the string `"Y"`/`"N"` (Interfaces). Anything else is false.
 */
export function normalizeIsFolder(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return value === 'Y' || value === 'y';
}

/**
 * Normalize a raw `list/query` entry into a Folder. Returns undefined when the
 * id/name are missing/ill-typed (defensive against breakable shapes — R-1).
 */
export function normalizeFolderEntry(raw: unknown): Folder | undefined {
  const entry = asRecord(raw);
  const id = entry.id;
  const name = entry.fileName;
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof name !== 'string') {
    return undefined;
  }
  return { id: String(id), name, isFolder: normalizeIsFolder(entry.isFolder) };
}

/** Parse a `userFileVOList` payload into normalized Folder entries. */
export function parseFolderList(payload: Record<string, unknown>): Folder[] {
  const list = payload.userFileVOList;
  if (!Array.isArray(list)) {
    return [];
  }
  const folders: Folder[] = [];
  for (const raw of list) {
    const folder = normalizeFolderEntry(raw);
    if (folder !== undefined) {
      folders.push(folder);
    }
  }
  return folders;
}

/** Find the id of the `Document/` folder among listed entries, if present. */
export function findDocumentFolderId(folders: readonly Folder[]): string | undefined {
  return folders.find((f) => f.isFolder && f.name === DOCUMENT_FOLDER_NAME)?.id;
}

/** Outcome category for any delivery step, so call sites branch uniformly. */
export type DeliveryFailureKind = 'auth' | 'not-found' | 'connection' | 'protocol';

export interface DeliveryFailure {
  kind: DeliveryFailureKind;
  /** Application error code from the envelope (e.g. E0401), when present. */
  errorCode?: string;
  message: string;
}

/** Classify a non-success delivery response into a canonical failure. */
export function classifyDeliveryFailure(
  httpStatus: number,
  env: NormalizedEnvelope,
  fallbackMessage: string,
): DeliveryFailure {
  if (isAuthFailure(httpStatus, env)) {
    return {
      kind: 'auth',
      ...(env.errorCode !== undefined ? { errorCode: env.errorCode } : {}),
      message: env.errorMsg ?? 'Session expired',
    };
  }
  return {
    kind: 'protocol',
    ...(env.errorCode !== undefined ? { errorCode: env.errorCode } : {}),
    message: env.errorMsg ?? fallbackMessage,
  };
}

/** Basename of a URL path — `innerName` for the finish step (F5-FR2). */
export function basenameFromUrl(url: string): string {
  const withoutQuery = url.split('?', 1).join('');
  const slash = withoutQuery.lastIndexOf('/');
  return slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery;
}

/** A canonical connection failure (server unreachable, TLS, wrong URL) — F8-FR6. */
export function connectionFailure(message: string): DeliveryFailure {
  return { kind: 'connection', message };
}

/**
 * Private Cloud apply nonce: `{10 random digits}{timestamp}` (Interfaces /
 * F8-FR2). The random digits come from the injected RandomSource; the timestamp
 * is the apply-call time in ms.
 */
export function privateCloudNonce(randomDigits: string, timestamp: number): string {
  return `${randomDigits}${String(timestamp)}`;
}

/**
 * Whether the Private Cloud OSS transfer step succeeded (F8-FR6, OSS relax).
 *
 * The multipart upload to the apply-issued URL is a RAW byte transfer: success
 * is HTTP 2xx, and a bare 200 with no JSON body is OK (a real server may return
 * no envelope). It only FAILS when the server explicitly says so — a non-2xx
 * status, or a present envelope that is `success:false` / carries an auth error.
 * `apply` and `finish` remain envelope-strict (integrity is guaranteed by the
 * finish gate, I-3); this leniency applies ONLY to the byte-transfer step.
 */
export function isTransferOk(status: number, rawJson: unknown): boolean {
  if (status < 200 || status >= 300) {
    return false;
  }
  // No body / non-object body => a bare 2xx transfer, which is OK.
  if (typeof rawJson !== 'object' || rawJson === null) {
    return true;
  }
  // An envelope is present: it must not be an EXPLICIT failure. A `{success}` or
  // `{code}` envelope is honored; an auth error (E0401) always fails. Any other
  // 2xx object body (no success/code/errorCode signal) is treated as OK.
  const body = rawJson as Record<string, unknown>;
  const hasEnvelope = 'success' in body || 'code' in body || body.errorCode !== undefined;
  if (!hasEnvelope) {
    return true;
  }
  return normalizeEnvelope(rawJson).success;
}

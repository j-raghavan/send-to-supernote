/**
 * Self-hosted Supernote Private Cloud upload (F8-FR2/FR3/FR6) — apply -> upload
 * -> finish against the user's OWN server (D-3: no third party). Differs from
 * public Cloud (ADR-0004):
 *  - all paths prefixed /api (via the private ApiProfile);
 *  - apply requires `timestamp` + `nonce` headers (nonce = {10 digits}{ts});
 *  - the upload is a multipart POST of `file=<blob>` to the URL the apply step
 *    RETURNS (commonly /api/oss/upload — NOT hardcoded), not an S3 PUT;
 *  - directory ids are large numeric strings and isFolder is the string "Y"/"N".
 *
 * JWT via x-access-token; the response envelope may be {success} OR {code,data}
 * (normalizeEnvelope handles both). Done only after finish success (I-3). A
 * thrown request (server unreachable / TLS / wrong URL) is classified as a
 * connection failure, NOT auth (F8-FR6). All decision logic is covered; only the
 * fetch goes through the HttpClient port.
 */
import { err, ok, type Result } from '@shared/result';
import type { Clock, HttpClient, HttpResponse, RandomSource } from '@shared/ports';
import { md5hexBytes } from '@shared/md5';
import {
  type ApiProfile,
  classifyDeliveryFailure,
  connectionFailure,
  type DeliveryFailure,
  endpointUrl,
  type Folder,
  isTransferOk,
  normalizeEnvelope,
  parseFolderList,
  privateCloudNonce,
  privateCloudProfile,
  ROOT_DIRECTORY_ID,
} from '@domain/delivery';
import { privateCloudNetworkErrorHint, resolveUploadUrl } from '@domain/private-cloud-url';
import type { DeliveryPort, UploadInput, UploadResult } from './delivery-port';

export const PC_APPLY_PATH = '/file/upload/apply';
export const PC_FINISH_PATH = '/file/upload/finish';
export const PC_LIST_PATH = '/file/list/query';

const NONCE_DIGITS = 10;
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 50;

export interface PrivateCloudDeps {
  http: HttpClient;
  baseUrl: string;
  token: string;
  random: RandomSource;
  clock: Clock;
}

interface ApplyResponse {
  /** The upload URL the server returns (commonly /api/oss/upload). */
  uploadUrl?: unknown;
  url?: unknown;
  /** Absolute upload URL some Private Cloud builds return (reverse-proxy setups). */
  fullUploadUrl?: unknown;
  /** Multipart/part upload URL some builds return; last-resort fallback. */
  partUploadUrl?: unknown;
  /** Server-side object name to echo back at finish (some Private Cloud builds). */
  innerName?: unknown;
}

function profileOf(deps: PrivateCloudDeps): ApiProfile {
  return privateCloudProfile(deps.baseUrl);
}

function authHeader(token: string): Record<string, string> {
  return { 'x-access-token': token };
}

/**
 * Resolve the upload URL the apply step returned. Builds vary: some return
 * `fullUploadUrl` (an absolute URL), others `uploadUrl` or `url` (commonly the
 * relative /api/oss/upload). `fullUploadUrl` wins when present; the host it names
 * is re-based onto the configured server at the POST step (see resolveUploadUrl).
 */
function applyUploadUrl(payload: ApplyResponse): string | undefined {
  const candidates = [payload.fullUploadUrl, payload.uploadUrl, payload.url, payload.partUploadUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * The server-side object name the apply step recorded. Some Private Cloud builds
 * require this exact `innerName` to be echoed back at finish (otherwise finish
 * rejects the upload); when the build doesn't return one, we send the file name
 * (the finish step has always carried a name, so this is safe across builds).
 */
function applyInnerName(payload: ApplyResponse, fallback: string): string {
  return typeof payload.innerName === 'string' && payload.innerName.length > 0
    ? payload.innerName
    : fallback;
}

/** Wrap bytes in a Blob with a plain ArrayBuffer backing (TS6 typed-array safety). */
function toBlob(bytes: Uint8Array, contentType: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: contentType });
}

/**
 * Run an HttpClient call, mapping a thrown (network/TLS) error to a connection
 * failure. Uses the SAME actionable hint as the connect path (reachability +
 * cert/port guidance) so send-time failures are as diagnosable as connect-time.
 */
async function safeRequest(
  deps: { http: HttpClient; baseUrl: string },
  req: Parameters<HttpClient['request']>[0],
): Promise<Result<HttpResponse, DeliveryFailure>> {
  try {
    return ok(await deps.http.request(req));
  } catch {
    return err(connectionFailure(privateCloudNetworkErrorHint(deps.baseUrl)));
  }
}

/**
 * Upload a converted blob to the user's Private Cloud. apply(+nonce/timestamp)
 * -> multipart POST to the apply-returned URL -> finish. Done only after finish
 * success (I-3 / F8-AC2).
 */
export async function uploadToPrivateCloud(
  deps: PrivateCloudDeps,
  input: UploadInput,
): Promise<Result<UploadResult, DeliveryFailure>> {
  const profile = profileOf(deps);
  const md5 = md5hexBytes(input.bytes);
  const size = input.bytes.byteLength;

  // 1. apply (with timestamp + nonce headers)
  const timestamp = deps.clock.now();
  const nonce = privateCloudNonce(deps.random.digits(NONCE_DIGITS), timestamp);
  const applyRes = await safeRequest(deps, {
    url: endpointUrl(profile, PC_APPLY_PATH),
    method: 'POST',
    headers: { ...authHeader(deps.token), timestamp: String(timestamp), nonce },
    body: { directoryId: input.directoryId, fileName: input.fileName, md5, size },
  });
  if (!applyRes.ok) {
    return applyRes;
  }
  const applyEnv = normalizeEnvelope(applyRes.value.json);
  if (!applyEnv.success) {
    return err(classifyDeliveryFailure(applyRes.value.status, applyEnv, 'Upload could not start'));
  }
  const uploadUrl = applyUploadUrl(applyEnv.payload);
  if (uploadUrl === undefined) {
    return err({ kind: 'protocol', message: 'Private Cloud apply returned no upload URL' });
  }
  const innerName = applyInnerName(applyEnv.payload, input.fileName);

  // 2. multipart POST of the file to the apply-returned URL (NOT a hardcoded
  // path). The host is re-based onto the configured server; an apply URL we
  // can't resolve to an http(s) path there is a protocol error, not a guess.
  const resolvedUploadUrl = resolveUploadUrl(deps.baseUrl, uploadUrl);
  if (resolvedUploadUrl === undefined) {
    return err({
      kind: 'protocol',
      message: 'Private Cloud apply returned a malformed upload URL',
    });
  }
  const form = new FormData();
  form.append('file', toBlob(input.bytes, input.contentType), input.fileName);
  const uploadRes = await safeRequest(deps, {
    url: resolvedUploadUrl,
    method: 'POST',
    headers: authHeader(deps.token),
    body: form,
  });
  if (!uploadRes.ok) {
    return uploadRes;
  }
  // The OSS step is a RAW byte transfer: a bare 2xx (no envelope) is success.
  // It only fails on a non-2xx status or an explicit failure envelope (F8-FR6
  // OSS relax). Integrity is still guaranteed by the strict finish gate (I-3).
  if (!isTransferOk(uploadRes.value.status, uploadRes.value.json)) {
    return err(
      classifyDeliveryFailure(
        uploadRes.value.status,
        normalizeEnvelope(uploadRes.value.json),
        'Private Cloud upload failed',
      ),
    );
  }

  // 3. finish — always echo innerName (apply-issued when present, else the file
  // name); some builds require it and the finish step has always carried a name.
  const finishRes = await safeRequest(deps, {
    url: endpointUrl(profile, PC_FINISH_PATH),
    method: 'POST',
    headers: authHeader(deps.token),
    body: {
      directoryId: input.directoryId,
      fileName: input.fileName,
      innerName,
      md5,
      fileSize: size,
    },
  });
  if (!finishRes.ok) {
    return finishRes;
  }
  const finishEnv = normalizeEnvelope(finishRes.value.json);
  if (!finishEnv.success) {
    return err(
      classifyDeliveryFailure(finishRes.value.status, finishEnv, 'Upload could not be finished'),
    );
  }

  return ok({ fileName: input.fileName, innerName });
}

/** List a Private Cloud directory via /api/file/list/query, paginated + normalized. */
export async function listPrivateCloudFolders(
  deps: PrivateCloudDeps,
  directoryId: string,
): Promise<Result<Folder[], DeliveryFailure>> {
  const profile = profileOf(deps);
  const all: Folder[] = [];
  for (let pageNo = 1; pageNo <= MAX_LIST_PAGES; pageNo += 1) {
    const res = await safeRequest(deps, {
      url: endpointUrl(profile, PC_LIST_PATH),
      method: 'POST',
      headers: authHeader(deps.token),
      body: { directoryId, pageNo, pageSize: LIST_PAGE_SIZE, order: 'time', sequence: 'desc' },
    });
    if (!res.ok) {
      return res;
    }
    const env = normalizeEnvelope(res.value.json);
    if (!env.success) {
      return err(classifyDeliveryFailure(res.value.status, env, 'Could not list folders'));
    }
    const page = parseFolderList(env.payload);
    all.push(...page);
    const total = typeof env.payload.total === 'number' ? env.payload.total : undefined;
    if (page.length < LIST_PAGE_SIZE || (total !== undefined && all.length >= total)) {
      break;
    }
  }
  return ok(all);
}

/** The DeliveryPort implementation for the self-hosted Private Cloud (ADR-0004). */
export class PrivateCloudAdapter implements DeliveryPort {
  constructor(private readonly deps: PrivateCloudDeps) {}

  uploadDocument(input: UploadInput): Promise<Result<UploadResult, DeliveryFailure>> {
    return uploadToPrivateCloud(this.deps, input);
  }

  listFolders(directoryId: string): Promise<Result<Folder[], DeliveryFailure>> {
    return listPrivateCloudFolders(this.deps, directoryId);
  }

  async healthCheck(): Promise<Result<void, DeliveryFailure>> {
    const result = await listPrivateCloudFolders(this.deps, ROOT_DIRECTORY_ID);
    return result.ok ? ok(undefined) : err(result.error);
  }
}

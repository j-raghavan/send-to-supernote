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
}

function profileOf(deps: PrivateCloudDeps): ApiProfile {
  return privateCloudProfile(deps.baseUrl);
}

function authHeader(token: string): Record<string, string> {
  return { 'x-access-token': token };
}

/** Resolve the upload URL the apply step returned (uploadUrl or url field). */
function applyUploadUrl(payload: ApplyResponse): string | undefined {
  if (typeof payload.uploadUrl === 'string' && payload.uploadUrl.length > 0) {
    return payload.uploadUrl;
  }
  if (typeof payload.url === 'string' && payload.url.length > 0) {
    return payload.url;
  }
  return undefined;
}

/** Wrap bytes in a Blob with a plain ArrayBuffer backing (TS6 typed-array safety). */
function toBlob(bytes: Uint8Array, contentType: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: contentType });
}

/** Make the upload URL absolute against the base when apply returns a relative path. */
function absoluteUploadUrl(deps: PrivateCloudDeps, uploadUrl: string): string {
  if (uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://')) {
    return uploadUrl;
  }
  const path = uploadUrl.startsWith('/') ? uploadUrl : `/${uploadUrl}`;
  return `${deps.baseUrl.replace(/\/+$/, '')}${path}`;
}

/** Run an HttpClient call, mapping a thrown (network/TLS) error to a connection failure. */
async function safeRequest(
  http: HttpClient,
  req: Parameters<HttpClient['request']>[0],
): Promise<Result<HttpResponse, DeliveryFailure>> {
  try {
    return ok(await http.request(req));
  } catch {
    return err(
      connectionFailure(
        "Can't reach your Private Cloud server. Check the URL and that it's running.",
      ),
    );
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
  const applyRes = await safeRequest(deps.http, {
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

  // 2. multipart POST of the file to the apply-returned URL (NOT a hardcoded path)
  const form = new FormData();
  form.append('file', toBlob(input.bytes, input.contentType), input.fileName);
  const uploadRes = await safeRequest(deps.http, {
    url: absoluteUploadUrl(deps, uploadUrl),
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

  // 3. finish
  const finishRes = await safeRequest(deps.http, {
    url: endpointUrl(profile, PC_FINISH_PATH),
    method: 'POST',
    headers: authHeader(deps.token),
    body: { directoryId: input.directoryId, fileName: input.fileName, md5, fileSize: size },
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

  return ok({ fileName: input.fileName, innerName: input.fileName });
}

/** List a Private Cloud directory via /api/file/list/query, paginated + normalized. */
export async function listPrivateCloudFolders(
  deps: PrivateCloudDeps,
  directoryId: string,
): Promise<Result<Folder[], DeliveryFailure>> {
  const profile = profileOf(deps);
  const all: Folder[] = [];
  for (let pageNo = 1; pageNo <= MAX_LIST_PAGES; pageNo += 1) {
    const res = await safeRequest(deps.http, {
      url: endpointUrl(profile, PC_LIST_PATH),
      method: 'POST',
      headers: authHeader(deps.token),
      body: { directoryId, pageNo, pageSize: LIST_PAGE_SIZE },
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

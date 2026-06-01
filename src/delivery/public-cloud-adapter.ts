/**
 * Public Supernote Cloud upload (F5-FR2) — apply -> PUT -> finish, fully
 * client-side (D-3). Uses the HttpClient port (testable; the real fetch is the
 * sole adapter) and the pinned ApiProfile. Decision logic (md5/size, envelope
 * checks, innerName) is covered; only the network calls go through the port.
 *
 * - apply:  POST /file/upload/apply {directoryId, fileName, md5, size}
 *           -> {url (pre-signed S3 PUT), s3Authorization, xamzDate}
 * - PUT:    PUT <url> raw bytes; headers Authorization, x-amz-date,
 *           x-amz-content-sha256: UNSIGNED-PAYLOAD, Content-Type
 * - finish: POST /file/upload/finish {directoryId, fileName, fileSize,
 *           innerName=basename(url), md5} -> {success} (must be true — I-3)
 */
import { err, ok, type Result } from '@shared/result';
import type { HttpClient } from '@shared/ports';
import { md5hexBytes } from '@shared/md5';
import {
  type ApiProfile,
  basenameFromUrl,
  classifyDeliveryFailure,
  type DeliveryFailure,
  endpointUrl,
  type Folder,
  normalizeEnvelope,
  parseFolderList,
  ROOT_DIRECTORY_ID,
  s3UploadFailureMessage,
} from '@domain/delivery';
import type { DeliveryPort, UploadInput, UploadResult } from './delivery-port';

export const APPLY_PATH = '/file/upload/apply';
export const FINISH_PATH = '/file/upload/finish';
export const LIST_PATH = '/file/list/query';

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
/** Page size for list/query; folder trees larger than this are paginated (F5-FR3). */
const LIST_PAGE_SIZE = 100;
/** Safety bound on pagination so a misbehaving server can't loop forever. */
const MAX_LIST_PAGES = 50;

export interface PublicCloudDeps {
  http: HttpClient;
  profile: ApiProfile;
  token: string;
}

interface ApplyResponse {
  url?: unknown;
  s3Authorization?: unknown;
  xamzDate?: unknown;
}

function authHeaders(profile: ApiProfile, token: string): Record<string, string> {
  const headers: Record<string, string> = { 'x-access-token': token };
  if (profile.headers.version !== undefined) {
    headers.version = profile.headers.version;
  }
  if (profile.headers.equipmentNo !== undefined) {
    headers.equipmentNo = profile.headers.equipmentNo;
  }
  if (profile.headers.channel !== undefined) {
    headers.channel = profile.headers.channel;
  }
  return headers;
}

/**
 * Upload a converted blob to public Supernote Cloud. "done" only after finish
 * returns success (I-3 / F5-FR6); any step's auth failure (401/E0401) or other
 * failure surfaces a canonical DeliveryFailure for F2/F9 routing (F5-FR4).
 */
export async function uploadToCloud(
  deps: PublicCloudDeps,
  input: UploadInput,
): Promise<Result<UploadResult, DeliveryFailure>> {
  const { http, profile, token } = deps;
  const md5 = md5hexBytes(input.bytes);
  const size = input.bytes.byteLength;

  // 1. apply
  const applyRes = await http.request({
    url: endpointUrl(profile, APPLY_PATH),
    method: 'POST',
    headers: authHeaders(profile, token),
    body: { directoryId: input.directoryId, fileName: input.fileName, md5, size },
  });
  const applyEnv = normalizeEnvelope(applyRes.json);
  if (!applyEnv.success) {
    return err(classifyDeliveryFailure(applyRes.status, applyEnv, 'Upload could not start'));
  }
  const apply = applyEnv.payload as ApplyResponse;
  if (typeof apply.url !== 'string' || apply.url.length === 0) {
    return err({ kind: 'protocol', message: 'Upload-apply returned no URL' });
  }
  const uploadUrl = apply.url;

  // 2. PUT bytes to the pre-signed S3 URL
  const putHeaders: Record<string, string> = {
    'x-amz-content-sha256': UNSIGNED_PAYLOAD,
    'Content-Type': input.contentType,
  };
  if (typeof apply.s3Authorization === 'string') {
    putHeaders.Authorization = apply.s3Authorization;
  }
  if (typeof apply.xamzDate === 'string') {
    putHeaders['x-amz-date'] = apply.xamzDate;
  }
  const putRes = await http.request({
    url: uploadUrl,
    method: 'PUT',
    headers: putHeaders,
    body: input.bytes,
  });
  if (putRes.status < 200 || putRes.status >= 300) {
    // Surface AWS's XML error code (e.g. SignatureDoesNotMatch / RequestTimeTooSkewed)
    // when present so a 403 is actionable rather than opaque.
    return err({
      kind: 'protocol',
      message: s3UploadFailureMessage(putRes.status, putRes.bodyText),
    });
  }

  // 3. finish (innerName = basename of the apply URL)
  const innerName = basenameFromUrl(uploadUrl);
  const finishRes = await http.request({
    url: endpointUrl(profile, FINISH_PATH),
    method: 'POST',
    headers: authHeaders(profile, token),
    body: {
      directoryId: input.directoryId,
      fileName: input.fileName,
      fileSize: size,
      innerName,
      md5,
    },
  });
  const finishEnv = normalizeEnvelope(finishRes.json);
  if (!finishEnv.success) {
    return err(
      classifyDeliveryFailure(finishRes.status, finishEnv, 'Upload could not be finished'),
    );
  }

  return ok({ fileName: input.fileName, innerName });
}

/**
 * List a folder's entries via `/file/list/query`, paginating across `pageNo`
 * (the page size can truncate large trees — F5-FR3) until fewer than a full page
 * is returned or `total` is reached. Returns normalized Folder entries.
 */
export async function listCloudFolders(
  deps: PublicCloudDeps,
  directoryId: string,
): Promise<Result<Folder[], DeliveryFailure>> {
  const { http, profile, token } = deps;
  const all: Folder[] = [];

  for (let pageNo = 1; pageNo <= MAX_LIST_PAGES; pageNo += 1) {
    const res = await http.request({
      url: endpointUrl(profile, LIST_PATH),
      method: 'POST',
      headers: authHeaders(profile, token),
      body: { directoryId, pageNo, pageSize: LIST_PAGE_SIZE, order: 'time', sequence: 'desc' },
    });
    const env = normalizeEnvelope(res.json);
    if (!env.success) {
      return err(classifyDeliveryFailure(res.status, env, 'Could not list folders'));
    }
    const page = parseFolderList(env.payload);
    all.push(...page);
    const total = typeof env.payload.total === 'number' ? env.payload.total : undefined;
    const lastPage = page.length < LIST_PAGE_SIZE || (total !== undefined && all.length >= total);
    if (lastPage) {
      break;
    }
  }
  return ok(all);
}

/**
 * The DeliveryPort implementation for public Supernote Cloud (ADR-0004). Wraps
 * the upload pipeline and folder listing; healthCheck is a cheap authenticated
 * root list (F9-FR3).
 */
export class PublicCloudAdapter implements DeliveryPort {
  constructor(private readonly deps: PublicCloudDeps) {}

  uploadDocument(input: UploadInput): Promise<Result<UploadResult, DeliveryFailure>> {
    return uploadToCloud(this.deps, input);
  }

  listFolders(directoryId: string): Promise<Result<Folder[], DeliveryFailure>> {
    return listCloudFolders(this.deps, directoryId);
  }

  async healthCheck(): Promise<Result<void, DeliveryFailure>> {
    const result = await listCloudFolders(this.deps, ROOT_DIRECTORY_ID);
    return result.ok ? ok(undefined) : err(result.error);
  }
}

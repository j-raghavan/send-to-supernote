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
  normalizeEnvelope,
} from '@domain/delivery';
import type { UploadInput, UploadResult } from './delivery-port';

export const APPLY_PATH = '/file/upload/apply';
export const FINISH_PATH = '/file/upload/finish';

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

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
    return err({ kind: 'protocol', message: `S3 upload failed (HTTP ${String(putRes.status)})` });
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

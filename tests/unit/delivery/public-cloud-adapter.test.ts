import { beforeEach, describe, expect, it } from 'vitest';
import {
  APPLY_PATH,
  FINISH_PATH,
  type PublicCloudDeps,
  uploadToCloud,
} from '../../../src/delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { md5hexBytes } from '@shared/md5';
import type { UploadInput } from '../../../src/delivery/delivery-port';
import { FakeHttpClient } from '../../fakes/fake-http-client';

const S3_URL = 'https://supernote-bucket.s3.amazonaws.com/Document/obj-abc123?X-Amz-Sig=zzz';

function input(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    contentType: 'application/pdf',
    directoryId: '42',
    fileName: 'My-Article.pdf',
    ...overrides,
  };
}

function deps(http: FakeHttpClient): PublicCloudDeps {
  return { http, profile: DEFAULT_PUBLIC_PROFILE, token: 'tok-123' };
}

function happyPath(http: FakeHttpClient): void {
  http
    .on(APPLY_PATH, {
      status: 200,
      json: {
        success: true,
        url: S3_URL,
        s3Authorization: 'AWS sig',
        xamzDate: '20260528T000000Z',
      },
    })
    .on('s3.amazonaws.com', { status: 200 })
    .on(FINISH_PATH, { status: 200, json: { success: true } });
}

describe('uploadToCloud (F5-FR2)', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient();
  });

  it('runs apply -> PUT -> finish in order and reports success', async () => {
    happyPath(http);
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fileName).toBe('My-Article.pdf');
      expect(result.value.innerName).toBe('obj-abc123');
    }
    expect(http.requests.map((r) => r.method)).toEqual(['POST', 'PUT', 'POST']);
    expect(http.urls[0]).toContain(APPLY_PATH);
    expect(http.urls[1]).toBe(S3_URL);
    expect(http.urls[2]).toContain(FINISH_PATH);
  });

  it('sends the correct hex md5 + size on apply and finish', async () => {
    happyPath(http);
    const bytes = new Uint8Array([9, 8, 7]);
    await uploadToCloud(deps(http), input({ bytes }));
    const applyBody = http.requests[0]!.body as Record<string, unknown>;
    const finishBody = http.requests[2]!.body as Record<string, unknown>;
    expect(applyBody.md5).toBe(md5hexBytes(bytes));
    expect(applyBody.size).toBe(3);
    expect(finishBody.md5).toBe(md5hexBytes(bytes));
    expect(finishBody.fileSize).toBe(3);
  });

  it('sets innerName to the basename of the apply URL on finish', async () => {
    happyPath(http);
    await uploadToCloud(deps(http), input());
    const finishBody = http.requests[2]!.body as Record<string, unknown>;
    expect(finishBody.innerName).toBe('obj-abc123');
  });

  it('PUTs the raw bytes with the S3 headers and content type', async () => {
    happyPath(http);
    const bytes = new Uint8Array([1, 2, 3]);
    await uploadToCloud(deps(http), input({ bytes }));
    const put = http.requests[1]!;
    expect(put.body).toBe(bytes);
    expect(put.headers!['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD');
    expect(put.headers!.Authorization).toBe('AWS sig');
    expect(put.headers!['x-amz-date']).toBe('20260528T000000Z');
    expect(put.headers!['Content-Type']).toBe('application/pdf');
  });

  it('sends the x-access-token on apply and finish', async () => {
    happyPath(http);
    await uploadToCloud(deps(http), input());
    expect(http.requests[0]!.headers!['x-access-token']).toBe('tok-123');
    expect(http.requests[2]!.headers!['x-access-token']).toBe('tok-123');
  });

  it('is "done" only after finish returns success — finish failure is reported (F5-FR6/AC6)', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', { status: 200 })
      .on(FINISH_PATH, { status: 200, json: { success: false, errorMsg: 'rejected' } });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toBe('rejected');
    }
  });

  it('routes an auth failure on apply to an auth DeliveryFailure (F5-FR4)', async () => {
    http.on(APPLY_PATH, { status: 200, json: { success: false, errorCode: 'E0401' } });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
      expect(result.error.errorCode).toBe('E0401');
    }
    // No PUT/finish attempted after the apply auth failure.
    expect(http.requests).toHaveLength(1);
  });

  it('routes a transport-401 on finish to an auth failure', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', { status: 200 })
      .on(FINISH_PATH, { status: 401, json: {} });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok && true).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
  });

  it('fails with protocol when apply returns no URL', async () => {
    http.on(APPLY_PATH, { status: 200, json: { success: true } });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toContain('no URL');
    }
  });

  it('fails when the S3 PUT returns a non-2xx status', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', { status: 403 });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toContain('403');
    }
  });

  it('omits S3 Authorization/date headers when apply does not return them', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', { status: 200 })
      .on(FINISH_PATH, { status: 200, json: { success: true } });
    await uploadToCloud(deps(http), input());
    const put = http.requests[1]!;
    expect(put.headers!.Authorization).toBeUndefined();
    expect(put.headers!['x-amz-date']).toBeUndefined();
  });

  it('D-3/I-2 destination audit: bytes go only to cloud.supernote.com + Ratta S3 (F5-FR5)', async () => {
    happyPath(http);
    await uploadToCloud(deps(http), input());
    for (const url of http.urls) {
      const host = new URL(url).host;
      const allowed = host === 'cloud.supernote.com' || host.endsWith('.amazonaws.com');
      expect(allowed, `unexpected destination: ${host}`).toBe(true);
    }
  });

  it('forwards the viewer profile headers (version/equipmentNo/channel) on apply/finish (R-8)', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', { status: 200 })
      .on(FINISH_PATH, { status: 200, json: { success: true } });
    const viewerDeps: PublicCloudDeps = {
      http,
      profile: {
        baseUrl: 'https://viewer.supernote.com',
        pathPrefix: '',
        headers: { version: '202407', equipmentNo: 'EQ-9', channel: 'web' },
        usesCodeEnvelope: false,
      },
      token: 'tok-v',
    };
    await uploadToCloud(viewerDeps, input());
    const applyHeaders = http.requests[0]!.headers!;
    expect(applyHeaders.version).toBe('202407');
    expect(applyHeaders.equipmentNo).toBe('EQ-9');
    expect(applyHeaders.channel).toBe('web');
  });
});

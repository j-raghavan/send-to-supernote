import { beforeEach, describe, expect, it } from 'vitest';
import {
  APPLY_PATH,
  FINISH_PATH,
  LIST_PATH,
  listCloudFolders,
  PublicCloudAdapter,
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

  it('surfaces the AWS error code from the S3 XML body on a failed PUT', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', {
        status: 403,
        bodyText:
          '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code>' +
          '<Message>The request signature we calculated does not match.</Message></Error>',
      });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toContain('403');
      expect(result.error.message).toContain('SignatureDoesNotMatch');
    }
  });

  it('attaches structured S3 detail (code + canonical request) for diagnostics', async () => {
    http
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', {
        status: 403,
        bodyText:
          '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code>' +
          '<Message>does not match</Message>' +
          '<CanonicalRequest>PUT\n/k\n\ncontent-type:application/pdf\nhost:s3\n\n' +
          'content-type;host\nUNSIGNED-PAYLOAD</CanonicalRequest></Error>',
      });
    const result = await uploadToCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.s3?.httpStatus).toBe(403);
      expect(result.error.s3?.code).toBe('SignatureDoesNotMatch');
      expect(result.error.s3?.signedHeaders).toBe('content-type;host');
      expect(result.error.s3?.canonicalRequest).toContain('content-type:application/pdf');
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

  it('D-3/I-2 destination audit: bytes go only to viewer.supernote.com + Ratta S3 (F5-FR5)', async () => {
    happyPath(http);
    await uploadToCloud(deps(http), input());
    for (const url of http.urls) {
      const host = new URL(url).host;
      const allowed = host === 'viewer.supernote.com' || host.endsWith('.amazonaws.com');
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

describe('listCloudFolders + PublicCloudAdapter (F5-FR3)', () => {
  it('lists a single page of normalized folders', async () => {
    const http = new FakeHttpClient().on(LIST_PATH, {
      status: 200,
      json: {
        success: true,
        total: 2,
        userFileVOList: [
          { id: '7', fileName: 'Document', isFolder: true },
          { id: '8', fileName: 'note.pdf', isFolder: false },
        ],
      },
    });
    const result = await listCloudFolders(deps(http), '0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: '7', name: 'Document', isFolder: true },
        { id: '8', name: 'note.pdf', isFolder: false },
      ]);
    }
    expect(http.requests).toHaveLength(1);
    expect((http.requests[0]!.body as Record<string, unknown>).pageNo).toBe(1);
  });

  it('paginates across pages until a short page is returned (F5-FR3 truncation)', async () => {
    const fullPage = Array.from({ length: 100 }, (_v, i) => ({
      id: String(i),
      fileName: `f${i}`,
      isFolder: false,
    }));
    let call = 0;
    const http = new FakeHttpClient().on(LIST_PATH, () => {
      call += 1;
      return call === 1
        ? { status: 200, json: { success: true, total: 150, userFileVOList: fullPage } }
        : {
            status: 200,
            json: { success: true, total: 150, userFileVOList: fullPage.slice(0, 50) },
          };
    });
    const result = await listCloudFolders(deps(http), '0');
    expect(result.ok && result.value).toHaveLength(150);
    expect(http.requests).toHaveLength(2);
    expect((http.requests[1]!.body as Record<string, unknown>).pageNo).toBe(2);
  });

  it('routes a list auth failure to an auth DeliveryFailure', async () => {
    const http = new FakeHttpClient().on(LIST_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401' },
    });
    const result = await listCloudFolders(deps(http), '0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
  });

  it('the adapter delegates uploadDocument, listFolders, and healthCheck', async () => {
    const http = new FakeHttpClient();
    happyPath(http);
    http.on(LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } });
    const adapter = new PublicCloudAdapter(deps(http));

    const up = await adapter.uploadDocument(input());
    expect(up.ok).toBe(true);

    const folders = await adapter.listFolders('0');
    expect(folders.ok && folders.value).toEqual([]);

    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
  });

  it('healthCheck surfaces a failure from the root list', async () => {
    const http = new FakeHttpClient().on(LIST_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401' },
    });
    const adapter = new PublicCloudAdapter(deps(http));
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
    if (!health.ok) {
      expect(health.error.kind).toBe('auth');
    }
  });
});

describe('listCloudFolders pagination stop conditions (F5-FR3)', () => {
  it('stops after a full page when total has been reached (no extra page)', () => {
    const fullPage = Array.from({ length: 100 }, (_v, i) => ({
      id: String(i),
      fileName: `f${i}`,
      isFolder: false,
    }));
    const http = new FakeHttpClient().on(LIST_PATH, {
      status: 200,
      json: { success: true, total: 100, userFileVOList: fullPage },
    });
    return listCloudFolders(deps(http), '0').then((result) => {
      expect(result.ok && result.value).toHaveLength(100);
      // Full page but total reached -> exactly one request, no page 2.
      expect(http.requests).toHaveLength(1);
    });
  });
});

describe('listCloudFolders without a total field (F5-FR3)', () => {
  it('stops on a short page when the response omits total', () => {
    const http = new FakeHttpClient().on(LIST_PATH, {
      status: 200,
      json: { success: true, userFileVOList: [{ id: '1', fileName: 'Document', isFolder: true }] },
    });
    return listCloudFolders(deps(http), '0').then((result) => {
      expect(result.ok && result.value).toHaveLength(1);
      expect(http.requests).toHaveLength(1);
    });
  });
});

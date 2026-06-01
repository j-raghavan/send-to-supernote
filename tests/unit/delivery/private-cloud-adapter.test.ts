import { beforeEach, describe, expect, it } from 'vitest';
import {
  PC_APPLY_PATH,
  PC_FINISH_PATH,
  PC_LIST_PATH,
  PrivateCloudAdapter,
  type PrivateCloudDeps,
  listPrivateCloudFolders,
  uploadToPrivateCloud,
} from '../../../src/delivery/private-cloud-adapter';
import { md5hexBytes } from '@shared/md5';
import type { UploadInput } from '../../../src/delivery/delivery-port';
import { FakeHttpClient } from '../../fakes/fake-http-client';
import { FakeRandomSource } from '../../fakes/fake-random-source';
import { FakeClock } from '../../fakes/fake-clock';

const BASE = 'http://192.168.1.5:8080';
const TS = 1717000000000;
const OSS_PATH = '/api/oss/upload';

function input(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    contentType: 'application/pdf',
    directoryId: '778507258773372928',
    fileName: 'My-Article.pdf',
    ...overrides,
  };
}

function deps(http: FakeHttpClient): PrivateCloudDeps {
  return {
    http,
    baseUrl: BASE,
    token: 'jwt-1',
    random: new FakeRandomSource(),
    clock: new FakeClock(TS),
  };
}

function happyPath(http: FakeHttpClient): void {
  http
    .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: OSS_PATH } })
    .on(OSS_PATH, { status: 200, json: { success: true } })
    .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
}

describe('uploadToPrivateCloud (F8-FR2)', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient();
  });

  it('runs apply -> multipart POST(applyUrl) -> finish and reports success', async () => {
    happyPath(http);
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
    expect(http.requests.map((r) => r.method)).toEqual(['POST', 'POST', 'POST']);
    expect(http.urls[0]).toBe(`${BASE}/api/file/upload/apply`);
    expect(http.urls[1]).toBe(`${BASE}${OSS_PATH}`);
    expect(http.urls[2]).toBe(`${BASE}/api/file/upload/finish`);
  });

  it('sends timestamp + nonce headers on apply (nonce = 10 digits + timestamp)', async () => {
    happyPath(http);
    await uploadToPrivateCloud(deps(http), input());
    const applyHeaders = http.requests[0]!.headers!;
    expect(applyHeaders.timestamp).toBe(String(TS));
    expect(applyHeaders.nonce).toBe(`1234567890${String(TS)}`);
    expect(applyHeaders['x-access-token']).toBe('jwt-1');
  });

  it('uploads the file as multipart/form-data to the apply-returned URL (not hardcoded)', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: '/api/custom/store' } })
      .on('/api/custom/store', { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    await uploadToPrivateCloud(deps(http), input());
    const upload = http.requests[1]!;
    expect(upload.url).toBe(`${BASE}/api/custom/store`);
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('accepts the apply URL under the `fullUploadUrl` field (preferred when present)', async () => {
    const full = `${BASE}/api/oss/upload?token=abc`;
    http
      .on(PC_APPLY_PATH, {
        status: 200,
        json: { success: true, fullUploadUrl: full, uploadUrl: OSS_PATH },
      })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
    // fullUploadUrl wins over uploadUrl; its path + query are used.
    expect(http.urls[1]).toBe(full);
  });

  it('echoes the apply-issued innerName at finish and returns it', async () => {
    http
      .on(PC_APPLY_PATH, {
        status: 200,
        json: { success: true, uploadUrl: OSS_PATH, innerName: 'srv-object-42.pdf' },
      })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.innerName).toBe('srv-object-42.pdf');
    }
    const finishBody = http.requests[2]!.body as Record<string, unknown>;
    expect(finishBody.innerName).toBe('srv-object-42.pdf');
  });

  it('sends innerName=fileName at finish when apply returns none', async () => {
    happyPath(http);
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.innerName).toBe('My-Article.pdf');
    }
    const finishBody = http.requests[2]!.body as Record<string, unknown>;
    expect(finishBody.innerName).toBe('My-Article.pdf');
  });

  it('accepts the apply URL under the `partUploadUrl` field as a last resort', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, partUploadUrl: OSS_PATH } })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
    expect(http.urls[1]).toBe(`${BASE}${OSS_PATH}`);
  });

  it('requests the folder list ordered by time descending (server pagination parity)', async () => {
    http.on(PC_LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } });
    await listPrivateCloudFolders(deps(http), '0');
    const listBody = http.requests[0]!.body as Record<string, unknown>;
    expect(listBody.order).toBe('time');
    expect(listBody.sequence).toBe('desc');
  });

  it('accepts the apply URL under the `url` field too', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, url: OSS_PATH } })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
  });

  it('handles an absolute apply upload URL on the configured host', async () => {
    const absolute = `${BASE}/api/oss/upload`;
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: absolute } })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    await uploadToPrivateCloud(deps(http), input());
    expect(http.urls[1]).toBe(absolute);
  });

  it('re-bases a foreign/internal host the apply response names onto the configured base (D-3)', async () => {
    // A reverse-proxied server can return an internal origin; the file POST (with
    // the JWT) must still go ONLY to the user-configured base, never that host.
    http
      .on(PC_APPLY_PATH, {
        status: 200,
        json: { success: true, fullUploadUrl: 'http://10.0.0.9:9000/api/oss/upload?sig=xyz' },
      })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    await uploadToPrivateCloud(deps(http), input());
    expect(http.urls[1]).toBe(`${BASE}/api/oss/upload?sig=xyz`);
    expect(new URL(http.urls[1]!).host).toBe('192.168.1.5:8080');
  });

  it('sends the correct hex md5 + size on apply and finish', async () => {
    happyPath(http);
    const bytes = new Uint8Array([9, 8, 7]);
    await uploadToPrivateCloud(deps(http), input({ bytes }));
    const applyBody = http.requests[0]!.body as Record<string, unknown>;
    const finishBody = http.requests[2]!.body as Record<string, unknown>;
    expect(applyBody.md5).toBe(md5hexBytes(bytes));
    expect(applyBody.size).toBe(3);
    expect(finishBody.fileSize).toBe(3);
  });

  it('is done only after finish success — finish failure is reported (I-3)', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: OSS_PATH } })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: false, errorMsg: 'no' } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
    }
  });

  it('normalizes a {code,data} apply envelope (PC envelope variance)', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { code: 0, data: { uploadUrl: OSS_PATH } } })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(true);
  });

  it('routes an E0401 apply failure to an auth DeliveryFailure (F8-FR6)', async () => {
    http.on(PC_APPLY_PATH, { status: 200, json: { success: false, errorCode: 'E0401' } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
  });

  it('classifies a thrown apply request as a connection failure, NOT auth (F8-FR6)', async () => {
    http.on(PC_APPLY_PATH, () => {
      throw new Error('network down');
    });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection');
      expect(result.error.message).toContain('reach your Private Cloud');
    }
  });

  it('an HTTPS send-time connection failure carries cert + http://<host>:19072 guidance (connect/send parity)', async () => {
    http.on(PC_APPLY_PATH, () => {
      throw new Error('TLS handshake failed');
    });
    const httpsDeps = { ...deps(http), baseUrl: 'https://nas.local:8443' };
    const result = await uploadToPrivateCloud(httpsDeps, input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection');
      expect(result.error.message.toLowerCase()).toContain('certificate');
      expect(result.error.message).toContain('http://nas.local:19072');
    }
  });

  it('classifies a thrown upload (oss) request as a connection failure', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: OSS_PATH } })
      .on(OSS_PATH, () => {
        throw new Error('TLS error');
      });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok && true).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection');
    }
  });

  it('classifies a thrown finish request as a connection failure', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: OSS_PATH } })
      .on(OSS_PATH, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, () => {
        throw new Error('dropped');
      });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection');
    }
  });

  it('fails with protocol when apply returns no upload URL', async () => {
    http.on(PC_APPLY_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toContain('no upload URL');
    }
  });

  it('fails with protocol (no upload attempted) when apply returns a non-http upload URL', async () => {
    http.on(PC_APPLY_PATH, {
      status: 200,
      json: { success: true, uploadUrl: 'javascript:alert(1)' },
    });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toContain('malformed upload URL');
    }
    // Only the apply request was made — the file POST was never attempted.
    expect(http.requests).toHaveLength(1);
  });

  it('fails when the multipart upload returns a non-2xx status', async () => {
    http
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: OSS_PATH } })
      .on(OSS_PATH, { status: 500, json: { success: false } });
    const result = await uploadToPrivateCloud(deps(http), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
    }
  });

  it('D-3 destination audit: bytes go ONLY to the configured base URL (F8-AC5)', async () => {
    happyPath(http);
    await uploadToPrivateCloud(deps(http), input());
    for (const url of http.urls) {
      expect(new URL(url).host).toBe('192.168.1.5:8080');
    }
  });
});

describe('listPrivateCloudFolders + PrivateCloudAdapter (F8-FR3)', () => {
  it('lists and normalizes "Y"/"N" isFolder', async () => {
    const http = new FakeHttpClient().on(PC_LIST_PATH, {
      status: 200,
      json: {
        code: 0,
        data: {
          total: 2,
          userFileVOList: [
            { id: '778507258773372928', fileName: 'Document', isFolder: 'Y' },
            { id: '999', fileName: 'note.pdf', isFolder: 'N' },
          ],
        },
      },
    });
    const result = await listPrivateCloudFolders(deps(http), '0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: '778507258773372928', name: 'Document', isFolder: true },
        { id: '999', name: 'note.pdf', isFolder: false },
      ]);
    }
  });

  it('paginates until a short page', async () => {
    const fullPage = Array.from({ length: 100 }, (_v, i) => ({
      id: String(i),
      fileName: `f${i}`,
      isFolder: 'N',
    }));
    let call = 0;
    const http = new FakeHttpClient().on(PC_LIST_PATH, () => {
      call += 1;
      return call === 1
        ? { status: 200, json: { success: true, total: 150, userFileVOList: fullPage } }
        : {
            status: 200,
            json: { success: true, total: 150, userFileVOList: fullPage.slice(0, 50) },
          };
    });
    const result = await listPrivateCloudFolders(deps(http), '0');
    expect(result.ok && result.value).toHaveLength(150);
    expect(http.requests).toHaveLength(2);
  });

  it('routes a list connection error to a connection failure', async () => {
    const http = new FakeHttpClient().on(PC_LIST_PATH, () => {
      throw new Error('unreachable');
    });
    const result = await listPrivateCloudFolders(deps(http), '0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection');
    }
  });

  it('routes a list auth failure to an auth failure', async () => {
    const http = new FakeHttpClient().on(PC_LIST_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401' },
    });
    const result = await listPrivateCloudFolders(deps(http), '0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
  });

  it('the adapter delegates uploadDocument, listFolders, and healthCheck', async () => {
    const http = new FakeHttpClient();
    happyPath(http);
    http.on(PC_LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } });
    const adapter = new PrivateCloudAdapter(deps(http));
    expect((await adapter.uploadDocument(input())).ok).toBe(true);
    expect((await adapter.listFolders('0')).ok).toBe(true);
    expect((await adapter.healthCheck()).ok).toBe(true);
  });

  it('healthCheck surfaces a failure from the root list', async () => {
    const http = new FakeHttpClient().on(PC_LIST_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401' },
    });
    const adapter = new PrivateCloudAdapter(deps(http));
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });
});

describe('private cloud upload-URL + list edge cases (F8-FR2/FR3)', () => {
  it('makes a relative apply URL without a leading slash absolute', async () => {
    const http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: 'api/oss/upload' } })
      .on('/api/oss/upload', { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    await uploadToPrivateCloud(deps(http), input());
    expect(http.urls[1]).toBe(`${BASE}/api/oss/upload`);
  });

  it('stops listing after a full page when total is reached (no extra page)', async () => {
    const fullPage = Array.from({ length: 100 }, (_v, i) => ({
      id: String(i),
      fileName: `f${i}`,
      isFolder: 'N',
    }));
    const http = new FakeHttpClient().on(PC_LIST_PATH, {
      status: 200,
      json: { success: true, total: 100, userFileVOList: fullPage },
    });
    const result = await listPrivateCloudFolders(deps(http), '0');
    expect(result.ok && result.value).toHaveLength(100);
    expect(http.requests).toHaveLength(1);
  });
});

describe('private cloud list without a total field (F8-FR3)', () => {
  it('stops on a short page when the response omits total', async () => {
    const http = new FakeHttpClient().on(PC_LIST_PATH, {
      status: 200,
      json: { success: true, userFileVOList: [{ id: '1', fileName: 'Document', isFolder: 'Y' }] },
    });
    const result = await listPrivateCloudFolders(deps(http), '0');
    expect(result.ok && result.value).toHaveLength(1);
    expect(http.requests).toHaveLength(1);
  });
});

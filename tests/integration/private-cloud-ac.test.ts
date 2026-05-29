/**
 * F8 Private Cloud delivery — AC-traceability flows (mocked HttpClient + fakes).
 *
 * The per-FR units cover the nonce/timestamp headers, the apply-returned upload
 * URL, "Y"/"N" normalization, the finish gate, and connection-vs-auth
 * classification. This file ties the behaviors to the Acceptance Criteria not
 * yet cited by id, and documents the engineer-flagged OSS-envelope deviation:
 *
 *  - F8-AC1: connect persists only a JWT (+ baseUrl + account), never the
 *            password; the connection identifies the configured base URL.
 *  - F8-AC2: apply(+nonce/ts) -> multipart POST to the apply-RETURNED url ->
 *            finish; nonce = {10 digits}{timestamp}; the POST follows a
 *            DIFFERENT returned url (proving it is not hardcoded /api/oss/upload).
 *  - F8-AC3: a public send fails (non-auth) and the SAME already-converted blob
 *            uploads to Private Cloud — no re-capture.
 *  - F8-AC4: disconnecting Private Cloud removes the JWT.
 *  - F8-AC5: every destination is ONLY the configured base URL (D-3/I-2).
 *  - F8-AC6: a non-HTTPS base URL shows the R-10 warning; an unreachable/typo
 *            server -> connection failure (JWT intact, NO auth re-prompt), while
 *            a 401/E0401 -> auth failure (token clear path).
 *
 * No real Supernote/private server is contacted.
 */
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PC_APPLY_PATH,
  PC_FINISH_PATH,
  uploadToPrivateCloud,
  type PrivateCloudDeps,
} from '@delivery/private-cloud-adapter';
import { resolveDelivery, type ResolveTargetConfig } from '@delivery/resolve-target';
import { APPLY_PATH } from '@delivery/public-cloud-adapter';
import { connectPrivateCloud, type ConnectPrivateCloudDeps } from '@auth/connect-private-cloud';
import { disconnectPrivateCloud } from '@auth/disconnect';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import { LOGIN_PATH, NONCE_PATH } from '@auth/login-routine';
import { validateBaseUrl, httpWarningFor } from '@domain/private-cloud-url';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { StorageKeys } from '@shared/storage-keys';
import type { UploadInput } from '@delivery/delivery-port';
import { FakeHttpClient } from '../fakes/fake-http-client';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeRandomSource } from '../fakes/fake-random-source';
import { FakeClock } from '../fakes/fake-clock';

const BASE = 'http://192.168.1.5:8080';
const TS = 1717000000000;
const RETURNED_URL = '/api/custom/store'; // deliberately NOT /api/oss/upload

async function sha256hex(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pcDeps(http: FakeHttpClient): PrivateCloudDeps {
  return {
    http,
    baseUrl: BASE,
    token: 'jwt-1',
    random: new FakeRandomSource(),
    clock: new FakeClock(TS),
  };
}

const blob = (overrides: Partial<UploadInput> = {}): UploadInput => ({
  bytes: new Uint8Array([10, 20, 30, 40]),
  contentType: 'application/pdf',
  directoryId: '778507258773372928',
  fileName: 'A-Web-Article.pdf',
  ...overrides,
});

describe('F8-AC1 — connect persists JWT-only, identifies the base URL', () => {
  it('persists JWT + baseUrl + account, never the password', async () => {
    const kv = new FakeKeyValueStore();
    const http = new FakeHttpClient()
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'jwt-xyz' } });
    const deps: ConnectPrivateCloudDeps = {
      http,
      sha256hex,
      store: kv,
    };

    const result = await connectPrivateCloud(deps, {
      baseUrl: BASE,
      account: 'me@x.com',
      password: 'PLAIN-SECRET',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.baseUrl).toBe(BASE); // "Connected to <baseUrl>"
    expect(await kv.get(StorageKeys.privateToken)).toBe('jwt-xyz');
    expect(await kv.get(StorageKeys.privateBaseUrl)).toBe(BASE);
    expect(await kv.get(StorageKeys.privateAccount)).toBe('me@x.com');
    // D-2: the password is nowhere in storage, nor on the wire.
    expect(kv.snapshot()).not.toContain('PLAIN-SECRET');
    expect(JSON.stringify(http.requests)).not.toContain('PLAIN-SECRET');
  });
});

describe('F8-AC2 — apply(+nonce/ts) → multipart POST to the apply-returned URL → finish', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient()
      // apply returns a NON-default upload URL — proving the POST is not hardcoded.
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
  });

  it('drives the multipart POST to the URL apply returned (not /api/oss/upload)', async () => {
    const result = await uploadToPrivateCloud(pcDeps(http), blob());

    expect(result.ok).toBe(true);
    expect(http.requests.map((r) => r.method)).toEqual(['POST', 'POST', 'POST']);
    // The upload went to the RETURNED url, not a hardcoded oss path.
    expect(http.urls[1]).toBe(`${BASE}${RETURNED_URL}`);
    expect(http.urls[1]).not.toContain('/api/oss/upload');
    const upload = http.requests[1]!;
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('sends nonce = {10 digits}{timestamp} and the timestamp header on apply', async () => {
    await uploadToPrivateCloud(pcDeps(http), blob());
    const applyHeaders = http.requests[0]!.headers!;
    expect(applyHeaders.timestamp).toBe(String(TS));
    expect(applyHeaders.nonce).toBe(`1234567890${String(TS)}`);
    expect(applyHeaders.nonce).toMatch(/^\d{10}\d+$/);
  });

  it('is done ONLY after finish success (apply+upload but failed finish → failed, I-3)', async () => {
    const failFinish = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: false, errorMsg: 'no' } });
    const result = await uploadToPrivateCloud(pcDeps(failFinish), blob());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('protocol'); // not done
  });
});

describe('F8-AC3 — public fail → same already-converted blob to Private Cloud (no re-capture)', () => {
  function config(http: FakeHttpClient): ResolveTargetConfig {
    return {
      http,
      random: new FakeRandomSource(),
      clock: new FakeClock(TS),
      cloud: { profile: DEFAULT_PUBLIC_PROFILE, token: 'cloud-tok' },
      privateCloud: { baseUrl: BASE, token: 'jwt' },
    };
  }

  it('reuses the identical UploadInput for the PC send after a non-auth public failure', async () => {
    const sameBlob = blob();
    const original = Uint8Array.from(sameBlob.bytes);

    // Public send fails for a non-auth reason.
    const cloudHttp = new FakeHttpClient().on(APPLY_PATH, {
      status: 200,
      json: { success: false, errorMsg: 'cloud endpoint changed' },
    });
    const cloudResult = await resolveDelivery('cloud', config(cloudHttp)).uploadDocument(sameBlob);
    expect(cloudResult.ok).toBe(false);

    // The SAME blob goes to Private Cloud — no re-render.
    const pcHttp = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const pcResult = await resolveDelivery('privatecloud', config(pcHttp)).uploadDocument(sameBlob);
    expect(pcResult.ok).toBe(true);
    expect(sameBlob.bytes).toEqual(original); // bytes never re-captured/mutated
  });
});

describe('F8-AC4 — disconnect removes the JWT', () => {
  it('removes the JWT (keeps baseUrl for re-connect prefill)', async () => {
    const kv = new FakeKeyValueStore();
    await kv.set(StorageKeys.privateToken, 'jwt');
    await kv.set(StorageKeys.privateBaseUrl, BASE);
    await kv.set(StorageKeys.privateAccount, 'me@x.com');

    await disconnectPrivateCloud({ store: kv });

    expect(await new PrivateCloudStore(kv).getToken()).toBeUndefined();
    // baseUrl is intentionally retained for the re-connect form (not a leak).
    expect(await kv.get(StorageKeys.privateBaseUrl)).toBe(BASE);
  });
});

describe('F8-AC5 — destinations are ONLY the configured base URL (D-3/I-2)', () => {
  it('apply, upload, and finish all hit only the user-configured host', async () => {
    const http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    await uploadToPrivateCloud(pcDeps(http), blob());
    for (const url of http.urls) {
      expect(new URL(url).host).toBe('192.168.1.5:8080');
    }
  });
});

describe('F8-AC6 — non-HTTPS warning + connection (not auth) for an unreachable server', () => {
  it('shows the R-10 warning for a plain-HTTP base URL, none for HTTPS', () => {
    const http = validateBaseUrl('http://192.168.1.5:8080');
    const https = validateBaseUrl('https://supernote.home.lan');
    expect(http.ok && httpWarningFor(http.value)).toContain('plain HTTP');
    expect(https.ok && httpWarningFor(https.value)).toBeUndefined();
  });

  it('an unreachable/typo server → connection failure (JWT intact, NO auth re-prompt)', async () => {
    const kv = new FakeKeyValueStore();
    await kv.set(StorageKeys.privateToken, 'jwt-keep');
    const store = new PrivateCloudStore(kv);
    const http = new FakeHttpClient().on(PC_APPLY_PATH, () => {
      throw new Error('getaddrinfo ENOTFOUND wrong-host');
    });

    const result = await uploadToPrivateCloud(pcDeps(http), blob());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection'); // NOT 'auth'
      expect(result.error.message).toContain('reach your Private Cloud');
    }
    // The JWT is LEFT INTACT — no token clear, no reconnect prompt (F8-FR6).
    expect(await store.getToken()).toBe('jwt-keep');
  });

  it('a 401/E0401 → auth failure (the token-clear path, distinct from connection)', async () => {
    const http = new FakeHttpClient().on(PC_APPLY_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401' },
    });
    const result = await uploadToPrivateCloud(pcDeps(http), blob());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('auth');
  });
});

describe('OSS-step envelope relax (F8-FR6) — raw byte transfer', () => {
  it('a bare-200 OSS response with NO JSON body now SUCCEEDS end-to-end (apply→OSS→finish→done)', async () => {
    // The OSS step is a raw byte transfer: success is HTTP 2xx, no envelope
    // required (a real server may return a bare 200). apply/finish stay strict;
    // integrity is guaranteed by the finish gate (I-3).
    const http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      // A bare 200 with NO json body on the OSS multipart step.
      .on(RETURNED_URL, { status: 200 })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });

    const result = await uploadToPrivateCloud(pcDeps(http), blob());

    expect(result.ok).toBe(true);
    // The finish step WAS reached and verified.
    expect(http.urls).toContain(`${BASE}/api/file/upload/finish`);
  });

  it('a bare-200 OSS WITH a success envelope still succeeds', async () => {
    const http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(pcDeps(http), blob());
    expect(result.ok).toBe(true);
  });

  it('negative control: a 2xx OSS with explicit {success:false} STILL fails', async () => {
    const http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: false, errorMsg: 'rejected' } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
    const result = await uploadToPrivateCloud(pcDeps(http), blob());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
    }
    // finish was NOT reached.
    expect(http.urls).not.toContain(`${BASE}/api/file/upload/finish`);
  });

  it('an explicit E0401 on the OSS step still routes to an auth failure', async () => {
    const http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: RETURNED_URL } })
      .on(RETURNED_URL, { status: 200, json: { success: false, errorCode: 'E0401' } });
    const result = await uploadToPrivateCloud(pcDeps(http), blob());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
  });
});

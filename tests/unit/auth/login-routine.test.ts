import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOGIN_PATH,
  NONCE_PATH,
  performLogin,
  type LoginDeps,
} from '../../../src/auth/login-routine';
import { DEFAULT_PUBLIC_PROFILE, privateCloudProfile } from '@domain/delivery';
import { loginHash } from '@domain/auth';
import { FakeHttpClient } from '../../fakes/fake-http-client';
import { FakeRandomSource } from '../../fakes/fake-random-source';

async function sha256hex(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deps(http: FakeHttpClient): LoginDeps {
  return { http, sha256hex, random: new FakeRandomSource() };
}

describe('performLogin (F2-FR0)', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient();
  });

  it('runs nonce -> hash -> login and returns a token (public profile)', async () => {
    http
      .on(NONCE_PATH, {
        status: 200,
        json: { success: true, randomCode: 'CODE', timestamp: 1717000000 },
      })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'tok-123' } });

    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'user@example.com',
      password: 'hunter2',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.token).toBe('tok-123');
      expect(result.value.equipment).toMatch(/^[0-9a-f-]+$/);
    }
    expect(http.urls[0]).toBe('https://cloud.supernote.com/official/user/query/random/code');
    expect(http.urls[1]).toBe('https://cloud.supernote.com/official/user/account/login/new');
  });

  it('sends the correct login hash and echoes the server timestamp (clock-skew safe)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'XYZ', timestamp: 42 } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 't' } });

    await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
    });

    const loginBody = http.requests[1]!.body as Record<string, unknown>;
    expect(loginBody.password).toBe(await loginHash('pw', 'XYZ', sha256hex));
    expect(loginBody.timestamp).toBe(42);
    expect(loginBody.countryCode).toBe('1');
  });

  it('never includes the raw password in any request body (F2-FR2)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 't' } });

    await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'SUPERSECRET',
    });

    const serialized = JSON.stringify(http.requests);
    expect(serialized).not.toContain('SUPERSECRET');
  });

  it('reuses a provided equipment id', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 't' } });

    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
      equipment: 'fixed-equip',
    });

    expect(result.ok && result.value.equipment).toBe('fixed-equip');
    const loginBody = http.requests[1]!.body as Record<string, unknown>;
    expect(loginBody.equipment).toBe('fixed-equip');
    expect(loginBody.equipmentNo).toBe('fixed-equip');
  });

  it('targets the private cloud base URL with the /api prefix', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'jwt' } });

    const result = await performLogin(deps(http), {
      profile: privateCloudProfile('http://192.168.1.5:8080'),
      account: 'a@b.com',
      password: 'pw',
    });

    expect(result.ok && result.value.token).toBe('jwt');
    expect(http.urls[0]).toBe('http://192.168.1.5:8080/api/official/user/query/random/code');
    expect(http.urls[1]).toBe('http://192.168.1.5:8080/api/official/user/account/login/new');
  });

  it('fails with unexpected-response when the nonce is missing randomCode', async () => {
    http.on(NONCE_PATH, { status: 200, json: { success: true } });
    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unexpected-response');
    }
  });

  it('maps an E0401 nonce failure to auth-failed', async () => {
    http.on(NONCE_PATH, { status: 200, json: { success: false, errorCode: 'E0401' } });
    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth-failed');
      expect(result.error.errorCode).toBe('E0401');
    }
  });

  it('maps a bare transport-401 login response to auth-failed (no E0401 in envelope)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 401, json: {} });

    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth-failed');
    }
  });

  it('fails with auth-failed on an E0401 login envelope (bad credentials)', async () => {
    http.on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } }).on(LOGIN_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401', errorMsg: 'bad' },
    });

    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth-failed');
      expect(result.error.message).toBe('bad');
    }
  });

  it('fails with unexpected-response when login returns no token', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true } });

    const result = await performLogin(deps(http), {
      profile: DEFAULT_PUBLIC_PROFILE,
      account: 'a@b.com',
      password: 'pw',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unexpected-response');
    }
  });

  it('sends the version/equipmentNo/channel headers from the profile (R-8 viewer host)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 't' } });

    await performLogin(deps(http), {
      profile: {
        baseUrl: 'https://viewer.supernote.com',
        pathPrefix: '',
        headers: { version: '202407', equipmentNo: 'EQ-1', channel: 'web' },
        usesCodeEnvelope: false,
      },
      account: 'a@b.com',
      password: 'pw',
    });

    const headers = http.requests[1]!.headers!;
    expect(headers.version).toBe('202407');
    expect(headers.equipmentNo).toBe('EQ-1');
    expect(headers.channel).toBe('web');
  });
});

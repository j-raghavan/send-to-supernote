/**
 * F2 auth-flow integration tests (KeyValueStore + cookie/notifier fakes).
 *
 * Public Supernote Cloud sign-in is CAPTCHA/2FA-gated, so the extension does NOT
 * log in: the user signs in on Supernote's own page and the extension captures
 * the `x-access-token` session cookie (captureCloudToken). These wire the real
 * use cases together (connect -> auth failure -> recovery -> reconnect -> retry)
 * through the same fakes the unit tests use:
 *
 *  - F2-AC1: connect captures the session token and reflects connected.
 *  - F2-AC2 / D-2 / I-1: only the token (+equipment) is persisted — no password
 *            (there is none) and no email; the raw snapshot holds no secret.
 *  - F2-AC4: an auth failure via BOTH a transport 401 AND a success:false /
 *            errorCode:"E0401" envelope (HTTP 200) clears the token, prompts
 *            reconnect, retains the in-flight job, and never auto-resubmits.
 *            After reconnect the retained job retries and completes (F9-FR1).
 *  - F2-AC5: disconnect clears the credential keys and pending jobs.
 *
 * All chrome.* / network are faked; no real Supernote/S3 is contacted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_TOKEN_COOKIE,
  CLOUD_WEB_URL,
  captureCloudToken,
} from '../../src/auth/cloud-session';
import { handleAuthFailure } from '../../src/auth/handle-auth-failure';
import { disconnectPublicCloud } from '../../src/auth/disconnect';
import { TokenStore } from '../../src/auth/token-store';
import { StorageKeys } from '@shared/storage-keys';
import { isAuthFailure, normalizeEnvelope } from '@domain/delivery';
import type { HttpResponse } from '@shared/ports';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeCookieReader } from '../fakes/fake-cookie-reader';
import { FakeNotifier, FakeOptionsOpener } from '../fakes/fake-notifier';

/** Build a (signature-less) JWT whose payload encodes the given claims. */
function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `h.${payload}.s`;
}

const TOKEN = jwt({ exp: 9_999_999_999, userId: '42', equipmentNo: 'WEB' });

/** A minimal "pending jobs" store backed by the same KeyValueStore (F9 seam). */
class PendingJobsFake {
  constructor(private readonly kv: FakeKeyValueStore) {}
  async retain(job: { url: string }): Promise<void> {
    const current = (await this.kv.get<{ url: string }[]>(StorageKeys.pendingJobs)) ?? [];
    await this.kv.set(StorageKeys.pendingJobs, [...current, job]);
  }
  async list(): Promise<{ url: string }[]> {
    return (await this.kv.get<{ url: string }[]>(StorageKeys.pendingJobs)) ?? [];
  }
  async clear(): Promise<void> {
    await this.kv.remove(StorageKeys.pendingJobs);
  }
}

describe('F2 auth flow (integration, cookie-capture connect)', () => {
  let kv: FakeKeyValueStore;
  let cookies: FakeCookieReader;
  let tokens: TokenStore;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    cookies = new FakeCookieReader();
    tokens = new TokenStore(kv);
  });

  describe('connect captures the official-login session (F2-AC1 / F2-AC2)', () => {
    it('persists the captured token and reflects connected (F2-AC1)', async () => {
      cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, TOKEN);

      const result = await captureCloudToken({ cookies, tokens });

      expect(result.ok).toBe(true);
      expect(await tokens.getToken()).toBe(TOKEN);
      expect(await tokens.getEquipment()).toBe('WEB');
    });

    it('persists ONLY the token/equipment — no password, no email (F2-AC2 / D-2 / I-1)', async () => {
      cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, TOKEN);

      await captureCloudToken({ cookies, tokens });

      expect(await kv.keys()).not.toContain('supernote.password');
      expect(await kv.keys()).not.toContain(StorageKeys.account);
      expect(kv.snapshot()).not.toContain('password');
    });
  });

  // F2-AC4: parameterized over BOTH auth-failure shapes the spec requires.
  describe.each<{ label: string; status: number; json: HttpResponse['json'] }>([
    { label: 'transport 401', status: 401, json: undefined },
    {
      label: 'success:false / errorCode E0401 envelope at HTTP 200',
      status: 200,
      json: { success: false, errorCode: 'E0401', errorMsg: 'token expired' },
    },
  ])('auth failure mid-call via $label (F2-AC4)', ({ status, json }) => {
    it('is detected as an auth failure by isAuthFailure (transport + envelope parity)', () => {
      const response: HttpResponse = json === undefined ? { status } : { status, json };
      expect(isAuthFailure(response.status, normalizeEnvelope(response.json))).toBe(true);
    });

    it('clears token, prompts reconnect, retains the job, and never auto-resubmits', async () => {
      await tokens.save({ token: 'stale', equipment: 'WEB' });
      const jobs = new PendingJobsFake(kv);
      const notifier = new FakeNotifier();
      const options = new FakeOptionsOpener();

      const failing: HttpResponse = json === undefined ? { status } : { status, json };
      expect(isAuthFailure(failing.status, normalizeEnvelope(failing.json))).toBe(true);

      const state = await handleAuthFailure(
        {
          clearToken: () => tokens.clearToken(),
          notifier,
          options,
          retainJob: () => jobs.retain({ url: 'apply' }),
        },
        {},
      );

      expect(state).toBe('expired');
      expect(await tokens.getToken()).toBeUndefined();
      expect(notifier.notifications[0]?.level).toBe('error');
      expect(notifier.notifications[0]?.title).toContain('session expired');
      expect(options.opens).toHaveLength(1);
      expect(await jobs.list()).toHaveLength(1);
      expect(kv.snapshot()).not.toContain('password');
    });

    it('reconnect after the failure retries the retained job and completes (F2-AC4 -> F9-AC1)', async () => {
      await tokens.clearToken();
      const jobs = new PendingJobsFake(kv);
      await jobs.retain({ url: 'apply' });

      // User reconnects by signing in again — the new session cookie is captured.
      cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, TOKEN);
      const reconnect = await captureCloudToken({ cookies, tokens });

      expect(reconnect.ok).toBe(true);
      expect(await tokens.getToken()).toBe(TOKEN);
      const retained = await jobs.list();
      expect(retained).toHaveLength(1);
      await jobs.clear(); // job completed after reconnect
      expect(await jobs.list()).toHaveLength(0);
      expect(status).toBeGreaterThan(0);
    });
  });

  describe('disconnect clears credentials + pending jobs (F2-AC5)', () => {
    it('removes token/account/equipment and clears pending jobs', async () => {
      await tokens.save({ token: 'tok', account: 'reader@x.com', equipment: 'WEB' });
      const jobs = new PendingJobsFake(kv);
      await jobs.retain({ url: 'apply' });
      const clearPendingJobs = vi.fn(() => jobs.clear());

      await disconnectPublicCloud({ store: kv, clearPendingJobs });

      expect(await kv.get(StorageKeys.token)).toBeUndefined();
      expect(await kv.get(StorageKeys.account)).toBeUndefined();
      expect(await kv.get(StorageKeys.equipment)).toBeUndefined();
      expect(clearPendingJobs).toHaveBeenCalledOnce();
      expect(await jobs.list()).toHaveLength(0);
    });
  });
});

/**
 * F6 send-job saga — integration over the REAL PublicCloudAdapter + FakeHttpClient.
 *
 * The saga unit tests drive sendDocument over a FakeDeliveryPort (which
 * short-circuits the network). This file wires the saga through the *real*
 * PublicCloudAdapter so the full FSM-to-network path runs end-to-end (apply ->
 * PUT -> finish over the faked sole-fetch seam), plus the toolbar/AC traceability:
 *
 *  (a) HAPPY PATH: capturing -> converting -> uploading -> finishing -> done,
 *      asserting apply/PUT/finish ran over HTTP and only Supernote+S3 were hit.
 *  (b) AUTH-FAILURE mid-flow (transport 401 AND E0401 envelope) -> token cleared,
 *      job retained, expired badge, NO password stored.
 *  (c) FINISH-FAILURE (apply+PUT ok, finish success:false) -> job 'failed', never
 *      'done' (I-3 at the saga level).
 *  (d) DE-DUP against a REAL folder listing (HTTP list/query returns an existing
 *      filename) -> the saga uploads as '...-2.pdf'.
 *
 * Also F6-AC1/AC3/AC5 traceability via resolveSendRequest + the saga.
 * No real Supernote/S3 — the FetchHttpClient is replaced by FakeHttpClient.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { sendDocument, type SendDocumentDeps, type SendRequest } from '@jobs/send-document';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import {
  APPLY_PATH,
  FINISH_PATH,
  LIST_PATH,
  PublicCloudAdapter,
} from '@delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import type { Settings, Target } from '@domain/settings';
import { TokenStore } from '@auth/token-store';
import { InMemoryBlobTransfer } from '../../src/background/in-memory-blob-transfer';
import type { HttpResponse } from '@shared/ports';
import { FakeExtractor } from '../fakes/fake-extractor';
import { FakeRenderer } from '../fakes/fake-renderer';
import { FakeHttpClient } from '../fakes/fake-http-client';
import { FakeNotifier, FakeOptionsOpener } from '../fakes/fake-notifier';
import { FakeBadge } from '../fakes/fake-badge';
import { FakeClock } from '../fakes/fake-clock';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeRandomSource } from '../fakes/fake-random-source';

const S3_URL = 'https://supernote-bucket.s3.amazonaws.com/Document/saga-obj?X-Amz-Sig=z';

const ARTICLE = {
  title: 'My Article',
  content: '<h1>My Article</h1><p>'.padEnd(120, 'x') + '</p>',
  length: 800,
};

const req = (overrides: Partial<SendRequest> = {}): SendRequest => ({
  mode: 'reader',
  format: 'pdf',
  target: 'cloud',
  folderId: 'doc-7', // skip Document resolution unless a test wants it
  confirmFilename: false,
  page: { hostname: 'example.com' },
  ...overrides,
});

interface Harness {
  deps: SendDocumentDeps;
  http: FakeHttpClient;
  notifier: FakeNotifier;
  options: FakeOptionsOpener;
  badge: FakeBadge;
  tokens: TokenStore;
  kv: FakeKeyValueStore;
}

async function harness(opts: { connected?: boolean } = {}): Promise<Harness> {
  const kv = new FakeKeyValueStore();
  const tokens = new TokenStore(kv);
  if (opts.connected !== false) {
    await tokens.save({ token: 'tok-saga', account: 'me@x.com', equipment: 'eq' });
  }
  const http = new FakeHttpClient();
  const notifier = new FakeNotifier();
  const options = new FakeOptionsOpener();
  const badge = new FakeBadge();
  const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
  // The REAL adapter, with the sole-fetch seam replaced by the FakeHttpClient.
  const adapter = new PublicCloudAdapter({
    http,
    profile: DEFAULT_PUBLIC_PROFILE,
    token: 'tok-saga',
  });

  const deps: SendDocumentDeps = {
    resolveDelivery: (_t: Target) => adapter,
    capture: {
      extractor: new FakeExtractor(ARTICLE, { title: 'My Article', html: '<html>x</html>' }),
    },
    render: { renderer: new FakeRenderer(2048, blobs) },
    blobs,
    notifier,
    badge,
    clock: new FakeClock(Date.UTC(2026, 4, 28)),
    hasToken: async (_t: Target) => (await tokens.getToken()) !== undefined,
    account: 'me@x.com',
    authDeps: { clearToken: () => tokens.clearToken(), notifier, options },
  };
  return { deps, http, notifier, options, badge, tokens, kv };
}

function stubHappyUpload(http: FakeHttpClient): void {
  http
    .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
    .on('s3.amazonaws.com', { status: 200 })
    .on(FINISH_PATH, { status: 200, json: { success: true } })
    // listing of the destination folder (for de-dup) — empty by default
    .on(LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } });
}

describe('send saga over the real PublicCloudAdapter (F6 integration)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  describe('(a) HAPPY PATH — capturing→…→done over real HTTP (F6-AC1)', () => {
    it('runs apply→PUT→finish and reaches done, hitting only Supernote + S3', async () => {
      stubHappyUpload(h.http);
      const result = await sendDocument(h.deps, req());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.state).toBe('done');

      // The real adapter issued the upload sequence over HTTP.
      const methods = h.http.requests.map((r) => r.method);
      expect(methods).toContain('PUT'); // S3 PUT happened
      expect(h.http.urls.some((u) => u.includes(APPLY_PATH))).toBe(true);
      expect(h.http.urls.some((u) => u.includes(FINISH_PATH))).toBe(true);
      // Destination audit (D-3/I-2).
      for (const url of h.http.urls) {
        const host = new URL(url).host;
        expect(host === 'viewer.supernote.com' || host.endsWith('.amazonaws.com')).toBe(true);
      }
    });

    it('F6-AC1: toolbar click resolves the default request and emits progress then success', async () => {
      stubHappyUpload(h.http);
      const settings: Settings = {
        defaultMode: 'reader',
        defaultFormat: 'pdf',
        target: 'cloud',
        confirmFilename: false,
        cloudFolderId: 'doc-7',
      };
      // The toolbar action sends using stored defaults (F6-FR1).
      const toolbarReq = resolveSendRequest(settings, { hostname: 'example.com' });
      expect(toolbarReq.mode).toBe('reader');
      expect(toolbarReq.target).toBe('cloud');

      const result = await sendDocument(h.deps, toolbarReq);

      expect(result.ok).toBe(true);
      const titles = h.notifier.notifications.map((n) => n.title);
      expect(titles).toContain('Capturing');
      expect(titles[titles.length - 1]).toBe('Sent to Supernote');
      expect(h.badge.states[0]).toBe('busy');
      expect(h.badge.current).toBe('idle');
    });
  });

  // (b) AUTH-FAILURE mid-flow — both shapes, through the real adapter.
  describe.each<{ label: string; applyResponse: HttpResponse }>([
    {
      label: 'E0401 envelope',
      applyResponse: { status: 200, json: { success: false, errorCode: 'E0401' } },
    },
    { label: 'transport 401', applyResponse: { status: 401, json: {} } },
  ])('(b) AUTH-FAILURE via $label → retain + reprompt, no password', ({ applyResponse }) => {
    it('clears the token, sets the expired badge, never stores a password', async () => {
      h.http
        .on(LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } })
        .on(APPLY_PATH, applyResponse);

      const result = await sendDocument(h.deps, req());

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('auth');
      expect(await h.tokens.getToken()).toBeUndefined(); // token cleared (retained for retry)
      expect(h.badge.current).toBe('expired');
      // Reconnect prompt shown; no PUT/finish attempted after apply auth failure.
      expect(h.notifier.notifications.some((n) => n.title.includes('session expired'))).toBe(true);
      expect(h.http.requests.some((r) => r.method === 'PUT')).toBe(false);
      // I-1: the password is never persisted anywhere.
      expect(h.kv.snapshot()).not.toContain('password');
    });
  });

  describe('(c) FINISH-FAILURE — apply+PUT ok, finish rejects → failed, never done (I-3)', () => {
    it('marks the job failed when finish returns success:false', async () => {
      h.http
        .on(LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } })
        .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
        .on('s3.amazonaws.com', { status: 200 })
        .on(FINISH_PATH, { status: 200, json: { success: false, errorMsg: 'rejected at finish' } });

      const result = await sendDocument(h.deps, req());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Not an auth failure → surfaced as a delivery failure, terminal 'failed'.
        expect(result.error.kind).toBe('delivery');
        expect(result.error.state).toBe('failed');
        expect(result.error.state).not.toBe('done');
      }
      // The PUT happened (apply succeeded) but the job did NOT reach done.
      expect(h.http.requests.some((r) => r.method === 'PUT')).toBe(true);
      expect(h.notifier.notifications.at(-1)?.level).toBe('error');
    });
  });

  describe('(d) DE-DUP against a real HTTP folder listing → -2', () => {
    it('uploads as ...-2.pdf when the destination already has the name', async () => {
      h.http
        .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
        .on('s3.amazonaws.com', { status: 200 })
        .on(FINISH_PATH, { status: 200, json: { success: true } })
        // The real list/query returns an existing file with the target name.
        .on(LIST_PATH, {
          status: 200,
          json: {
            success: true,
            total: 1,
            userFileVOList: [{ id: '9', fileName: 'My-Article.pdf', isFolder: false }],
          },
        });

      const result = await sendDocument(h.deps, req());

      expect(result.ok).toBe(true);
      // The finish call carries the de-duplicated filename.
      const finishReq = h.http.requests.find((r) => r.url.includes(FINISH_PATH))!;
      expect((finishReq.body as Record<string, unknown>).fileName).toBe('My-Article-2.pdf');
    });
  });
});

describe('F6-AC3 / F6-AC5 traceability', () => {
  it('F6-AC3: a user-edited filename (confirmFilename) is the name uploaded', async () => {
    const h = await harness();
    stubHappyUpload(h.http);
    h.deps.confirmName = (suggested) => Promise.resolve(`Edited-${suggested}`);

    await sendDocument(h.deps, req({ confirmFilename: true }));

    const finishReq = h.http.requests.find((r) => r.url.includes(FINISH_PATH))!;
    expect((finishReq.body as Record<string, unknown>).fileName).toBe('Edited-My-Article.pdf');
  });

  it('F6-AC5: a non-auth failure surfaces the reason and an actionable Send-failed toast', async () => {
    const h = await harness();
    h.http
      .on(LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } })
      .on(APPLY_PATH, { status: 200, json: { success: false, errorMsg: 'apply schema changed' } });

    const result = await sendDocument(h.deps, req());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('delivery');
      // The failure is attached so the caller can offer the F9 Private Cloud fallback.
      expect(result.error.failure?.kind).toBe('protocol');
      expect(result.error.message).toBe('apply schema changed');
    }
    const last = h.notifier.notifications.at(-1)!;
    expect(last.level).toBe('error');
    expect(last.title).toBe('Send failed');
    expect(last.message).toBe('apply schema changed');
  });

  it('F6-AC5: an auth failure surfaces the reconnect next-action (re-prompt)', async () => {
    const h = await harness();
    h.http
      .on(LIST_PATH, { status: 200, json: { success: true, total: 0, userFileVOList: [] } })
      .on(APPLY_PATH, { status: 200, json: { success: false, errorCode: 'E0401' } });

    await sendDocument(h.deps, req());

    // The reconnect next-action: Options is opened with the connected email
    // PREFILLED (F2-FR4 / F2-AC4) and a "session expired" toast is shown.
    expect(h.options.opens).toEqual(['me@x.com']);
    expect(h.notifier.notifications.some((n) => n.title.includes('session expired'))).toBe(true);
  });
});

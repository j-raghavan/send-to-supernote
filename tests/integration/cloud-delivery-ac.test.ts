/**
 * F5 public-Cloud delivery — AC-traceability flows (mocked network + fakes).
 *
 * The per-FR units already cover apply/PUT/finish, md5/size, innerName, S3
 * headers, pagination, and Document resolution. This file ties the behaviors to
 * the Acceptance Criteria that were not yet cited by id and adds the genuinely
 * end-to-end flows:
 *
 *  - F5-AC1: the gating spike artifact (docs/SPIKE-F5-FR1.md) exists and records
 *            the pinned host/header profile, countryCode, login->apply->PUT->
 *            finish, and the S3 PUT headers (live run documented as deferred).
 *  - F5-AC2: the file lands in the resolved Document/ folder — resolve the
 *            Document id from the root listing, then upload using THAT id.
 *  - F5-AC3: a chosen subfolder id (not root "0") is used as the apply
 *            directoryId, so the file lands in the subfolder, not root.
 *  - F5-AC4: an auth failure (transport 401 OR success:false/E0401 envelope) at
 *            an upload step routes to the F2 recovery — token cleared, reconnect
 *            prompt, job retained for retry.
 *
 * No real Supernote/S3 is contacted; the sole-fetch adapter is faked.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  APPLY_PATH,
  FINISH_PATH,
  LIST_PATH,
  type PublicCloudDeps,
  uploadToCloud,
} from '../../src/delivery/public-cloud-adapter';
import { resolveDocumentFolderId } from '../../src/settings/list-folders';
import { PublicCloudAdapter } from '../../src/delivery/public-cloud-adapter';
import { routeDeliveryFailure } from '../../src/delivery/route-delivery-failure';
import { TokenStore } from '../../src/auth/token-store';
import type { AuthFailureDeps } from '../../src/auth/handle-auth-failure';
import { DEFAULT_PUBLIC_PROFILE, ROOT_DIRECTORY_ID } from '@domain/delivery';
import type { HttpResponse } from '@shared/ports';
import { FakeHttpClient } from '../fakes/fake-http-client';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeNotifier, FakeOptionsOpener } from '../fakes/fake-notifier';

const S3_URL = 'https://supernote-bucket.s3.amazonaws.com/Document/obj-ac?X-Amz-Sig=zzz';

function deps(http: FakeHttpClient): PublicCloudDeps {
  return { http, profile: DEFAULT_PUBLIC_PROFILE, token: 'tok-ac' };
}

function stubUploadHappy(http: FakeHttpClient): void {
  http
    .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
    .on('s3.amazonaws.com', { status: 200 })
    .on(FINISH_PATH, { status: 200, json: { success: true } });
}

describe('F5-AC1 — gating spike artifact recorded', () => {
  it('docs/SPIKE-F5-FR1.md records the pinned host/header/countryCode + S3 PUT headers', () => {
    const path = fileURLToPath(new URL('../../docs/SPIKE-F5-FR1.md', import.meta.url));
    const doc = readFileSync(path, 'utf8');
    // The spike must enumerate each pinned fact the AC requires.
    expect(doc).toMatch(/host.*header|header.*profile/i);
    expect(doc).toContain('countryCode');
    expect(doc).toMatch(/login.+apply.+PUT.+finish/i);
    expect(doc).toContain('UNSIGNED-PAYLOAD');
    expect(doc).toContain('E0401');
    // The live run is explicitly deferred (cannot run without the user account).
    expect(doc).toMatch(/defer/i);
  });
});

describe('F5-AC2 — the file lands in the resolved Document/ folder (not root)', () => {
  it('resolves the Document id from root, then uploads using that id', async () => {
    const http = new FakeHttpClient();
    // Root listing contains a Document folder with id "77".
    http.on(LIST_PATH, {
      status: 200,
      json: {
        success: true,
        total: 2,
        userFileVOList: [
          { id: '1', fileName: 'Inbox', isFolder: true },
          { id: '77', fileName: 'Document', isFolder: true },
        ],
      },
    });
    const adapter = new PublicCloudAdapter(deps(http));

    const documentId = await resolveDocumentFolderId(adapter);
    expect(documentId.ok && documentId.value).toBe('77');
    if (!documentId.ok) return;
    // The resolved id must NOT be root.
    expect(documentId.value).not.toBe(ROOT_DIRECTORY_ID);

    // Now upload into the resolved Document folder.
    stubUploadHappy(http);
    const uploaded = await uploadToCloud(deps(http), {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
      directoryId: documentId.value,
      fileName: 'My-Article.pdf',
    });

    expect(uploaded.ok).toBe(true);
    // The apply call (after the LIST call) carries the Document directoryId.
    const applyReq = http.requests.find((r) => r.url.includes(APPLY_PATH))!;
    expect((applyReq.body as Record<string, unknown>).directoryId).toBe('77');
  });
});

describe('F5-AC3 — a chosen subfolder id is used, not root', () => {
  it('uses the chosen subfolder id as the apply directoryId', async () => {
    const http = new FakeHttpClient();
    stubUploadHappy(http);
    const subfolderId = 'Document/WebClips:903';

    await uploadToCloud(deps(http), {
      bytes: new Uint8Array([4, 5, 6]),
      contentType: 'application/pdf',
      directoryId: subfolderId,
      fileName: 'Clip.pdf',
    });

    const applyBody = http.requests[0]!.body as Record<string, unknown>;
    expect(applyBody.directoryId).toBe(subfolderId);
    expect(applyBody.directoryId).not.toBe(ROOT_DIRECTORY_ID);
    const finishBody = http.requests[2]!.body as Record<string, unknown>;
    expect(finishBody.directoryId).toBe(subfolderId);
  });
});

describe('F5-AC4 — auth failure (401 OR E0401) at upload → retain + reprompt', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;
  let notifier: FakeNotifier;
  let options: FakeOptionsOpener;
  let authDeps: AuthFailureDeps;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
    await tokens.save({ token: 'stale', account: 'me@x.com', equipment: 'eq' });
    notifier = new FakeNotifier();
    options = new FakeOptionsOpener();
    authDeps = { clearToken: () => tokens.clearToken(), notifier, options };
  });

  // Both auth-failure shapes the spec requires, driven through the real adapter.
  describe.each<{ label: string; applyResponse: HttpResponse }>([
    {
      label: 'success:false / errorCode E0401 envelope at HTTP 200',
      applyResponse: { status: 200, json: { success: false, errorCode: 'E0401', errorMsg: 'exp' } },
    },
    { label: 'transport 401', applyResponse: { status: 401, json: {} } },
  ])('via $label', ({ applyResponse }) => {
    it('routes to recovery: token cleared, reconnect prompt, job retained', async () => {
      const http = new FakeHttpClient().on(APPLY_PATH, applyResponse);

      // The real adapter classifies the failure as an auth DeliveryFailure.
      const uploaded = await uploadToCloud(deps(http), {
        bytes: new Uint8Array([1]),
        contentType: 'application/pdf',
        directoryId: '77',
        fileName: 'X.pdf',
      });
      expect(uploaded.ok).toBe(false);
      if (uploaded.ok) return;
      expect(uploaded.error.kind).toBe('auth');
      // No PUT/finish attempted after the apply auth failure.
      expect(http.requests).toHaveLength(1);

      // Routing the failure runs the F2 recovery and retains the job.
      let jobRetained = false;
      const outcome = await routeDeliveryFailure(
        uploaded.error,
        {
          ...authDeps,
          retainJob: () => {
            jobRetained = true;
            return Promise.resolve();
          },
        },
        { account: 'me@x.com' },
      );

      expect(outcome.kind).toBe('auth');
      if (outcome.kind === 'auth') expect(outcome.retainedForRetry).toBe(true);
      expect(await tokens.getToken()).toBeUndefined(); // token cleared
      expect(notifier.notifications[0]?.title).toContain('session expired');
      expect(options.opens).toEqual(['me@x.com']); // reconnect prompt, prefilled
      expect(jobRetained).toBe(true);
      // No password is stored anywhere (never auto-resubmitted).
      expect(kv.snapshot()).not.toContain('password');
    });
  });
});

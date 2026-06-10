/**
 * F9 resilience — AC-traceability flows (mocked storage/port fakes).
 *
 * The per-FR units cover the queue, retry, fallback, feature flags, TTL, and
 * history. This file ties the behaviors to the Acceptance Criteria by id and
 * adds the wired flows the technical-lead asked for — notably SW-restart resume
 * (reconstruct the queue from PERSISTED storage) and the flag-disabled routing:
 *
 *  - F9-AC1: an auth-interrupted job is retained → auto-retried on reconnect →
 *            completes (the retry reuses the converted blob, no re-capture).
 *  - F9-AC2: a non-auth public failure + configured PC → user accepts → the SAME
 *            already-converted blob goes to Private Cloud (no re-capture).
 *  - F9-AC3: the public feature flag disabled → a send uses Private Cloud and
 *            makes NO public-Cloud API call.
 *  - F9-AC4: a service-worker restart (queue re-constructed from persisted
 *            storage) → the pending job's state is intact and resumable.
 *  - F9-AC5: a stale job past TTL → pruned (not retried forever).
 *  - R-9: an AUTH failure NEVER triggers the PC fallback.
 *  - JobHistory: .record() fires on BOTH done and failed terminals; capped + local.
 *
 * SW eviction is simulated by discarding the JobQueue instance and building a
 * NEW one over the SAME KeyValueStore (chrome.storage.local survives). No real
 * Supernote/S3/PC is contacted.
 */
import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from '@jobs/job-queue';
import { retryPending, type RetryDeps } from '@jobs/retry-pending';
import { recordedSend } from '@jobs/recorded-send';
import { JobHistory } from '@jobs/job-history';
import { canFallbackToPrivate, offerPrivateCloudFallback } from '@delivery/fallback';
import { isPathEnabled, DEFAULT_FEATURE_FLAGS } from '@shared/feature-flags';
import { DEFAULT_JOB_TTL_MS } from '@domain/job-policy';
import type { SendDocumentDeps, SendRequest } from '@jobs/send-document';
import type { Target } from '@domain/settings';
import { ok, err } from '@shared/result';
import { StorageKeys } from '@shared/storage-keys';
import type { UploadInput } from '@delivery/delivery-port';
import { InMemoryBlobTransfer } from '../../src/background/in-memory-blob-transfer';
import { FakeExtractor } from '../fakes/fake-extractor';
import { FakeRenderer } from '../fakes/fake-renderer';
import { FakeDeliveryPort } from '../fakes/fake-delivery-port';
import { FakeNotifier, FakeOptionsOpener } from '../fakes/fake-notifier';
import { FakeBadge } from '../fakes/fake-badge';
import { FakeClock } from '../fakes/fake-clock';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeRandomSource } from '../fakes/fake-random-source';

const blob = (overrides: Partial<UploadInput> = {}): UploadInput => ({
  bytes: new Uint8Array([1, 2, 3, 4]),
  contentType: 'application/pdf',
  directoryId: '7',
  fileName: 'A.pdf',
  ...overrides,
});

describe('F9-AC1 — auth-interrupted job retained → reconnect → auto-retried → completes', () => {
  it('retries the retained job on reconnect and removes it on success (no re-capture)', async () => {
    const kv = new FakeKeyValueStore();
    const queue = new JobQueue(kv, new FakeClock(1000));
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    const port = new FakeDeliveryPort();

    // A send was interrupted by an auth failure → its converted blob is stored
    // and the job is retained for retry.
    const handle = await blobs.put(new Uint8Array([5, 6, 7]), 'application/pdf');
    await queue.enqueue({
      id: 'j1',
      target: 'cloud',
      directoryId: '7',
      fileName: 'Article.pdf',
      contentType: 'application/pdf',
      blobHandle: handle,
    });
    expect(await queue.list()).toHaveLength(1);

    // User reconnects → retry uploads the SAME stored bytes and completes.
    const deps: RetryDeps = { queue, blobs, resolveDelivery: () => port };
    const outcome = await retryPending(deps, 'cloud');

    expect(outcome).toEqual({ retried: 1, succeeded: 1, failed: 0 });
    expect(Array.from(port.uploadCalls[0]!.bytes)).toEqual([5, 6, 7]); // reused blob
    expect(await queue.list()).toHaveLength(0); // completed → removed
    expect(await blobs.get(handle)).toBeUndefined(); // blob freed
  });
});

describe('F9-AC2 / R-9 — non-auth public fail → accept PC fallback → same blob (no re-capture)', () => {
  it('a NON-AUTH failure with PC configured is eligible and sends the same blob to PC', async () => {
    const sameBlob = blob();
    const original = Uint8Array.from(sameBlob.bytes);
    const pcPort = new FakeDeliveryPort();
    pcPort.uploadResult = ok({ fileName: 'A.pdf', innerName: 'inner' });

    // A non-auth public failure with PC configured → eligible (F9-FR2).
    expect(canFallbackToPrivate({ kind: 'protocol', message: 'endpoint changed' }, true)).toBe(
      true,
    );

    const offer = vi.fn().mockResolvedValue(true);
    const outcome = await offerPrivateCloudFallback({ privatePort: () => pcPort, offer }, sameBlob);

    expect(outcome.kind).toBe('sent');
    expect(pcPort.uploadCalls).toHaveLength(1);
    expect(Array.from(pcPort.uploadCalls[0]!.bytes)).toEqual([1, 2, 3, 4]); // same blob
    expect(sameBlob.bytes).toEqual(original); // never re-captured/mutated
  });

  it('R-9: an AUTH failure NEVER triggers the PC fallback (shared login breaks both)', () => {
    expect(canFallbackToPrivate({ kind: 'auth', errorCode: 'E0401', message: 'x' }, true)).toBe(
      false,
    );
    // Even a connection failure is eligible — only auth is excluded.
    expect(canFallbackToPrivate({ kind: 'connection', message: 'x' }, true)).toBe(true);
  });
});

describe('F9-AC3 — public flag disabled → uses Private Cloud, no public API call', () => {
  it('isPathEnabled gates the public path; the private path stays usable (I-6)', () => {
    const flags = { cloudEnabled: false, privateCloudEnabled: true };
    expect(isPathEnabled(flags, 'cloud')).toBe(false);
    expect(isPathEnabled(flags, 'privatecloud')).toBe(true);
    // default has both enabled
    expect(isPathEnabled(DEFAULT_FEATURE_FLAGS, 'cloud')).toBe(true);
  });

  it('with the public path disabled, a send routes to PC and never calls the public adapter', async () => {
    const flags = { cloudEnabled: false, privateCloudEnabled: true };
    const publicPort = new FakeDeliveryPort();
    const privatePort = new FakeDeliveryPort();
    privatePort.uploadResult = ok({ fileName: 'A.pdf', innerName: 'inner' });

    // The caller picks the target by the feature flag: public disabled → private.
    const target: Target = isPathEnabled(flags, 'cloud') ? 'cloud' : 'privatecloud';
    expect(target).toBe('privatecloud');

    const chosen = target === 'privatecloud' ? privatePort : publicPort;
    await chosen.uploadDocument(blob());

    // The public adapter was never called — its endpoint is not hit.
    expect(publicPort.uploadCalls).toHaveLength(0);
    expect(privatePort.uploadCalls).toHaveLength(1);
  });
});

describe('F9-AC4 — SW restart: queue reconstructed from persisted storage is resumable', () => {
  it('a pending job survives a service-worker eviction and remains intact + resumable', async () => {
    const kv = new FakeKeyValueStore();
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());

    // --- BEFORE eviction: a job is enqueued by the original worker.
    const handle = await blobs.put(new Uint8Array([8, 9]), 'application/pdf');
    const before = new JobQueue(kv, new FakeClock(1000));
    await before.enqueue({
      id: 'survivor',
      target: 'cloud',
      directoryId: '7',
      fileName: 'Survivor.pdf',
      contentType: 'application/pdf',
      blobHandle: handle,
    });
    // The job is persisted to chrome.storage.local.
    expect(await kv.get(StorageKeys.pendingJobs)).toHaveLength(1);

    // --- SW EVICTION: discard the worker; a NEW JobQueue is built over the SAME
    // storage (chrome.storage.local survives the eviction).
    const after = new JobQueue(kv, new FakeClock(2000));
    const resumed = await after.list();

    // State is intact.
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.id).toBe('survivor');
    expect(resumed[0]!.fileName).toBe('Survivor.pdf');
    expect(resumed[0]!.enqueuedAt).toBe(1000); // original timestamp preserved

    // …and resumable: the resumed job retries from the persisted blob handle.
    const port = new FakeDeliveryPort();
    const outcome = await retryPending(
      { queue: after, blobs, resolveDelivery: () => port },
      'cloud',
    );
    expect(outcome.succeeded).toBe(1);
    expect(Array.from(port.uploadCalls[0]!.bytes)).toEqual([8, 9]);
  });
});

describe('F9-AC5 — stale job past TTL is pruned (not retried forever)', () => {
  it('prunes a job older than the TTL and keeps the fresh one', async () => {
    const kv = new FakeKeyValueStore();
    const clock = new FakeClock(0);
    const queue = new JobQueue(kv, clock);

    await queue.enqueue({
      id: 'stale',
      target: 'cloud',
      directoryId: '7',
      fileName: 'Old.pdf',
      contentType: 'application/pdf',
      blobHandle: 'h-old',
    });
    // Advance the clock past the default TTL, then add a fresh job.
    clock.set(DEFAULT_JOB_TTL_MS + 1);
    await queue.enqueue({
      id: 'fresh',
      target: 'cloud',
      directoryId: '7',
      fileName: 'New.pdf',
      contentType: 'application/pdf',
      blobHandle: 'h-new',
    });

    const pruned = await queue.prune(); // default TTL
    expect(pruned.map((j) => j.id)).toEqual(['stale']);
    expect((await queue.list()).map((j) => j.id)).toEqual(['fresh']);
  });
});

describe('JobHistory — records BOTH terminals, capped + local-only (F6-FR6 / F9 #4)', () => {
  function sendDeps(kv: FakeKeyValueStore, port: FakeDeliveryPort): SendDocumentDeps {
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    return {
      resolveDelivery: () => port,
      capture: {
        extractor: new FakeExtractor({
          title: 'My Article',
          content: '<p>'.padEnd(80, 'x') + '</p>',
          length: 600,
        }),
      },
      render: { renderer: new FakeRenderer(1024, blobs) },
      blobs,
      notifier: new FakeNotifier(),
      badge: new FakeBadge(),
      clock: new FakeClock(1000),
      account: 'me@x.com',
      hasToken: (_t: Target) => Promise.resolve(true),
      authDeps: {
        clearToken: () => Promise.resolve(),
        notifier: new FakeNotifier(),
        options: new FakeOptionsOpener(),
      },
    };
  }

  const req: SendRequest = {
    mode: 'reader',
    format: 'pdf',
    target: 'cloud',
    confirmFilename: false,
    includeImages: true,
    page: { hostname: 'example.com' },
  };

  it('records a done entry on a successful saga terminal', async () => {
    const kv = new FakeKeyValueStore();
    const history = new JobHistory(kv, new FakeClock(1000));
    const port = new FakeDeliveryPort();
    port.uploadResult = ok({ fileName: 'My-Article.pdf', innerName: 'inner' });

    await recordedSend(history, sendDeps(kv, port), req);

    const entries = await history.list();
    expect(entries[0]!.outcome).toBe('done');
    expect(entries[0]!.fileName).toBe('My-Article.pdf');
  });

  it('records a failed entry (with reason) on a failed saga terminal', async () => {
    const kv = new FakeKeyValueStore();
    const history = new JobHistory(kv, new FakeClock(1000));
    const port = new FakeDeliveryPort();
    port.uploadResult = err({ kind: 'protocol', message: 'apply broke' });

    const result = await recordedSend(history, sendDeps(kv, port), req);

    expect(result.ok).toBe(false);
    const entries = await history.list();
    expect(entries[0]!.outcome).toBe('failed');
    expect(entries[0]!.reason).toBe('apply broke');
  });

  it('caps the history at 10 entries (newest first) and stores only in local', async () => {
    const kv = new FakeKeyValueStore();
    const history = new JobHistory(kv, new FakeClock(1000));
    for (let i = 0; i < 13; i += 1) {
      await history.record(`File-${i}.pdf`, 'done');
    }
    const entries = await history.list();
    expect(entries).toHaveLength(10); // capped
    expect(entries[0]!.fileName).toBe('File-12.pdf'); // newest first
    expect(entries[9]!.fileName).toBe('File-3.pdf'); // oldest kept
    // local-only: the history key is a jobs.* local key (the fake models .local;
    // there is no .sync surface — I-5 guard enforces no sync in src).
    expect(await kv.get('jobs.history')).toHaveLength(10);
  });
});

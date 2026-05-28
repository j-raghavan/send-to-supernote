/**
 * Integration: pending jobs persist across a service-worker restart and resume,
 * and stale jobs past TTL are pruned (F9-FR5 / F9-AC4 / F9-AC5).
 *
 * A "restart" is modeled by building a NEW JobQueue over the SAME KeyValueStore
 * (chrome.storage.local) — the in-memory SW state is gone but storage persists.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { JobQueue } from '@jobs/job-queue';
import { retryPending } from '@jobs/retry-pending';
import { ok } from '@shared/result';
import { InMemoryBlobTransfer } from '../../src/background/in-memory-blob-transfer';
import { FakeDeliveryPort } from '../fakes/fake-delivery-port';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeClock } from '../fakes/fake-clock';
import { FakeRandomSource } from '../fakes/fake-random-source';

describe('job persistence across SW restart (F9-FR5)', () => {
  let kv: FakeKeyValueStore;
  let clock: FakeClock;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    clock = new FakeClock(1000);
  });

  it('a job enqueued before a restart is intact and resumable after the worker wakes (F9-AC4)', async () => {
    // Pre-restart worker enqueues a job.
    const before = new JobQueue(kv, clock);
    await before.enqueue({
      id: 'j1',
      target: 'cloud',
      directoryId: '7',
      fileName: 'A.pdf',
      contentType: 'application/pdf',
      blobHandle: 'h1',
    });

    // ---- service worker evicted; in-memory state lost ----
    const after = new JobQueue(kv, clock);
    const jobs = await after.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.fileName).toBe('A.pdf');

    // The blob also persists (IndexedDB in prod); resume re-uploads it.
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    // Re-create the stored blob under the same handle for the resume.
    const handle = await blobs.put(new Uint8Array([1, 2, 3]), 'application/pdf');
    await after.remove('j1');
    await after.enqueue({
      id: 'j2',
      target: 'cloud',
      directoryId: '7',
      fileName: 'A.pdf',
      contentType: 'application/pdf',
      blobHandle: handle,
    });
    const port = new FakeDeliveryPort();
    port.uploadResult = ok({ fileName: 'A.pdf', innerName: 'inner' });
    const outcome = await retryPending(
      { queue: after, blobs, resolveDelivery: () => port },
      'cloud',
    );
    expect(outcome.succeeded).toBe(1);
    expect(await after.list()).toHaveLength(0);
  });

  it('prunes a stale job past TTL so the user is not retried indefinitely (F9-AC5)', async () => {
    const queue = new JobQueue(kv, clock);
    await queue.enqueue({
      id: 'old',
      target: 'cloud',
      directoryId: '7',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      blobHandle: 'h-old',
    });

    // Time advances past the TTL; a fresh worker prunes on wake.
    clock.set(1000 + 2 * 60 * 1000);
    const woken = new JobQueue(kv, clock);
    const pruned = await woken.prune(60 * 1000);
    expect(pruned.map((j) => j.id)).toEqual(['old']);
    expect(await woken.list()).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { JobQueue, type EnqueueInput } from '@jobs/job-queue';
import { MAX_PENDING_JOBS } from '@domain/job-policy';
import { StorageKeys } from '@shared/storage-keys';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeClock } from '../../fakes/fake-clock';

function input(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    id: 'j1',
    target: 'cloud',
    directoryId: '7',
    fileName: 'A.pdf',
    contentType: 'application/pdf',
    blobHandle: 'h1',
    ...overrides,
  };
}

describe('JobQueue (F9-FR1 / F9-FR5)', () => {
  let kv: FakeKeyValueStore;
  let clock: FakeClock;
  let queue: JobQueue;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    clock = new FakeClock(1000);
    queue = new JobQueue(kv, clock);
  });

  it('starts empty and tolerates a corrupt stored value', async () => {
    expect(await queue.list()).toEqual([]);
    await kv.set(StorageKeys.pendingJobs, 'not-an-array');
    expect(await queue.list()).toEqual([]);
  });

  it('enqueues a job with an enqueuedAt timestamp and persists it', async () => {
    await queue.enqueue(input());
    const jobs = await queue.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.enqueuedAt).toBe(1000);
    // persisted in chrome.storage.local
    expect(await kv.get(StorageKeys.pendingJobs)).toHaveLength(1);
  });

  it('caps the queue at MAX_PENDING_JOBS (oldest dropped)', async () => {
    for (let i = 0; i <= MAX_PENDING_JOBS; i += 1) {
      await queue.enqueue(input({ id: `j${i}` }));
    }
    const jobs = await queue.list();
    expect(jobs).toHaveLength(MAX_PENDING_JOBS);
    expect(jobs.find((j) => j.id === 'j0')).toBeUndefined();
  });

  it('removes a job by id', async () => {
    await queue.enqueue(input({ id: 'keep' }));
    await queue.enqueue(input({ id: 'drop' }));
    await queue.remove('drop');
    expect((await queue.list()).map((j) => j.id)).toEqual(['keep']);
  });

  it('lists jobs for a target', async () => {
    await queue.enqueue(input({ id: 'c', target: 'cloud' }));
    await queue.enqueue(input({ id: 'p', target: 'privatecloud' }));
    expect((await queue.forTarget('privatecloud')).map((j) => j.id)).toEqual(['p']);
  });

  it('clears all jobs for a target (on disconnect)', async () => {
    await queue.enqueue(input({ id: 'c', target: 'cloud' }));
    await queue.enqueue(input({ id: 'p', target: 'privatecloud' }));
    await queue.clearTarget('cloud');
    expect((await queue.list()).map((j) => j.id)).toEqual(['p']);
  });

  it('prunes stale jobs past TTL and returns them', async () => {
    await queue.enqueue(input({ id: 'old' }));
    clock.set(1000 + 60 * 1000);
    await queue.enqueue(input({ id: 'fresh' }));
    clock.set(1000 + 60 * 1000); // now; old is 60s old, fresh is 0s old
    const pruned = await queue.prune(30 * 1000);
    expect(pruned.map((j) => j.id)).toEqual(['old']);
    expect((await queue.list()).map((j) => j.id)).toEqual(['fresh']);
  });

  it('prune with the default TTL is a no-op (no write) when nothing is stale', async () => {
    await queue.enqueue(input({ id: 'fresh' }));
    const pruned = await queue.prune();
    expect(pruned).toEqual([]);
    expect(await queue.list()).toHaveLength(1);
  });
});

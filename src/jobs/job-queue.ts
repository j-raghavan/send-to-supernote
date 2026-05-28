/**
 * JobQueue (F9-FR1 / F9-FR5) — the capped, persisted pending-job queue.
 *
 * Retained jobs live in chrome.storage.local (via the KeyValueStore port) so they
 * survive a service-worker eviction and resume on wake (F9-FR5). Enqueue is
 * capped (oldest dropped); jobs are removed on successful retry or cleared on
 * disconnect. All policy is the pure domain (job-policy); this is the persistence
 * orchestration.
 */
import type { Clock, KeyValueStore } from '@shared/ports';
import { StorageKeys } from '@shared/storage-keys';
import type { Target } from '@domain/settings';
import {
  DEFAULT_JOB_TTL_MS,
  jobsForTarget,
  type PendingJob,
  pruneStale,
  withinCap,
} from '@domain/job-policy';

export interface EnqueueInput {
  id: string;
  target: Target;
  directoryId: string;
  fileName: string;
  contentType: string;
  blobHandle: string;
}

export class JobQueue {
  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: Clock,
  ) {}

  /** All retained pending jobs (most recent last). */
  async list(): Promise<PendingJob[]> {
    const stored = await this.store.get<PendingJob[]>(StorageKeys.pendingJobs);
    return Array.isArray(stored) ? stored : [];
  }

  /** Retain a job for retry, capped at MAX_PENDING_JOBS (F9-FR1). */
  async enqueue(input: EnqueueInput): Promise<void> {
    const job: PendingJob = { ...input, enqueuedAt: this.clock.now() };
    const next = withinCap(await this.list(), job);
    await this.store.set(StorageKeys.pendingJobs, next);
  }

  /** Remove a job by id (after a successful retry). */
  async remove(id: string): Promise<void> {
    const next = (await this.list()).filter((job) => job.id !== id);
    await this.store.set(StorageKeys.pendingJobs, next);
  }

  /** The retained jobs for a target (to retry after that target reconnects). */
  async forTarget(target: Target): Promise<PendingJob[]> {
    return jobsForTarget(await this.list(), target);
  }

  /** Clear all retained jobs for a target (on disconnect, F2-FR5/F8-FR5). */
  async clearTarget(target: Target): Promise<void> {
    const next = (await this.list()).filter((job) => job.target !== target);
    await this.store.set(StorageKeys.pendingJobs, next);
  }

  /** Prune stale jobs past TTL; returns the pruned ids so their blobs can be freed (F9-FR5). */
  async prune(ttlMs: number = DEFAULT_JOB_TTL_MS): Promise<PendingJob[]> {
    const { kept, pruned } = pruneStale(await this.list(), this.clock.now(), ttlMs);
    if (pruned.length > 0) {
      await this.store.set(StorageKeys.pendingJobs, kept);
    }
    return pruned;
  }
}

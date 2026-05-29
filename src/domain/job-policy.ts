/**
 * Job retention policy (F9) — pure rules for the pending-job queue, no I/O.
 *
 * Bounds the retained-job set: a hard cap on how many jobs are kept (F9-FR1) and
 * a configurable TTL after which a stale job is pruned (F9-FR5) so the user is
 * not retried indefinitely. A job is retryable while it is within TTL.
 */
import type { Target } from '@domain/settings';

/** Max retained pending jobs (oldest dropped when exceeded). */
export const MAX_PENDING_JOBS = 10;

/** Default stale-job TTL: 24 hours in ms. */
export const DEFAULT_JOB_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A retained send job awaiting retry. It captures everything needed to resume at
 * the UPLOAD step using the ALREADY-CONVERTED blob (no re-capture/re-render):
 * the target, destination, filename, and the stored blob handle (F1-FR6).
 */
export interface PendingJob {
  id: string;
  target: Target;
  directoryId: string;
  fileName: string;
  contentType: string;
  /** Handle to the converted bytes stored via BlobTransfer (F1-FR6). */
  blobHandle: string;
  /** Epoch ms when the job was enqueued (for TTL pruning). */
  enqueuedAt: number;
}

/** Append a job to the queue, dropping the oldest when over the cap (F9-FR1). */
export function withinCap(jobs: readonly PendingJob[], next: PendingJob): PendingJob[] {
  const appended = [...jobs, next];
  return appended.length > MAX_PENDING_JOBS
    ? appended.slice(appended.length - MAX_PENDING_JOBS)
    : appended;
}

/** True when a job is past its TTL relative to `now` (F9-FR5). */
export function isStale(job: PendingJob, now: number, ttlMs: number = DEFAULT_JOB_TTL_MS): boolean {
  return now - job.enqueuedAt >= ttlMs;
}

/** Partition jobs into the fresh ones to keep and the stale ones to prune. */
export function pruneStale(
  jobs: readonly PendingJob[],
  now: number,
  ttlMs: number = DEFAULT_JOB_TTL_MS,
): { kept: PendingJob[]; pruned: PendingJob[] } {
  const kept: PendingJob[] = [];
  const pruned: PendingJob[] = [];
  for (const job of jobs) {
    (isStale(job, now, ttlMs) ? pruned : kept).push(job);
  }
  return { kept, pruned };
}

/** The retained jobs for a given target (used to retry after that target reconnects). */
export function jobsForTarget(jobs: readonly PendingJob[], target: Target): PendingJob[] {
  return jobs.filter((job) => job.target === target);
}

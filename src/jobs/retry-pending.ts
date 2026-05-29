/**
 * RetryPending use case (F9-FR1) — after the user reconnects a target, retry the
 * jobs retained for it, reusing the ALREADY-CONVERTED blob (no re-capture). Each
 * job resumes at the UPLOAD step via the DeliveryPort; a success removes the job
 * and frees its blob, an auth failure leaves it retained for the next reconnect,
 * and any other failure leaves it for a later attempt (it stays within TTL).
 */
import type { BlobTransfer } from '@shared/ports';
import type { Target } from '@domain/settings';
import type { PendingJob } from '@domain/job-policy';
import type { DeliveryPort } from '@delivery/delivery-port';
import type { JobQueue } from './job-queue';

export interface RetryDeps {
  queue: JobQueue;
  blobs: BlobTransfer;
  resolveDelivery: (target: Target) => DeliveryPort;
}

export interface RetryOutcome {
  retried: number;
  succeeded: number;
  failed: number;
}

/** Retry all retained jobs for a reconnected target. */
export async function retryPending(deps: RetryDeps, target: Target): Promise<RetryOutcome> {
  const jobs = await deps.queue.forTarget(target);
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const ok = await retryOne(deps, job);
    if (ok) {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }
  return { retried: jobs.length, succeeded, failed };
}

async function retryOne(deps: RetryDeps, job: PendingJob): Promise<boolean> {
  const stored = await deps.blobs.get(job.blobHandle);
  if (stored === undefined) {
    // The converted bytes are gone (e.g. pruned) — drop the un-resumable job.
    await deps.queue.remove(job.id);
    return false;
  }
  const port = deps.resolveDelivery(job.target);
  const result = await port.uploadDocument({
    bytes: stored.bytes,
    contentType: job.contentType,
    directoryId: job.directoryId,
    fileName: job.fileName,
  });
  if (result.ok) {
    await deps.queue.remove(job.id);
    await deps.blobs.delete(job.blobHandle);
    return true;
  }
  // Non-success: keep the job retained (auth -> next reconnect; other -> later).
  return false;
}

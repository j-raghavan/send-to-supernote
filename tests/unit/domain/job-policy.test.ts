import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_TTL_MS,
  isStale,
  jobsForTarget,
  MAX_PENDING_JOBS,
  type PendingJob,
  pruneStale,
  withinCap,
} from '@domain/job-policy';

function job(overrides: Partial<PendingJob> = {}): PendingJob {
  return {
    id: 'j1',
    target: 'cloud',
    directoryId: '7',
    fileName: 'A.pdf',
    contentType: 'application/pdf',
    blobHandle: 'h1',
    enqueuedAt: 1000,
    ...overrides,
  };
}

describe('withinCap (F9-FR1)', () => {
  it('appends a job below the cap', () => {
    expect(withinCap([job({ id: 'a' })], job({ id: 'b' }))).toHaveLength(2);
  });

  it('drops the oldest when over the cap', () => {
    const existing = Array.from({ length: MAX_PENDING_JOBS }, (_v, i) => job({ id: `j${i}` }));
    const next = withinCap(existing, job({ id: 'newest' }));
    expect(next).toHaveLength(MAX_PENDING_JOBS);
    expect(next[next.length - 1]!.id).toBe('newest');
    expect(next.find((j) => j.id === 'j0')).toBeUndefined(); // oldest dropped
  });
});

describe('isStale / pruneStale (F9-FR5)', () => {
  it('is not stale within TTL', () => {
    expect(isStale(job({ enqueuedAt: 1000 }), 1000 + DEFAULT_JOB_TTL_MS - 1)).toBe(false);
  });

  it('is stale at/after TTL', () => {
    expect(isStale(job({ enqueuedAt: 1000 }), 1000 + DEFAULT_JOB_TTL_MS)).toBe(true);
  });

  it('honors a custom TTL', () => {
    expect(isStale(job({ enqueuedAt: 0 }), 100, 50)).toBe(true);
    expect(isStale(job({ enqueuedAt: 0 }), 40, 50)).toBe(false);
  });

  it('partitions kept vs pruned', () => {
    // now = TTL + 1000: `fresh` (enqueued at TTL) is 1000ms old → kept;
    // `old` (enqueued at 0) is TTL+1000ms old → pruned.
    const fresh = job({ id: 'fresh', enqueuedAt: DEFAULT_JOB_TTL_MS });
    const old = job({ id: 'old', enqueuedAt: 0 });
    const { kept, pruned } = pruneStale([fresh, old], DEFAULT_JOB_TTL_MS + 1000);
    expect(kept.map((j) => j.id)).toEqual(['fresh']);
    expect(pruned.map((j) => j.id)).toEqual(['old']);
  });
});

describe('jobsForTarget', () => {
  it('filters jobs by target', () => {
    const jobs = [job({ id: 'c', target: 'cloud' }), job({ id: 'p', target: 'privatecloud' })];
    expect(jobsForTarget(jobs, 'privatecloud').map((j) => j.id)).toEqual(['p']);
  });
});

/**
 * Job history (F6-FR6 / NFR Observability) — a capped local log of recent sends.
 *
 * Powers the popup's "last N sends with status" list. Local-only (chrome.storage
 * .local via the KeyValueStore port — no remote logging). Covered; the popup
 * shell only renders the entries this returns.
 */
import type { Clock, KeyValueStore } from '@shared/ports';

export type JobOutcome = 'done' | 'failed';

export interface JobHistoryEntry {
  fileName: string;
  outcome: JobOutcome;
  /** Epoch ms when the send terminated. */
  at: number;
  /** Short reason for a failure (optional). */
  reason?: string;
}

const HISTORY_KEY = 'jobs.history';
const MAX_ENTRIES = 10;

export class JobHistory {
  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: Clock,
  ) {}

  /** The most-recent-first list of recorded sends (capped). */
  async list(): Promise<JobHistoryEntry[]> {
    const stored = await this.store.get<JobHistoryEntry[]>(HISTORY_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  /** Record a terminal send outcome, newest first, capped at MAX_ENTRIES. */
  async record(fileName: string, outcome: JobOutcome, reason?: string): Promise<void> {
    const entry: JobHistoryEntry = {
      fileName,
      outcome,
      at: this.clock.now(),
      ...(reason !== undefined ? { reason } : {}),
    };
    const next = [entry, ...(await this.list())].slice(0, MAX_ENTRIES);
    await this.store.set(HISTORY_KEY, next);
  }
}

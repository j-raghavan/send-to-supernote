/**
 * Send-job state machine (F5-FR6 / I-3) — pure FSM, no I/O.
 *
 * A job is "done" ONLY after the finish step reports success (I-3). The FSM
 * makes `done` structurally unreachable except via `finishing` -> `done`, and an
 * applied-but-not-finished upload can only go to `failed`, never `done`
 * (F5-AC6). The saga (jobs/send-document) drives transitions; persistence
 * (F9-FR5) snapshots the state so a service-worker eviction resumes from the
 * last completed step.
 */

export type JobState =
  | 'queued'
  | 'capturing'
  | 'converting'
  | 'hashing'
  | 'uploading'
  | 'finishing'
  | 'done'
  | 'failed';

/** Allowed forward transitions. `failed` is reachable from any non-terminal state. */
const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ['capturing', 'failed'],
  capturing: ['converting', 'failed'],
  converting: ['hashing', 'failed'],
  hashing: ['uploading', 'failed'],
  uploading: ['finishing', 'failed'],
  // `done` is reachable ONLY from `finishing` (I-3): you cannot skip finish.
  finishing: ['done', 'failed'],
  done: [],
  failed: [],
};

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['done', 'failed']);

/** True when `to` is a legal next state from `from`. */
export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** True for a terminal state (done or failed) — no further transitions. */
export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Transition the job to `done` ONLY when the finish step verified success
 * (I-3 / F5-FR6). From `finishing`: finishSucceeded -> `done`, otherwise
 * `failed`. Called only after a real finish response is evaluated.
 */
export function completeFinish(from: JobState, finishSucceeded: boolean): JobState {
  if (from !== 'finishing') {
    throw new Error(`completeFinish called from illegal state: ${from}`);
  }
  return finishSucceeded ? 'done' : 'failed';
}

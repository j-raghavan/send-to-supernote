/**
 * Bound a promise by a timeout (F4-AC3: capture must not hang indefinitely).
 *
 * Races the work against a timer; on timeout it resolves to a timeout Result
 * instead of hanging. The timer is injected (setTimeout by default) so tests are
 * deterministic with fake timers. Pure control-flow; no DOM.
 */
import { err, ok, type Result } from './result';

export type TimeoutError = { kind: 'timeout'; ms: number };

export interface Timer {
  set(handler: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimer: Timer = {
  set: (handler, ms) => setTimeout(handler, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Resolve to `ok(value)` if `work` settles within `ms`, otherwise `err(timeout)`.
 * A rejection from `work` propagates (the caller decides how to handle it).
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  timer: Timer = defaultTimer,
): Promise<Result<T, TimeoutError>> {
  return new Promise((resolve, reject) => {
    const handle = timer.set(() => resolve(err({ kind: 'timeout', ms })), ms);
    work.then(
      (value) => {
        timer.clear(handle);
        resolve(ok(value));
      },
      (error: unknown) => {
        timer.clear(handle);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

import { describe, expect, it } from 'vitest';
import { withTimeout, type Timer } from '@shared/with-timeout';

/** Controllable timer harness: fire() triggers the scheduled timeout on demand. */
class TimerHarness {
  private handler: (() => void) | undefined;
  cleared = false;

  readonly timer: Timer = {
    set: (h) => {
      this.handler = h;
      return 1;
    },
    clear: () => {
      this.cleared = true;
    },
  };

  fire(): void {
    this.handler?.();
  }
}

function controllableTimer(): TimerHarness {
  return new TimerHarness();
}

describe('withTimeout (F4-AC3)', () => {
  it('resolves ok when the work settles before the timeout', async () => {
    const { timer } = controllableTimer();
    const result = await withTimeout(Promise.resolve('done'), 1000, timer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('done');
    }
  });

  it('clears the timer once the work settles', async () => {
    const harness = controllableTimer();
    await withTimeout(Promise.resolve('x'), 1000, harness.timer);
    expect(harness.cleared).toBe(true);
  });

  it('resolves to a timeout error when the timer fires first', async () => {
    const harness = controllableTimer();
    let resolveWork!: (v: string) => void;
    const work = new Promise<string>((r) => {
      resolveWork = r;
    });
    const pending = withTimeout(work, 500, harness.timer);
    harness.fire();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
      expect(result.error.ms).toBe(500);
    }
    resolveWork('late');
  });

  it('propagates a rejection from the work (Error)', async () => {
    const harness = controllableTimer();
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000, harness.timer),
    ).rejects.toThrow('boom');
  });

  it('wraps a non-Error rejection in an Error', async () => {
    const harness = controllableTimer();
    // Intentionally a non-Error rejection to exercise the wrapping branch.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const rejected: Promise<string> = Promise.reject('plain');
    await expect(withTimeout(rejected, 1000, harness.timer)).rejects.toThrow('plain');
  });

  it('uses the default timer when none is injected (settles fast)', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result.ok && result.value).toBe(42);
  });
});

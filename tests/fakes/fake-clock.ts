import type { Clock } from '@shared/ports';

/** Deterministic Clock for tests. */
export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

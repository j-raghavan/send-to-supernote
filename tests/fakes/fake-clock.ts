import type { Clock } from '@shared/ports';

/** Deterministic Clock for tests. */
export class FakeClock implements Clock {
  constructor(
    private current: number,
    private readonly zone: string | undefined = 'UTC',
  ) {}

  now(): number {
    return this.current;
  }

  timeZone(): string | undefined {
    return this.zone;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

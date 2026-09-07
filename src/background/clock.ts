/**
 * SystemClock — Clock port over Date.now (thin). Coverage-excluded glue.
 */
/* c8 ignore start */
import type { Clock } from '@shared/ports';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  timeZone(): string | undefined {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
/* c8 ignore stop */

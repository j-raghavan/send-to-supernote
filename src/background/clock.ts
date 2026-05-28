/**
 * SystemClock — Clock port over Date.now (thin). Coverage-excluded glue.
 */
/* c8 ignore start */
import type { Clock } from '@shared/ports';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
/* c8 ignore stop */

import type { RandomSource } from '@shared/ports';

/**
 * Deterministic RandomSource for tests: UUIDs are sequential and `digits`
 * returns a fixed repeating pattern, so nonce/handle/equipment values are
 * predictable in assertions.
 */
export class FakeRandomSource implements RandomSource {
  private counter = 0;

  constructor(private readonly seedDigits = '1234567890') {}

  digits(count: number): string {
    let out = '';
    while (out.length < count) {
      out += this.seedDigits;
    }
    return out.slice(0, count);
  }

  uuid(): string {
    this.counter += 1;
    return `00000000-0000-0000-0000-${this.counter.toString().padStart(12, '0')}`;
  }
}

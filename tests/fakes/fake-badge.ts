import type { Badge, BadgeState } from '@shared/ports';

/** Records badge state changes for assertions. */
export class FakeBadge implements Badge {
  readonly states: BadgeState[] = [];

  set(state: BadgeState): Promise<void> {
    this.states.push(state);
    return Promise.resolve();
  }

  /** The most recently set badge state. */
  get current(): BadgeState | undefined {
    return this.states.at(-1);
  }
}

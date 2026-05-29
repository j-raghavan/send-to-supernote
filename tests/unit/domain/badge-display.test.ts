import { describe, expect, it } from 'vitest';
import { badgeDisplay } from '@domain/badge-display';

describe('badgeDisplay (F6-FR5 / F2-FR6)', () => {
  it('shows the in-flight ellipsis for busy', () => {
    expect(badgeDisplay('busy').text).toBe('…');
  });

  it('shows an error bang for error and expired', () => {
    expect(badgeDisplay('error').text).toBe('!');
    expect(badgeDisplay('expired').text).toBe('!');
  });

  it('clears the badge text for idle', () => {
    expect(badgeDisplay('idle').text).toBe('');
  });

  it('provides a distinct color per state', () => {
    const colors = new Set(
      (['idle', 'busy', 'error', 'expired'] as const).map((s) => badgeDisplay(s).color),
    );
    expect(colors.size).toBe(4);
  });
});

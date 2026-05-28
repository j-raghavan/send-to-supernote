import { describe, expect, it } from 'vitest';
import { onboardingCopy, SYNC_NOT_INSTANT, targetMatchCopy } from '@settings/onboarding';

describe('onboarding copy (F7-FR6 / F7-AC5)', () => {
  it('states files appear only after a device sync (not instant)', () => {
    expect(SYNC_NOT_INSTANT.toLowerCase()).toContain('only after');
    expect(SYNC_NOT_INSTANT.toLowerCase()).toContain('not instantly');
  });

  it('target-match copy for Cloud mentions the same account', () => {
    expect(targetMatchCopy('cloud').toLowerCase()).toContain('same supernote account');
  });

  it('target-match copy for Private Cloud mentions the paired server', () => {
    const copy = targetMatchCopy('privatecloud').toLowerCase();
    expect(copy).toContain('private cloud');
    expect(copy).toContain('paired');
  });

  it('the full onboarding paragraph combines sync-not-instant + target-match', () => {
    const copy = onboardingCopy('cloud');
    expect(copy).toContain(SYNC_NOT_INSTANT);
    expect(copy).toContain('same Supernote account');
  });
});

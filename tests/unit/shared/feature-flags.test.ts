import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, isPathEnabled, normalizeFlags } from '@shared/feature-flags';

describe('feature flags (F9-FR4 / I-6)', () => {
  it('defaults both paths to enabled', () => {
    expect(DEFAULT_FEATURE_FLAGS).toEqual({ cloudEnabled: true, privateCloudEnabled: true });
  });

  it('isPathEnabled honors the per-path flag', () => {
    expect(isPathEnabled({ cloudEnabled: true, privateCloudEnabled: false }, 'cloud')).toBe(true);
    expect(isPathEnabled({ cloudEnabled: true, privateCloudEnabled: false }, 'privatecloud')).toBe(
      false,
    );
  });

  it('disabling public leaves private usable (I-6)', () => {
    const flags = { cloudEnabled: false, privateCloudEnabled: true };
    expect(isPathEnabled(flags, 'cloud')).toBe(false);
    expect(isPathEnabled(flags, 'privatecloud')).toBe(true);
  });

  it('normalizeFlags reads valid booleans', () => {
    expect(normalizeFlags({ cloudEnabled: false, privateCloudEnabled: true })).toEqual({
      cloudEnabled: false,
      privateCloudEnabled: true,
    });
  });

  it('normalizeFlags falls back to defaults for corrupt/partial values', () => {
    expect(normalizeFlags(null)).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(normalizeFlags('nope')).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(normalizeFlags({ cloudEnabled: 'yes' })).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(normalizeFlags({ privateCloudEnabled: false })).toEqual({
      cloudEnabled: true,
      privateCloudEnabled: false,
    });
  });
});

/**
 * Per-path upload feature flags (F9-FR4 / I-6) — pure, covered.
 *
 * Each upload path (public Cloud, Private Cloud) is independently enable/disable-
 * able so the public path can be killed fast via an update if Ratta breaks its
 * endpoint, while leaving the Private Cloud path usable for self-hosters (I-6).
 * Flags default to enabled; they are read from storage (so an update can flip the
 * default) but the shape lives here.
 */
import type { Target } from '@domain/settings';

export interface FeatureFlags {
  /** Public Supernote Cloud upload path enabled. */
  cloudEnabled: boolean;
  /** Self-hosted Private Cloud upload path enabled. */
  privateCloudEnabled: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  cloudEnabled: true,
  privateCloudEnabled: true,
};

/** Whether a given target's upload path is enabled. */
export function isPathEnabled(flags: FeatureFlags, target: Target): boolean {
  return target === 'privatecloud' ? flags.privateCloudEnabled : flags.cloudEnabled;
}

/** Validate/normalize a stored flags value, falling back to the defaults. */
export function normalizeFlags(value: unknown): FeatureFlags {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_FEATURE_FLAGS;
  }
  const raw = value as Record<string, unknown>;
  return {
    cloudEnabled:
      typeof raw.cloudEnabled === 'boolean' ? raw.cloudEnabled : DEFAULT_FEATURE_FLAGS.cloudEnabled,
    privateCloudEnabled:
      typeof raw.privateCloudEnabled === 'boolean'
        ? raw.privateCloudEnabled
        : DEFAULT_FEATURE_FLAGS.privateCloudEnabled,
  };
}

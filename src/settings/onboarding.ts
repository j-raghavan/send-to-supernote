/**
 * Onboarding / sync-expectation copy (F7-FR6) — covered, pure.
 *
 * First-run and the Options page must state plainly that (a) sent files appear on
 * the tablet only AFTER the device syncs (manual or configured) — not instantly;
 * and (b) the chosen target must match what the device actually syncs (public
 * Cloud account vs a paired Private Cloud server). A mismatch means a
 * "successful" send never reaches the device (spec Edge Cases).
 */
import type { Target } from '@domain/settings';

export const SYNC_NOT_INSTANT =
  'Files appear on your Supernote only after the device syncs (a manual tap or your configured sync) — not instantly.';

const TARGET_MATCH_CLOUD =
  'You are sending to Supernote Cloud, so your device must be signed into the same Supernote account for the file to arrive.';

const TARGET_MATCH_PRIVATE =
  'You are sending to your Private Cloud server, so your device must be paired to that same server for the file to arrive.';

/** The target-match guidance for the currently-selected target (F7-FR6). */
export function targetMatchCopy(target: Target): string {
  return target === 'privatecloud' ? TARGET_MATCH_PRIVATE : TARGET_MATCH_CLOUD;
}

/** The full onboarding paragraph: sync-not-instant + target-match for the target. */
export function onboardingCopy(target: Target): string {
  return `${SYNC_NOT_INSTANT} ${targetMatchCopy(target)}`;
}

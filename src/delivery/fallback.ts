/**
 * Public -> Private Cloud fallback (F9-FR2) — covered, pure orchestration.
 *
 * When a public-Cloud send fails for a NON-AUTH reason and the user has a Private
 * Cloud server configured, offer a one-click "Send to your Private Cloud instead"
 * that re-sends the ALREADY-CONVERTED blob (no re-capture / re-render) via the
 * private DeliveryPort. The same UploadInput is reused, so nothing is recomputed.
 *
 * R-9 limitation (spec Risks / F9): Private Cloud SHARES the public login flow,
 * so this fallback only covers public-ENDPOINT issues — NOT an auth-scheme change
 * (which breaks both targets) — and only for users who self-host. Auth failures
 * are therefore NEVER routed here; they go to the reconnect path (F2-FR4).
 */
import type { Result } from '@shared/result';
import type { DeliveryFailure } from '@domain/delivery';
import type { DeliveryPort, UploadInput, UploadResult } from './delivery-port';

/** Whether a failed public send is eligible for the Private Cloud fallback (F9-FR2). */
export function canFallbackToPrivate(
  failure: DeliveryFailure,
  privateConfigured: boolean,
): boolean {
  // Only NON-AUTH public failures, and only when a Private Cloud is configured
  // (R-9: an auth-scheme change would break both targets, so auth never falls back).
  return privateConfigured && failure.kind !== 'auth';
}

export interface FallbackDeps {
  /** Build the Private Cloud DeliveryPort (resolveDelivery('privatecloud', ...)). */
  privatePort: () => DeliveryPort;
  /** One-click prompt; resolves true when the user accepts the fallback. */
  offer: () => Promise<boolean>;
}

export type FallbackOutcome =
  | { kind: 'declined' }
  | { kind: 'sent'; result: UploadResult }
  | { kind: 'failed'; failure: DeliveryFailure };

/**
 * Offer + (if accepted) perform the fallback, reusing the same converted blob.
 * The caller has already confirmed eligibility via canFallbackToPrivate.
 */
export async function offerPrivateCloudFallback(
  deps: FallbackDeps,
  input: UploadInput,
): Promise<FallbackOutcome> {
  const accepted = await deps.offer();
  if (!accepted) {
    return { kind: 'declined' };
  }
  const result: Result<UploadResult, DeliveryFailure> = await deps
    .privatePort()
    .uploadDocument(input);
  return result.ok
    ? { kind: 'sent', result: result.value }
    : { kind: 'failed', failure: result.error };
}

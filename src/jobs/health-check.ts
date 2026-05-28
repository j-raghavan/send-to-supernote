/**
 * Per-target health check on connect (F9-FR3) — covered orchestration.
 *
 * After connecting a target, run a cheap authenticated call (DeliveryPort
 * .healthCheck). If the PUBLIC-Cloud check fails in a way consistent with an
 * endpoint change (a non-auth failure: protocol/connection/not-found — NOT an
 * auth failure, which just means re-login), recommend switching the default
 * target to Private Cloud. Per R-9 this is only meaningful for self-hosters, so
 * the recommendation is gated on a Private Cloud being configured.
 */
import type { Target } from '@domain/settings';
import type { DeliveryFailure } from '@domain/delivery';
import type { DeliveryPort } from '@delivery/delivery-port';

export interface HealthResult {
  healthy: boolean;
  /** The failure when unhealthy (for messaging). */
  failure?: DeliveryFailure;
  /** True when the user should be advised to switch the default to Private Cloud. */
  recommendPrivateCloud: boolean;
}

/**
 * True when a public-Cloud health failure looks like an endpoint change worth
 * recommending a switch for: any non-auth failure (an auth failure is just an
 * expired/invalid token, handled by the reconnect path, not an endpoint break).
 */
export function looksLikeEndpointChange(failure: DeliveryFailure): boolean {
  return failure.kind !== 'auth';
}

export interface HealthCheckDeps {
  port: DeliveryPort;
  /** Whether a Private Cloud server is configured (R-9: switch is self-hoster-only). */
  privateCloudConfigured: boolean;
}

/** Run the connect-time health check for a target and derive a recommendation. */
export async function runHealthCheck(deps: HealthCheckDeps, target: Target): Promise<HealthResult> {
  const result = await deps.port.healthCheck();
  if (result.ok) {
    return { healthy: true, recommendPrivateCloud: false };
  }
  const recommend =
    target === 'cloud' && deps.privateCloudConfigured && looksLikeEndpointChange(result.error);
  return { healthy: false, failure: result.error, recommendPrivateCloud: recommend };
}

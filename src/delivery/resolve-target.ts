/**
 * resolveDelivery target switch (F8 / ADR-0004) — covered factory.
 *
 * Builds the DeliveryPort for the selected target: the PublicCloudAdapter for
 * 'cloud' and the PrivateCloudAdapter for 'privatecloud', threading the
 * per-target base URL + token. Both implement the same DeliveryPort so the saga
 * is unchanged. Per-path feature flags (F9-FR4) hook in here later. The adapters
 * themselves use the HttpClient port (the sole fetch), so this stays pure logic.
 */
import type { Clock, HttpClient, RandomSource } from '@shared/ports';
import { type ApiProfile } from '@domain/delivery';
import type { Target } from '@domain/settings';
import type { DeliveryPort } from './delivery-port';
import { PublicCloudAdapter } from './public-cloud-adapter';
import { PrivateCloudAdapter } from './private-cloud-adapter';

export interface CloudTargetConfig {
  profile: ApiProfile;
  token: string;
}

export interface PrivateTargetConfig {
  baseUrl: string;
  token: string;
}

export interface ResolveTargetConfig {
  http: HttpClient;
  random: RandomSource;
  clock: Clock;
  cloud: CloudTargetConfig;
  /** Present only when a Private Cloud server has been configured. */
  privateCloud?: PrivateTargetConfig;
}

/**
 * Resolve the DeliveryPort for a target. Falls back to the public adapter when
 * Private Cloud is selected but not configured (the saga's connect-first gate
 * already blocks an unconfigured/un-connected send; this keeps the type total).
 */
export function resolveDelivery(target: Target, config: ResolveTargetConfig): DeliveryPort {
  if (target === 'privatecloud' && config.privateCloud !== undefined) {
    return new PrivateCloudAdapter({
      http: config.http,
      baseUrl: config.privateCloud.baseUrl,
      token: config.privateCloud.token,
      random: config.random,
      clock: config.clock,
    });
  }
  return new PublicCloudAdapter({
    http: config.http,
    profile: config.cloud.profile,
    token: config.cloud.token,
  });
}

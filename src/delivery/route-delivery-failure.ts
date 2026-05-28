/**
 * Route a delivery failure to the right recovery (F5-FR4 / F8-FR6).
 *
 * Every upload/list step returns a canonical DeliveryFailure. An `auth` failure
 * (401/E0401) routes to the F2-FR4 recovery (clear token, re-prompt, retain the
 * job); any other failure is SURFACED so the caller (saga/F9) can show it and,
 * when a Private Cloud is configured, offer the fallback (F9-FR2). Pure routing
 * over the auth-failure use case; no network/chrome here.
 */
import {
  type AuthFailureDeps,
  type AuthFailureParams,
  handleAuthFailure,
} from '../auth/handle-auth-failure';
import type { DeliveryFailure } from '@domain/delivery';

export type DeliveryOutcome =
  | { kind: 'auth'; retainedForRetry: true }
  | { kind: 'surface'; failure: DeliveryFailure };

/**
 * Dispatch a delivery failure. For `auth`, runs the auth-failure recovery and
 * signals the job was retained for retry after reconnect. Everything else is
 * returned for the caller to surface (and route to the F9 fallback).
 */
export async function routeDeliveryFailure(
  failure: DeliveryFailure,
  authDeps: AuthFailureDeps,
  authParams: AuthFailureParams = {},
): Promise<DeliveryOutcome> {
  if (failure.kind === 'auth') {
    await handleAuthFailure(authDeps, authParams);
    return { kind: 'auth', retainedForRetry: true };
  }
  return { kind: 'surface', failure };
}

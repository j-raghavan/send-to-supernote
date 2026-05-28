/**
 * ReflectConnectionState use case (F2-FR6).
 *
 * Derives the current session state for a target from whether a token is stored
 * (connected) or not (disconnected) — with `expired` passed in transiently after
 * an auth failure — and reflects it on the toolbar badge. The popup reads the
 * same status. The badge state mapping is pure domain (badgeStateFor); the
 * chrome.action write is the thin adapter (F2-FR6, visual verification deferred).
 */
import type { Badge } from '@shared/ports';
import { type BadgeState, badgeStateFor, type SessionState } from '@domain/auth';
import type { TokenStore } from './token-store';

export interface ConnectionView {
  session: SessionState;
  account?: string;
  badge: BadgeState;
}

export interface ReflectDeps {
  tokens: TokenStore;
  badge: Badge;
}

export interface ReflectParams {
  /** Force the expired state after an auth failure (overrides token presence). */
  expired?: boolean;
  /** Whether a send job is currently in flight (drives the busy badge). */
  jobInFlight?: boolean;
}

/** Resolve the session state from stored credentials and the transient flags. */
export async function resolveSessionState(
  tokens: TokenStore,
  expired = false,
): Promise<SessionState> {
  if (expired) {
    return 'expired';
  }
  const token = await tokens.getToken();
  return token !== undefined && token.length > 0 ? 'connected' : 'disconnected';
}

/**
 * Compute the connection view and set the toolbar badge to match it.
 */
export async function reflectConnectionState(
  deps: ReflectDeps,
  params: ReflectParams = {},
): Promise<ConnectionView> {
  const session = await resolveSessionState(deps.tokens, params.expired ?? false);
  const account = await deps.tokens.getAccount();
  const badge = badgeStateFor(session, params.jobInFlight ?? false);
  await deps.badge.set(badge);
  return account !== undefined ? { session, account, badge } : { session, badge };
}

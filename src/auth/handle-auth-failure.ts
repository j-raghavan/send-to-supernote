/**
 * HandleAuthFailure use case (F2-FR4).
 *
 * On an auth failure (transport `401` OR `success:false`/`errorCode:"E0401"` at
 * HTTP 200) on any authenticated call for a target: clear that target's token,
 * set a "session expired" state, notify the user, and open the Options page with
 * the account prefilled. The in-flight job is RETAINED for retry after reconnect
 * (handed to F9 via the optional `retainJob` callback). The password is NOT
 * auto-resubmitted — none is stored (F2-AC4).
 *
 * Target-agnostic: callers pass the token-clearing function and the account so
 * the same routine serves both public Cloud (F2) and Private Cloud (F8-FR6).
 */
import type { Notifier, OptionsOpener } from '@shared/ports';

export type SessionState = 'connected' | 'expired' | 'disconnected';

export interface AuthFailureDeps {
  clearToken: () => Promise<void>;
  notifier: Notifier;
  options: OptionsOpener;
  /** Optional hook to retain the interrupted job for retry (F9-FR1). */
  retainJob?: () => Promise<void>;
}

export interface AuthFailureParams {
  /** The account to prefill on the Options re-connect form, if known. */
  account?: string;
  /** Which target's session expired (for the message), e.g. "Supernote". */
  targetLabel?: string;
}

/**
 * Run the auth-failure recovery flow. Returns the new session state (`expired`).
 */
export async function handleAuthFailure(
  deps: AuthFailureDeps,
  params: AuthFailureParams = {},
): Promise<SessionState> {
  await deps.clearToken();

  if (deps.retainJob) {
    await deps.retainJob();
  }

  const label = params.targetLabel ?? 'Supernote';
  await deps.notifier.notify({
    level: 'error',
    title: `${label} session expired`,
    message: 'Reconnect to continue. Your pending send will retry after you sign in.',
  });

  await deps.options.open(params.account);

  return 'expired';
}

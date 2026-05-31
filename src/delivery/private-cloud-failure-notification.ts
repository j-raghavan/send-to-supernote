/**
 * Private Cloud failure messaging (F8-FR6) — covered, pure.
 *
 * Maps a Private Cloud DeliveryFailure to a user notification that distinguishes
 * CONNECTION problems (server unreachable, TLS, wrong/typo base URL, non-
 * Supernote response) — a distinct "can't reach your Private Cloud server"
 * message with NO auth re-prompt — from AUTH failures (401/E0401), which the
 * saga routes to the token-clear + reconnect path (routeDeliveryFailure). The
 * saga still calls routeDeliveryFailure for auth; this provides the connection/
 * protocol copy for the surface path.
 */
import type { Notification } from '@shared/ports';
import type { DeliveryFailure } from '@domain/delivery';

/**
 * Build the surface notification for a non-auth Private Cloud failure. Auth
 * failures are NOT handled here (they go through routeDeliveryFailure ->
 * reconnect); passing one returns a generic message but the saga never does.
 */
export function privateCloudFailureNotification(failure: DeliveryFailure): Notification {
  if (failure.kind === 'connection') {
    // `failure.message` is the self-contained reachability/cert hint
    // (privateCloudNetworkErrorHint) — show it as-is, no redundant suffix.
    return {
      level: 'error',
      title: "Can't reach your Private Cloud",
      message: failure.message,
    };
  }
  return { level: 'error', title: 'Private Cloud send failed', message: failure.message };
}

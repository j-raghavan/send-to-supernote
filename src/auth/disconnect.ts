/**
 * Disconnect use case (F2-FR5 / F8-FR5).
 *
 * Removes a target's stored credentials/identity and clears that target's
 * pending jobs. For public Cloud (F2-FR5) that is `supernote.token`,
 * `supernote.account`, and `supernote.equipment`; for Private Cloud (F8-FR5)
 * the `privatecloud.*` keys. The set of keys is passed in, so one routine serves
 * both targets. Pending-job clearing is delegated to an optional hook (F9).
 */
import type { KeyValueStore } from '@shared/ports';
import { PRIVATE_CLOUD_KEYS, PUBLIC_CLOUD_KEYS } from '@shared/storage-keys';

export interface DisconnectDeps {
  store: KeyValueStore;
  /** Optional hook to clear that target's pending jobs (F9). */
  clearPendingJobs?: () => Promise<void>;
}

/** Remove the given credential keys and clear pending jobs. */
export async function disconnect(deps: DisconnectDeps, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await deps.store.remove(key);
  }
  if (deps.clearPendingJobs) {
    await deps.clearPendingJobs();
  }
}

/** Disconnect the public Supernote Cloud account (F2-FR5). */
export function disconnectPublicCloud(deps: DisconnectDeps): Promise<void> {
  return disconnect(deps, PUBLIC_CLOUD_KEYS);
}

/**
 * Disconnect the Private Cloud server (F8-FR5): remove the JWT + account and
 * clear PC pending jobs. The base URL is intentionally kept so the re-connect
 * form can prefill it without re-typing.
 */
export function disconnectPrivateCloud(deps: DisconnectDeps): Promise<void> {
  return disconnect(deps, PRIVATE_CLOUD_KEYS);
}

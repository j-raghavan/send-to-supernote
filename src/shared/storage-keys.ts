/**
 * Storage keys (Data Model). Centralized so the storage contract is in one
 * place and Disconnect can clear by prefix. ALL of these live in
 * `chrome.storage.local` only — never `chrome.storage.sync` (I-5).
 *
 * The password is NEVER a key here (D-2): it exists only as a transient local
 * variable during login.
 */

export const StorageKeys = {
  // Public Cloud account (F2).
  token: 'supernote.token',
  account: 'supernote.account',
  equipment: 'supernote.equipment',
  apiHost: 'supernote.apiHost',
  /** Transient: id of the official-login tab while a cloud connect is pending. */
  cloudConnectTabId: 'supernote.connectTabId',
  /** Transient: cookie store of the login tab (Incognito/container) for that connect. */
  cloudConnectStoreId: 'supernote.connectStoreId',

  // Capture/send settings (F7) — declared here for the single contract; written in F7.
  defaultMode: 'settings.defaultMode',
  defaultFormat: 'settings.defaultFormat',
  target: 'settings.target',
  cloudFolderId: 'settings.cloudFolderId',
  confirmFilename: 'settings.confirmFilename',
  includeImages: 'settings.includeImages',
  includeProvenance: 'settings.includeProvenance',

  // Private Cloud (F8).
  privateBaseUrl: 'privatecloud.baseUrl',
  privateAccount: 'privatecloud.account',
  privateToken: 'privatecloud.token',
  privateFolderId: 'privatecloud.folderId',

  /** Per-target "session expired" flags so the expired state survives a popup reopen (F2-FR6). */
  sessionExpired: 'supernote.sessionExpired',
  privateSessionExpired: 'privatecloud.sessionExpired',

  // Jobs (F9).
  pendingJobs: 'jobs.pending',
  jobHistory: 'jobs.history',
  featureFlags: 'flags.paths',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

/**
 * Keys cleared on public-Cloud Disconnect (F2-FR5): the credential/identity keys
 * plus any transient connect state, so disconnecting mid-connect cannot leave a
 * stale pending-connect tab/store id that a later cookie change would act on.
 */
export const PUBLIC_CLOUD_KEYS: readonly string[] = [
  StorageKeys.token,
  StorageKeys.account,
  StorageKeys.equipment,
  StorageKeys.sessionExpired,
  StorageKeys.cloudConnectTabId,
  StorageKeys.cloudConnectStoreId,
];

/** Keys that hold a Private-Cloud credential, cleared on its Disconnect (F8-FR5). */
export const PRIVATE_CLOUD_KEYS: readonly string[] = [
  StorageKeys.privateToken,
  StorageKeys.privateAccount,
  StorageKeys.privateSessionExpired,
];

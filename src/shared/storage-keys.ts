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

  // Capture/send settings (F7) — declared here for the single contract; written in F7.
  defaultMode: 'settings.defaultMode',
  defaultFormat: 'settings.defaultFormat',
  target: 'settings.target',
  cloudFolderId: 'settings.cloudFolderId',
  confirmFilename: 'settings.confirmFilename',

  // Private Cloud (F8).
  privateBaseUrl: 'privatecloud.baseUrl',
  privateAccount: 'privatecloud.account',
  privateToken: 'privatecloud.token',
  privateFolderId: 'privatecloud.folderId',

  // Jobs (F9).
  pendingJobs: 'jobs.pending',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

/** Keys that hold a public-Cloud credential/identity, cleared on Disconnect (F2-FR5). */
export const PUBLIC_CLOUD_KEYS: readonly string[] = [
  StorageKeys.token,
  StorageKeys.account,
  StorageKeys.equipment,
];

/** Keys that hold a Private-Cloud credential, cleared on its Disconnect (F8-FR5). */
export const PRIVATE_CLOUD_KEYS: readonly string[] = [
  StorageKeys.privateToken,
  StorageKeys.privateAccount,
];

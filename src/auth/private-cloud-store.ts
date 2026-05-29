/**
 * Private Cloud credential store (F8) — read/clear the JWT, base URL, account
 * and folder via the KeyValueStore. JWT-only (D-2); the password is never here.
 * Mirrors TokenStore for the private target so the saga/options read uniformly.
 */
import type { KeyValueStore } from '@shared/ports';
import { StorageKeys } from '@shared/storage-keys';
import type { Token } from '@domain/auth';

export class PrivateCloudStore {
  constructor(private readonly store: KeyValueStore) {}

  getToken(): Promise<Token | undefined> {
    return this.store.get<Token>(StorageKeys.privateToken);
  }

  getBaseUrl(): Promise<string | undefined> {
    return this.store.get<string>(StorageKeys.privateBaseUrl);
  }

  getAccount(): Promise<string | undefined> {
    return this.store.get<string>(StorageKeys.privateAccount);
  }

  getFolderId(): Promise<string | undefined> {
    return this.store.get<string>(StorageKeys.privateFolderId);
  }

  /** Clear only the JWT (session expired) — keep baseUrl/account for re-login prefill. */
  async clearToken(): Promise<void> {
    await this.store.remove(StorageKeys.privateToken);
  }
}

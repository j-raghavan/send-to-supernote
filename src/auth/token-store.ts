/**
 * Public-Cloud token store (F2) — persist/read/clear the derived token and
 * account/equipment via the KeyValueStore port. The ONLY Supernote credential
 * persisted is the token (D-2); the password is never written here.
 */
import type { KeyValueStore } from '@shared/ports';
import { StorageKeys } from '@shared/storage-keys';
import type { Token } from '@domain/auth';

export interface StoredAccount {
  token: Token;
  /** Account email, when known. Absent for the cookie-capture cloud connect. */
  account?: string;
  equipment: string;
}

export class TokenStore {
  constructor(private readonly store: KeyValueStore) {}

  /** Persist the token, account (when known), and equipment after a connect. */
  async save(stored: StoredAccount): Promise<void> {
    await this.store.set(StorageKeys.token, stored.token);
    if (stored.account !== undefined) {
      await this.store.set(StorageKeys.account, stored.account);
    }
    await this.store.set(StorageKeys.equipment, stored.equipment);
  }

  /** The current token, or undefined when disconnected/expired. */
  getToken(): Promise<Token | undefined> {
    return this.store.get<Token>(StorageKeys.token);
  }

  /** The connected account email (for display + re-login prefill). */
  getAccount(): Promise<string | undefined> {
    return this.store.get<string>(StorageKeys.account);
  }

  /** The stable equipment id, if one has been generated. */
  getEquipment(): Promise<string | undefined> {
    return this.store.get<string>(StorageKeys.equipment);
  }

  /** Clear only the token (session expired) — keep account/equipment for re-login prefill. */
  async clearToken(): Promise<void> {
    await this.store.remove(StorageKeys.token);
  }
}

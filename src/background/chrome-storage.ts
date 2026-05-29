/**
 * ChromeStorageLocal (Data Model, I-5) — KeyValueStore over `chrome.storage.local`.
 *
 * The ONLY storage adapter, hardcoded to `chrome.storage.local`. It NEVER
 * touches `chrome.storage.sync` — secrets must not propagate across machines
 * (I-5/D-2). A guard test asserts this file uses `.local` and never `.sync`.
 * Thin glue (coverage-excluded, architecture §9.3); all decision logic lives in
 * the settings/auth use cases.
 */
/* c8 ignore start */
import type { KeyValueStore } from '@shared/ports';
import { api } from '@shared/browser-api';

export class ChromeStorageLocal implements KeyValueStore {
  private get area(): chrome.storage.LocalStorageArea {
    // chrome.storage.local ONLY — never chrome.storage.sync (I-5).
    return api.storage.local;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const result = await this.area.get(key);
    return result[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.area.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }

  async keys(): Promise<string[]> {
    const all = await this.area.get(null);
    return Object.keys(all);
  }
}
/* c8 ignore stop */

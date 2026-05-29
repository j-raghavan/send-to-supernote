import type { KeyValueStore } from '@shared/ports';

/**
 * In-memory KeyValueStore for tests. Models `chrome.storage.local` semantics;
 * there is intentionally no `sync` surface (I-5). Values are JSON-cloned so
 * tests cannot accidentally share references with stored state.
 */
export class FakeKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    return Promise.resolve(raw === undefined ? undefined : (JSON.parse(raw) as T));
  }

  set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.map.keys()]);
  }

  /** Raw serialized snapshot of everything stored (for secret-absence assertions). */
  snapshot(): string {
    return JSON.stringify([...this.map.entries()]);
  }
}

/**
 * ChromeCookieReader — CookieReader port over `chrome.cookies`. THIN glue:
 *  - `getAll` reads every `x-access-token`-style cookie for a domain (+ subdomains)
 *    in one cookie store (so the connect flow finds the session on `cloud.` OR
 *    `viewer.supernote.com`);
 *  - `listStoreIds` / `storeIdForTab` enumerate cookie stores so the flow can read
 *    the SAME store the user signed in on — the default profile, an Incognito
 *    profile (Chrome), or a container/private store (Firefox).
 * Coverage-excluded (architecture §9.3).
 */
/* c8 ignore start */
import type { CookieQuery, CookieReader } from '@shared/ports';
import { api } from '@shared/browser-api';

export class ChromeCookieReader implements CookieReader {
  async getAll(q: CookieQuery): Promise<string[]> {
    const cookies = await api.cookies.getAll({
      domain: q.domain,
      name: q.name,
      ...(q.storeId !== undefined ? { storeId: q.storeId } : {}),
    });
    return cookies.map((c) => c.value).filter((v) => v.length > 0);
  }

  async listStoreIds(): Promise<string[]> {
    const stores = await api.cookies.getAllCookieStores();
    return stores.map((s) => s.id);
  }

  async storeIdForTab(tabId: number): Promise<string | undefined> {
    const stores = await api.cookies.getAllCookieStores();
    return stores.find((s) => s.tabIds.includes(tabId))?.id;
  }
}
/* c8 ignore stop */

/**
 * ChromeTabController — TabController port over `chrome.tabs`. THIN glue: opens
 * the official login page and closes it once the session cookie is captured.
 * Coverage-excluded (architecture §9.3).
 */
/* c8 ignore start */
import type { OpenedTab, TabController } from '@shared/ports';
import { api } from '@shared/browser-api';

export class ChromeTabController implements TabController {
  async open(url: string): Promise<OpenedTab> {
    const tab = await api.tabs.create({ url });
    // Firefox populates `cookieStoreId` (container/private); Chrome leaves it
    // undefined — the connect flow resolves the store via `storeIdForTab` there.
    const cookieStoreId = (tab as { cookieStoreId?: string }).cookieStoreId;
    return {
      ...(tab.id !== undefined ? { id: tab.id } : {}),
      ...(cookieStoreId !== undefined ? { cookieStoreId } : {}),
    };
  }

  async close(tabId: number): Promise<void> {
    try {
      await api.tabs.remove(tabId);
    } catch {
      // Tab already closed by the user — nothing to do.
    }
  }
}
/* c8 ignore stop */

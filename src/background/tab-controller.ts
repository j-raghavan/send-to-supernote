/**
 * ChromeTabController — TabController port over `chrome.tabs`. THIN glue: opens
 * the official login page and closes it once the session cookie is captured.
 * Coverage-excluded (architecture §9.3).
 */
/* c8 ignore start */
import type { TabController } from '@shared/ports';
import { api } from '@shared/browser-api';

export class ChromeTabController implements TabController {
  async open(url: string): Promise<number | undefined> {
    const tab = await api.tabs.create({ url });
    return tab.id;
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

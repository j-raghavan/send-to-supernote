/**
 * ChromeOptionsOpener (F2-FR4) — OptionsOpener port over chrome.runtime. THIN
 * glue: opens the options page, optionally appending the account to prefill the
 * re-connect form. Coverage-excluded.
 */
/* c8 ignore start */
import type { OptionsOpener } from '@shared/ports';
import { api } from '@shared/browser-api';

export class ChromeOptionsOpener implements OptionsOpener {
  open(prefillAccount?: string): Promise<void> {
    const base = api.runtime.getURL('src/options/options.html');
    const url = prefillAccount ? `${base}?account=${encodeURIComponent(prefillAccount)}` : base;
    return new Promise((resolve) => {
      api.tabs.create({ url }, () => resolve());
    });
  }
}
/* c8 ignore stop */

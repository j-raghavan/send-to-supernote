/**
 * ChromeOffscreenHost (F1-FR5) — OffscreenHost port over chrome.offscreen. THIN
 * glue: the single-instance/retry policy lives in the covered OffscreenManager.
 * Coverage-excluded.
 */
/* c8 ignore start */
import type { OffscreenHost, OffscreenReason } from '@shared/ports';

export class ChromeOffscreenHost implements OffscreenHost {
  async exists(): Promise<boolean> {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    return contexts.length > 0;
  }

  async create(url: string, reasons: OffscreenReason[], justification: string): Promise<void> {
    await chrome.offscreen.createDocument({
      url,
      reasons,
      justification,
    });
  }

  async close(): Promise<void> {
    await chrome.offscreen.closeDocument();
  }
}
/* c8 ignore stop */

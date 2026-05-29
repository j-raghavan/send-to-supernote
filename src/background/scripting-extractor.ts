/**
 * ScriptingExtractor (F3/F4) — Extractor port over chrome.scripting.
 *
 * CRITICAL MV3 constraint: a `func` passed to `chrome.scripting.executeScript`
 * is serialized into the PAGE, so it must be fully self-contained — it canNOT
 * reference any bundled import (those live only in this SW bundle and are
 * undefined in the page). So the page only does what plain DOM can do: return
 * its rendered HTML. Full Page needs nothing more. Reader needs Readability,
 * which is not in the page, so the raw HTML is handed to the offscreen document
 * (which has a DOM + bundled Readability) to parse. Coverage-excluded.
 */
/* c8 ignore start */
import type { Extractor } from '@shared/ports';
import type { ReaderExtract } from '@domain/capture';
import type { OffscreenReaderExtractor } from './offscreen-reader';

export class ScriptingExtractor implements Extractor {
  constructor(
    private readonly tabId: number,
    private readonly reader: OffscreenReaderExtractor,
  ) {}

  async extractReader(): Promise<ReaderExtract> {
    // Self-contained page capture (no bundled imports), then parse off-page.
    const raw = await this.run(() => ({
      html: document.documentElement.outerHTML,
      url: document.baseURI,
    }));
    console.warn(`[send-to-supernote] captured html: ${raw.html.length} chars from ${raw.url}`);
    return this.reader.extract(raw.html, raw.url);
  }

  private async run<T>(func: () => T): Promise<T> {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
    });
    const result = injection?.result;
    if (result === null || result === undefined) {
      throw new Error('Could not read this page (the browser blocked the capture script).');
    }
    return result as T;
  }
}
/* c8 ignore stop */

/**
 * ScriptingExtractor (F3/F4) — Extractor port over chrome.scripting. THIN glue:
 * injects the (c8-ignored) DOM extractors into the active tab and returns their
 * result. The clone-only (I-4) and serialization logic live in content/reader.ts
 * and content/fullpage.ts; the decisions live in the capture use cases.
 * Coverage-excluded.
 */
/* c8 ignore start */
import type { Extractor } from '@shared/ports';
import type { FullPageExtract, ReaderExtract } from '@domain/capture';
import { extractReaderFromDocument } from '../content/reader';
import { serializeFullPageFromDocument } from '../content/fullpage';

export class ScriptingExtractor implements Extractor {
  constructor(private readonly tabId: number) {}

  async extractReader(): Promise<ReaderExtract> {
    return this.run(() => extractReaderFromDocument(document));
  }

  async serializeFullPage(): Promise<FullPageExtract> {
    return this.run(() => serializeFullPageFromDocument(document));
  }

  private async run<T>(func: () => T): Promise<T> {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
    });
    return injection?.result as T;
  }
}
/* c8 ignore stop */

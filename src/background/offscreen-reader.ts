/**
 * OffscreenReaderExtractor (F3-FR1) — runs Mozilla Readability in the OFFSCREEN
 * document, not the page. A `chrome.scripting.executeScript` `func` is serialized
 * into the page and cannot reference bundled imports (Readability lives only in
 * this extension's bundles), so Reader extraction cannot run via `func`. Instead
 * the page hands back its raw rendered HTML (self-contained capture) and this
 * bridge forwards it to the offscreen document — which HAS a DOM and the bundled
 * Readability — to parse. THIN glue mirroring OffscreenRenderer. Coverage-excluded.
 */
/* c8 ignore start */
import type { ReaderExtract } from '@domain/capture';
import type { ReaderParser } from './reader-parser';
import type { OffscreenManager } from './offscreen-manager';

export interface ReaderExtractMessage {
  type: 'extract-reader';
  html: string;
  /** Original page URL, so relative links/images resolve during parsing. */
  url: string;
}

export class OffscreenReaderExtractor implements ReaderParser {
  constructor(private readonly manager: OffscreenManager) {}

  async extract(html: string, url: string): Promise<ReaderExtract> {
    const ensured = await this.manager.ensure();
    if (!ensured.ok) {
      throw new Error('Could not create the offscreen reader.');
    }
    const message: ReaderExtractMessage = { type: 'extract-reader', html, url };
    const reply: unknown = await chrome.runtime.sendMessage(message);
    await this.manager.release();
    if (reply === undefined || reply === null) {
      throw new Error('Reader extraction returned no result.');
    }
    const extract = reply as ReaderExtract;
    // Log the real HTML size (extract.content.length) — extract.length is only
    // Readability's approximate TEXT-length estimate, which understates the
    // captured content and previously read as a misleading "chars" count.
    console.warn(
      `[send-to-supernote] reader extract: ${extract.content.length} html chars, "${extract.title}"`,
    );
    return extract;
  }
}
/* c8 ignore stop */

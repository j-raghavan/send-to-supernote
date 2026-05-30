/**
 * DirectReaderParser (FF2-FR4, FF2-AC5, I-F7) — the Firefox reader-parse adapter.
 *
 * Implements the narrow `ReaderParser` port by delegating, in-page (the
 * DOM-capable event page), to the shared `parseReader` from `render-parse-core`
 * — no offscreen document, no cross-context messaging. It holds NO copy of the
 * parse logic (DOMParser + `<base>` inject + Readability + the Readability-miss
 * body fallback all live once in the core — DRY); this adapter is pure delegation.
 * On Chrome the equivalent collaborator is `OffscreenReaderExtractor`; the
 * `ScriptingExtractor` page-capture step is identical across targets (I-F4).
 */
import type { ReaderExtract } from '@domain/capture';
import { parseReader } from '@conversion/render-parse-core';
import type { ReaderParser } from './reader-parser';

export class DirectReaderParser implements ReaderParser {
  extract(html: string, url: string): Promise<ReaderExtract> {
    return Promise.resolve(parseReader(html, url));
  }
}

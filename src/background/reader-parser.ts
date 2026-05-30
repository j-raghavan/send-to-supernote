/**
 * ReaderParser port (FF2-FR3, I-F1, ADR-FIREFOX-PORT D1) — the narrow interface
 * `ScriptingExtractor` depends on for the reader-parse collaborator (SOLID-ISP).
 *
 * It lives here, in `src/background/`, NOT in `src/shared/ports.ts`, so the frozen
 * `ports.ts` interfaces stay untouched by the Firefox port (I-F1 — `ports.ts`
 * changes are optional and avoided). The page-capture step of reader extraction is
 * API-compatible across Chrome and Firefox and is kept verbatim; only this parser
 * collaborator swaps per target (I-F4): `OffscreenReaderExtractor` on Chrome
 * (messages the offscreen document), `DirectReaderParser` on Firefox (parses
 * in-page). Both `extract(html, url)` to a `ReaderExtract`.
 */
import type { ReaderExtract } from '@domain/capture';

export interface ReaderParser {
  /** Parse captured page HTML (with its original URL) into a reader extract. */
  extract(html: string, url: string): Promise<ReaderExtract>;
}

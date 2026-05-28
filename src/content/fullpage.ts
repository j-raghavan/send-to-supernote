/**
 * Full Page serialization adapter (F4-FR2) — THIN content-script shell.
 *
 * Serializes the rendered page (outerHTML of the document element) for Full Page
 * capture. Best-effort; the rasterization/tiling/scroll decisions are the
 * covered domain (fullpage-layout) and the offscreen canvas adapter. No decision
 * logic here. Coverage-excluded (architecture §9.3): requires a real DOM.
 */
/* c8 ignore start */
import type { FullPageExtract } from '@domain/capture';

/** Serialize the live document's rendered markup for Full Page capture. */
export function serializeFullPageFromDocument(doc: Document): FullPageExtract {
  return {
    title: doc.title,
    html: doc.documentElement.outerHTML,
  };
}
/* c8 ignore stop */

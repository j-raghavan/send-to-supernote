/**
 * Reader extraction adapter (F3-FR1, I-4) — THIN content-script shell.
 *
 * Implements only the DOM-bound primitive: clone the live document and run
 * Mozilla Readability on the CLONE so the user's page is never mutated (I-4).
 * It contains NO decision logic (emptiness, naming, conversion) — that lives in
 * the covered `capture/` use cases and `domain/capture`. Coverage-excluded
 * (architecture §9.3): requires a real DOM and the bundled Readability.
 */
/* c8 ignore start */
import { Readability } from '@mozilla/readability';
import type { ReaderExtract } from '@domain/capture';

/** Run Readability against a clone of the live document (never the original). */
export function extractReaderFromDocument(doc: Document): ReaderExtract {
  const clone = doc.cloneNode(true) as Document;
  const article = new Readability(clone).parse();
  return {
    title: article?.title ?? doc.title,
    ...(article?.byline ? { byline: article.byline } : {}),
    content: article?.content ?? '',
    ...(article?.excerpt ? { excerpt: article.excerpt } : {}),
    length: article?.length ?? 0,
  };
}
/* c8 ignore stop */

/**
 * CaptureReader use case (F3-FR1 / F3-FR5).
 *
 * Runs the Extractor's Readability pass (which the adapter performs on a DOM
 * CLONE so the live page is never mutated — I-4) and normalizes the result into
 * a CapturedDocument. If extraction yields no usable content it returns an
 * actionable error rather than an empty document (F3-FR5 / no empty upload).
 * (The offscreen adapter already falls back to the page body when Readability
 * finds no article, so this fires only for genuinely empty pages.)
 */
import { err, ok, type Result } from '@shared/result';
import type { Extractor } from '@shared/ports';
import { type CapturedDocument, isEmptyReaderExtract } from '@domain/capture';

export type CaptureErrorKind = 'empty-article' | 'extraction-failed';

export interface CaptureError {
  kind: CaptureErrorKind;
  message: string;
}

export interface CaptureReaderDeps {
  extractor: Extractor;
}

/** Capture the active tab in Reader View. */
export async function captureReader(
  deps: CaptureReaderDeps,
  includeImages: boolean,
): Promise<Result<CapturedDocument, CaptureError>> {
  let extract;
  try {
    extract = await deps.extractor.extractReader(includeImages);
  } catch {
    return err({
      kind: 'extraction-failed',
      message: "Couldn't read this page.",
    });
  }

  if (isEmptyReaderExtract(extract)) {
    return err({
      kind: 'empty-article',
      message: "This page doesn't have readable content to send — try Full Page instead.",
    });
  }

  const captured: CapturedDocument = {
    mode: 'reader',
    title: extract.title,
    html: extract.content,
    ...(extract.byline !== undefined ? { byline: extract.byline } : {}),
  };
  return ok(captured);
}

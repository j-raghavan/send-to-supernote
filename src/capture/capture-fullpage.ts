/**
 * CaptureFullPage use case (F4-FR2).
 *
 * Runs the Extractor's full-page serialization (rendered DOM + relevant styles)
 * and normalizes it into a CapturedDocument (mode = "fullpage"). Unlike Reader,
 * Full Page does not reject "non-article" pages — it is best-effort (F4-FR5) —
 * but an extractor failure surfaces an actionable error instead of an empty
 * document. The rasterization to a paginated PDF happens in conversion.
 */
import { err, ok, type Result } from '@shared/result';
import type { Extractor } from '@shared/ports';
import type { CapturedDocument } from '@domain/capture';
import type { CaptureError } from './capture-reader';

export interface CaptureFullPageDeps {
  extractor: Extractor;
}

/** Capture the active tab in Full Page mode. */
export async function captureFullPage(
  deps: CaptureFullPageDeps,
): Promise<Result<CapturedDocument, CaptureError>> {
  let extract;
  try {
    extract = await deps.extractor.serializeFullPage();
  } catch {
    return err({
      kind: 'extraction-failed',
      message: 'Could not capture this page. Please retry.',
    });
  }

  if (extract.html.trim().length === 0) {
    return err({ kind: 'extraction-failed', message: 'This page produced no content to capture.' });
  }

  const captured: CapturedDocument = {
    mode: 'fullpage',
    title: extract.title,
    html: extract.html,
  };
  return ok(captured);
}

/**
 * Derive the upload filename for a captured document (F3-FR6, wires F6-FR3).
 *
 * Bridges capture -> naming: take the captured document's title (or the
 * hostname/date fallback) and the chosen format, then de-duplicate against the
 * destination folder's existing names. Pure; reuses the F6-FR3 pipeline.
 */
import { buildUploadFilename } from '@shared/filename';
import type { OutputFormat } from '@domain/conversion';
import type { CapturedDocument } from '@domain/capture';

export interface DeriveFilenameParams {
  document: CapturedDocument;
  format: OutputFormat;
  hostname: string;
  epochMs: number;
  existingNames: readonly string[];
}

/** Compute the destination filename for a captured document. */
export function deriveFilename(params: DeriveFilenameParams): string {
  return buildUploadFilename({
    title: params.document.title,
    hostname: params.hostname,
    epochMs: params.epochMs,
    format: params.format,
    existingNames: params.existingNames,
  });
}

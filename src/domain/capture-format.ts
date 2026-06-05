/**
 * Capture-mode → allowed output-format authority (Issue 3). Single source of
 * truth so the saga, resolve-send-request, and the Options UI agree on which
 * formats a mode permits. Pure; covered. Phase 3 adds the 'fullpage-html' entry
 * additively.
 */
import type { CaptureMode } from '@domain/capture';
import type { OutputFormat } from '@domain/conversion';

const FORMATS_BY_MODE: Record<CaptureMode, readonly OutputFormat[]> = {
  reader: ['pdf', 'epub'],
  fullpage: ['pdf'],
  'fullpage-html': ['pdf', 'epub'],
};

export function allowedFormats(mode: CaptureMode): readonly OutputFormat[] {
  return FORMATS_BY_MODE[mode];
}

export function isFormatAllowed(mode: CaptureMode, format: OutputFormat): boolean {
  return FORMATS_BY_MODE[mode].includes(format);
}

/** The requested format if the mode allows it, else the mode's first allowed format (pdf for the screenshot mode). */
export function coerceFormat(mode: CaptureMode, format: OutputFormat): OutputFormat {
  return isFormatAllowed(mode, format) ? format : FORMATS_BY_MODE[mode][0]!;
}

/**
 * Capture-mode UI copy (F4-FR5).
 *
 * Centralized, testable strings (not buried in the excluded UI shells) so the
 * popup/options can label the capture consistently.
 */
import type { CaptureMode } from '@domain/capture';

export const CAPTURE_MODE_LABELS: Record<CaptureMode, string> = {
  reader: 'Reader View',
  fullpage: 'Full Page (Image)',
  'fullpage-html': 'Full Page (HTML)',
};

export const CAPTURE_MODE_DESCRIPTIONS: Record<CaptureMode, string> = {
  reader: 'A clean, reflow-friendly article — recommended for text.',
  fullpage:
    'An exact image of the page as-is — PDF only (best for fixed layouts and very tall pages).',
  'fullpage-html':
    'The whole page as reflowable HTML with inlined images — selectable text, EPUB or PDF.',
};

/** The label for a capture mode (e.g. for a menu/toggle). */
export function captureModeLabel(mode: CaptureMode): string {
  return CAPTURE_MODE_LABELS[mode];
}

/** The expectation-setting description for a capture mode. */
export function captureModeDescription(mode: CaptureMode): string {
  return CAPTURE_MODE_DESCRIPTIONS[mode];
}

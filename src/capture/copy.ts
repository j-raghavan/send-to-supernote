/**
 * Capture-mode UI copy (F4-FR5).
 *
 * Centralized, testable strings (not buried in the excluded UI shells) so the
 * popup/options can label the capture consistently.
 */
import type { CaptureMode } from '@domain/capture';

export const CAPTURE_MODE_LABELS: Record<CaptureMode, string> = {
  reader: 'Reader View',
  fullpage: 'Full Page',
};

export const CAPTURE_MODE_DESCRIPTIONS: Record<CaptureMode, string> = {
  reader: 'A clean, reflow-friendly article — recommended for text.',
  fullpage: 'Captures the page as-is (best-effort at fixed banners and very tall pages).',
};

/** The label for a capture mode (e.g. for a menu/toggle). */
export function captureModeLabel(mode: CaptureMode): string {
  return CAPTURE_MODE_LABELS[mode];
}

/** The expectation-setting description for a capture mode. */
export function captureModeDescription(mode: CaptureMode): string {
  return CAPTURE_MODE_DESCRIPTIONS[mode];
}

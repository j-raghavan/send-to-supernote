import { describe, expect, it } from 'vitest';
import { captureModeDescription, captureModeLabel } from '../../../src/capture/copy';

describe('capture-mode copy (F4-FR5)', () => {
  it('labels Reader View', () => {
    expect(captureModeLabel('reader')).toBe('Reader View');
  });

  it('recommends Reader View for text', () => {
    expect(captureModeDescription('reader').toLowerCase()).toContain('recommended');
  });

  it('labels Full Page (FP1-FR1)', () => {
    expect(captureModeLabel('fullpage')).toBe('Full Page');
  });

  it('describes Full Page with the best-effort disclosure (FP1-FR1)', () => {
    expect(captureModeDescription('fullpage')).toBe(
      'Captures the page as-is (best-effort at fixed banners and very tall pages).',
    );
  });
});

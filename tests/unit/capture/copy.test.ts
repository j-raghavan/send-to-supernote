import { describe, expect, it } from 'vitest';
import { captureModeDescription, captureModeLabel } from '../../../src/capture/copy';

describe('capture-mode copy (F4-FR5)', () => {
  it('labels Reader View', () => {
    expect(captureModeLabel('reader')).toBe('Reader View');
  });

  it('recommends Reader View for text', () => {
    expect(captureModeDescription('reader').toLowerCase()).toContain('recommended');
  });

  it('labels Full Page (Image) (Phase 3)', () => {
    expect(captureModeLabel('fullpage')).toBe('Full Page (Image)');
  });

  it('describes the Full Page (Image) mode as a PDF-only image of the page', () => {
    const desc = captureModeDescription('fullpage');
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toContain('PDF only');
  });

  it('labels Full Page (HTML) (Phase 3)', () => {
    expect(captureModeLabel('fullpage-html')).toBe('Full Page (HTML)');
  });

  it('describes the Full Page (HTML) mode as reflowable EPUB-capable HTML (Phase 3)', () => {
    const desc = captureModeDescription('fullpage-html');
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.toLowerCase()).toMatch(/epub|reflowable/);
  });
});

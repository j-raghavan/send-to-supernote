import { describe, expect, it } from 'vitest';
import { captureModeDescription, captureModeLabel } from '../../../src/capture/copy';

describe('capture-mode copy (F4-FR5)', () => {
  it('labels Reader View', () => {
    expect(captureModeLabel('reader')).toBe('Reader View');
  });

  it('recommends Reader View for text', () => {
    expect(captureModeDescription('reader').toLowerCase()).toContain('recommended');
  });

  it('labels Full Page', () => {
    expect(captureModeLabel('fullpage')).toBe('Full Page');
  });

  it('describes the Full Page mode', () => {
    const desc = captureModeDescription('fullpage');
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.toLowerCase()).toContain('page');
  });
});

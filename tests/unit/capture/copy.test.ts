import { describe, expect, it } from 'vitest';
import { captureModeDescription, captureModeLabel } from '../../../src/capture/copy';

describe('capture-mode copy (F4-FR5)', () => {
  it('labels Reader View', () => {
    expect(captureModeLabel('reader')).toBe('Reader View');
  });

  it('recommends Reader View for text', () => {
    expect(captureModeDescription('reader').toLowerCase()).toContain('recommended');
  });
});

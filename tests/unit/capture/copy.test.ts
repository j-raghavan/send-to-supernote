import { describe, expect, it } from 'vitest';
import { captureModeDescription, captureModeLabel } from '../../../src/capture/copy';

describe('capture-mode copy (F4-FR5)', () => {
  it('labels the two modes', () => {
    expect(captureModeLabel('reader')).toBe('Reader View');
    expect(captureModeLabel('fullpage')).toBe('Full Page');
  });

  it('labels Full Page as best-effort layout capture (sets fidelity expectations)', () => {
    expect(captureModeDescription('fullpage').toLowerCase()).toContain('best-effort');
    expect(captureModeDescription('fullpage').toLowerCase()).toContain('limited');
  });

  it('recommends Reader View for text', () => {
    expect(captureModeDescription('reader').toLowerCase()).toContain('recommended');
  });
});

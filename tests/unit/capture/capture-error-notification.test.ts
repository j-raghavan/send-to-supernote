import { describe, expect, it } from 'vitest';
import { captureErrorNotification } from '../../../src/capture/capture-error-notification';

describe('captureErrorNotification (F3-FR5 / F3-AC4)', () => {
  it('maps an empty-article error to an error notification carrying the message', () => {
    const note = captureErrorNotification({
      kind: 'empty-article',
      message: "Couldn't extract a readable article — try Full Page.",
    });
    expect(note.level).toBe('error');
    expect(note.title).toContain("Couldn't capture");
    expect(note.message).toContain('Full Page');
  });

  it('maps an extraction-failed error the same way', () => {
    const note = captureErrorNotification({
      kind: 'extraction-failed',
      message: "Couldn't read this page. Try Full Page instead.",
    });
    expect(note.level).toBe('error');
    expect(note.message).toContain('Full Page');
  });
});

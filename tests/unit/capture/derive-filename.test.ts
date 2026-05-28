import { describe, expect, it } from 'vitest';
import { deriveFilename } from '../../../src/capture/derive-filename';
import type { CapturedDocument } from '@domain/capture';

const DATE_MS = Date.UTC(2026, 4, 27);

function doc(title: string): CapturedDocument {
  return { mode: 'reader', title, html: '<p>x</p>' };
}

describe('deriveFilename (F3-FR6)', () => {
  it('derives a sanitized, hyphenated PDF name from the title', () => {
    const name = deriveFilename({
      document: doc('How to Train Your Model: A Guide  (2026)'),
      format: 'pdf',
      hostname: 'example.com',
      epochMs: DATE_MS,
      existingNames: [],
    });
    expect(name).toBe('How-to-Train-Your-Model-A-Guide-2026.pdf');
  });

  it('uses the epub extension when the format is epub', () => {
    const name = deriveFilename({
      document: doc('Hello World'),
      format: 'epub',
      hostname: 'example.com',
      epochMs: DATE_MS,
      existingNames: [],
    });
    expect(name).toBe('Hello-World.epub');
  });

  it('falls back to hostname-date for an empty title', () => {
    const name = deriveFilename({
      document: doc('   '),
      format: 'pdf',
      hostname: 'example.com',
      epochMs: DATE_MS,
      existingNames: [],
    });
    expect(name).toBe('example.com-2026-05-27.pdf');
  });

  it('de-duplicates against existing names in the destination', () => {
    const name = deriveFilename({
      document: doc('Guide'),
      format: 'pdf',
      hostname: 'example.com',
      epochMs: DATE_MS,
      existingNames: ['Guide.pdf'],
    });
    expect(name).toBe('Guide-2.pdf');
  });
});

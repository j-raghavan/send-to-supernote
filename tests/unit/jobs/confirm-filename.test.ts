import { describe, expect, it } from 'vitest';
import { confirmFilename } from '@jobs/confirm-filename';

describe('confirmFilename (F6-FR4)', () => {
  it('sanitizes an edited name and applies the extension', () => {
    expect(confirmFilename('My New: Title', 'pdf', 'Suggested.pdf')).toBe('My-New-Title.pdf');
  });

  it('strips a user-typed extension before re-applying it (no double extension)', () => {
    expect(confirmFilename('Report.pdf', 'pdf', 'Suggested.pdf')).toBe('Report.pdf');
  });

  it('strips a case-insensitive typed extension', () => {
    expect(confirmFilename('Report.PDF', 'pdf', 'Suggested.pdf')).toBe('Report.pdf');
  });

  it('applies the epub extension when that is the format', () => {
    expect(confirmFilename('Book', 'epub', 'Suggested.epub')).toBe('Book.epub');
  });

  it('falls back to the suggested name when the edit is empty after sanitization', () => {
    expect(confirmFilename('   ', 'pdf', 'Suggested.pdf')).toBe('Suggested.pdf');
    expect(confirmFilename('/\\:*?', 'pdf', 'Suggested.pdf')).toBe('Suggested.pdf');
  });

  it('does not strip an extension that does not match the format', () => {
    expect(confirmFilename('Report.epub', 'pdf', 'Suggested.pdf')).toBe('Report.epub.pdf');
  });
});

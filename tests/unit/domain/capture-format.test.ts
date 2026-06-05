import { describe, expect, it } from 'vitest';
import { allowedFormats, coerceFormat, isFormatAllowed } from '@domain/capture-format';

describe('capture-format authority (Issue 3)', () => {
  describe('allowedFormats', () => {
    it('reader allows pdf and epub', () => {
      expect(allowedFormats('reader')).toEqual(['pdf', 'epub']);
    });

    it('fullpage allows pdf only', () => {
      expect(allowedFormats('fullpage')).toEqual(['pdf']);
    });

    it('fullpage-html allows pdf and epub (Phase 3)', () => {
      expect(allowedFormats('fullpage-html')).toEqual(['pdf', 'epub']);
    });
  });

  describe('isFormatAllowed', () => {
    it('reader permits both epub and pdf', () => {
      expect(isFormatAllowed('reader', 'epub')).toBe(true);
      expect(isFormatAllowed('reader', 'pdf')).toBe(true);
    });

    it('fullpage permits pdf but not epub', () => {
      expect(isFormatAllowed('fullpage', 'pdf')).toBe(true);
      expect(isFormatAllowed('fullpage', 'epub')).toBe(false);
    });

    it('fullpage-html permits both epub and pdf (Phase 3)', () => {
      expect(isFormatAllowed('fullpage-html', 'epub')).toBe(true);
      expect(isFormatAllowed('fullpage-html', 'pdf')).toBe(true);
    });
  });

  describe('coerceFormat', () => {
    it('honors an allowed reader format', () => {
      expect(coerceFormat('reader', 'epub')).toBe('epub');
      expect(coerceFormat('reader', 'pdf')).toBe('pdf');
    });

    it('coerces a disallowed fullpage epub to pdf (Issue-3 core)', () => {
      expect(coerceFormat('fullpage', 'epub')).toBe('pdf');
    });

    it('leaves an already-allowed fullpage pdf unchanged', () => {
      expect(coerceFormat('fullpage', 'pdf')).toBe('pdf');
    });

    it('honors both formats for fullpage-html (Phase 3)', () => {
      expect(coerceFormat('fullpage-html', 'epub')).toBe('epub');
      expect(coerceFormat('fullpage-html', 'pdf')).toBe('pdf');
    });
  });
});

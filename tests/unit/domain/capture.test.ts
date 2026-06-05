import { describe, expect, it } from 'vitest';
import { isEmptyReaderExtract, type CapturedDocument, type ReaderExtract } from '@domain/capture';

function extract(overrides: Partial<ReaderExtract>): ReaderExtract {
  return { title: 'T', content: '<p>body</p>', length: 500, ...overrides };
}

describe('isEmptyReaderExtract (F3-FR5)', () => {
  it('is false for a normal article', () => {
    expect(isEmptyReaderExtract(extract({}))).toBe(false);
  });

  it('is true when content is blank/whitespace', () => {
    expect(isEmptyReaderExtract(extract({ content: '   ', length: 500 }))).toBe(true);
  });

  it('is true when content is empty', () => {
    expect(isEmptyReaderExtract(extract({ content: '', length: 0 }))).toBe(true);
  });

  it('is true when the length is below the floor', () => {
    expect(isEmptyReaderExtract(extract({ content: '<p>hi</p>', length: 10 }))).toBe(true);
  });

  it('is false right at the length floor', () => {
    expect(isEmptyReaderExtract(extract({ content: '<p>x</p>', length: 50 }))).toBe(false);
  });
});

describe('CapturedDocument shape (Phase 3)', () => {
  it('accepts a fullpage-html captured document', () => {
    const doc: CapturedDocument = {
      mode: 'fullpage-html',
      title: 'Page Title',
      html: '<h1>Page Title</h1><p>body</p>',
    };
    expect(doc.mode).toBe('fullpage-html');
    expect(doc.title).toBe('Page Title');
    expect(doc.html).toContain('<p>body</p>');
  });
});

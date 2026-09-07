/**
 * pdfTitleFromUrl (F6) — pure title derivation for a PDF page sent as-is.
 */
import { describe, expect, it } from 'vitest';
import { pdfTitleFromUrl } from '../../../src/background/pdf-probe';

describe('pdfTitleFromUrl', () => {
  it('uses the last path segment without the .pdf extension', () => {
    expect(pdfTitleFromUrl('https://arxiv.org/pdf/2401.01234v2.pdf')).toBe('2401.01234v2');
    expect(pdfTitleFromUrl('https://x.test/docs/Paper.PDF?dl=1#page=2')).toBe('Paper');
  });

  it('keeps an extension-less last segment (arXiv-style URLs)', () => {
    expect(pdfTitleFromUrl('https://arxiv.org/pdf/2401.01234')).toBe('2401.01234');
  });

  it('ignores trailing slashes', () => {
    expect(pdfTitleFromUrl('https://x.test/a/report.pdf/')).toBe('report');
  });

  it("falls back to 'document' for an empty path or an unparseable URL", () => {
    expect(pdfTitleFromUrl('https://x.test/')).toBe('document');
    expect(pdfTitleFromUrl('not a url')).toBe('document');
  });
});

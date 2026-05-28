import { describe, expect, it } from 'vitest';
import { contentTypeFor, DEFAULT_RENDER_OPTIONS, resolveRenderOptions } from '@domain/conversion';

describe('contentTypeFor', () => {
  it('maps pdf to application/pdf', () => {
    expect(contentTypeFor('pdf')).toBe('application/pdf');
  });

  it('maps epub to application/epub+zip', () => {
    expect(contentTypeFor('epub')).toBe('application/epub+zip');
  });
});

describe('resolveRenderOptions (F3-FR2/FR3, F4-FR2)', () => {
  it('paginates for PDF and defaults to reader (no rasterize)', () => {
    const opts = resolveRenderOptions('pdf');
    expect(opts.format).toBe('pdf');
    expect(opts.paginate).toBe(true);
    expect(opts.pageSize).toBe('a4');
    expect(opts.rasterize).toBe(false);
  });

  it('does not paginate reflowable EPUB', () => {
    expect(resolveRenderOptions('epub').paginate).toBe(false);
  });

  it('rasterizes a Full Page PDF (html2canvas path, F4-FR2)', () => {
    expect(resolveRenderOptions('pdf', 'fullpage').rasterize).toBe(true);
  });

  it('does not rasterize a Reader PDF', () => {
    expect(resolveRenderOptions('pdf', 'reader').rasterize).toBe(false);
  });

  it('never rasterizes EPUB even for full page', () => {
    expect(resolveRenderOptions('epub', 'fullpage').rasterize).toBe(false);
  });

  it('respects an explicit page size', () => {
    expect(resolveRenderOptions('pdf', 'fullpage', 'letter').pageSize).toBe('letter');
  });

  it('defaults to A4 PDF with pagination and no rasterize', () => {
    expect(DEFAULT_RENDER_OPTIONS).toEqual({
      format: 'pdf',
      pageSize: 'a4',
      paginate: true,
      rasterize: false,
    });
  });
});

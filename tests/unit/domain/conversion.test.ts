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

describe('resolveRenderOptions (F3-FR2)', () => {
  it('paginates for PDF and defaults to A4', () => {
    const opts = resolveRenderOptions('pdf');
    expect(opts.format).toBe('pdf');
    expect(opts.paginate).toBe(true);
    expect(opts.pageSize).toBe('a4');
  });

  it('does not paginate reflowable EPUB', () => {
    expect(resolveRenderOptions('epub').paginate).toBe(false);
  });

  it('respects an explicit page size', () => {
    expect(resolveRenderOptions('pdf', 'letter').pageSize).toBe('letter');
  });

  it('defaults includeImages to true (per-send "Include images" on)', () => {
    expect(resolveRenderOptions('pdf').includeImages).toBe(true);
    expect(resolveRenderOptions('epub').includeImages).toBe(true);
  });

  it('respects an explicit includeImages flag', () => {
    expect(resolveRenderOptions('pdf', 'a4', false).includeImages).toBe(false);
    expect(resolveRenderOptions('epub', 'a4', true).includeImages).toBe(true);
  });

  it('defaults to A4 PDF with pagination and images on', () => {
    expect(DEFAULT_RENDER_OPTIONS).toEqual({
      format: 'pdf',
      pageSize: 'a4',
      paginate: true,
      includeImages: true,
    });
  });
});

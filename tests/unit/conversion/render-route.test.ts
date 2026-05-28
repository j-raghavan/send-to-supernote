import { describe, expect, it } from 'vitest';
import { renderRoute } from '@conversion/render-route';
import { resolveRenderOptions } from '@domain/conversion';

describe('renderRoute (F1-FR5/FR6)', () => {
  it('routes EPUB to the epub renderer', () => {
    expect(renderRoute(resolveRenderOptions('epub'))).toBe('epub');
    expect(renderRoute(resolveRenderOptions('epub', 'fullpage'))).toBe('epub');
  });

  it('routes Full Page PDF to the rasterized renderer (html2canvas)', () => {
    expect(renderRoute(resolveRenderOptions('pdf', 'fullpage'))).toBe('pdf-rasterized');
  });

  it('routes Reader PDF to the jsPDF html layout', () => {
    expect(renderRoute(resolveRenderOptions('pdf', 'reader'))).toBe('pdf-html');
  });
});

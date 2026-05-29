import { describe, expect, it } from 'vitest';
import { renderRoute } from '@conversion/render-route';
import { resolveRenderOptions } from '@domain/conversion';

describe('renderRoute (F1-FR5/FR6)', () => {
  it('routes EPUB to the epub renderer', () => {
    expect(renderRoute(resolveRenderOptions('epub'))).toBe('epub');
  });

  it('routes PDF to the jsPDF html layout', () => {
    expect(renderRoute(resolveRenderOptions('pdf'))).toBe('pdf-html');
  });
});

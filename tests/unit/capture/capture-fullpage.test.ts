import { describe, expect, it } from 'vitest';
import { captureFullPage } from '../../../src/capture/capture-fullpage';
import { FakeExtractor } from '../../fakes/fake-extractor';

describe('captureFullPage (F4-FR2)', () => {
  it('produces a fullpage CapturedDocument from the serialized page', async () => {
    const extractor = new FakeExtractor(undefined, {
      title: 'Recipe',
      html: '<html><body><h1>Recipe</h1><img src="a.jpg"></body></html>',
    });

    const result = await captureFullPage({ extractor });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('fullpage');
      expect(result.value.title).toBe('Recipe');
      expect(result.value.html).toContain('<h1>Recipe</h1>');
    }
  });

  it('does NOT reject a non-article page (best-effort, F4-FR5)', async () => {
    const extractor = new FakeExtractor(undefined, {
      title: 'Dashboard',
      html: '<div>charts and widgets, no prose</div>',
    });
    const result = await captureFullPage({ extractor });
    expect(result.ok).toBe(true);
  });

  it('returns extraction-failed when the serializer throws', async () => {
    const extractor = new FakeExtractor(undefined, new Error('serialize blew up'));
    const result = await captureFullPage({ extractor });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('extraction-failed');
    }
  });

  it('returns extraction-failed when the serialized html is empty', async () => {
    const extractor = new FakeExtractor(undefined, { title: 'T', html: '   ' });
    const result = await captureFullPage({ extractor });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('extraction-failed');
    }
  });
});

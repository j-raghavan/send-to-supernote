import { describe, expect, it } from 'vitest';
import { captureReader } from '../../../src/capture/capture-reader';
import { FakeExtractor } from '../../fakes/fake-extractor';

describe('captureReader (F3-FR1 / F3-FR5)', () => {
  it('produces a reader CapturedDocument from a normal article', async () => {
    const extractor = new FakeExtractor({
      title: 'My Article',
      byline: 'By Jane',
      content: '<h1>My Article</h1><p>Lorem ipsum dolor sit amet.</p>',
      length: 1200,
    });

    const result = await captureReader({ extractor });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('reader');
      expect(result.value.title).toBe('My Article');
      expect(result.value.html).toContain('Lorem ipsum');
      expect(result.value.byline).toBe('By Jane');
    }
  });

  it('omits byline when the article has none', async () => {
    const extractor = new FakeExtractor({
      title: 'T',
      content: '<p>'.padEnd(60, 'x') + '</p>',
      length: 200,
    });
    const result = await captureReader({ extractor });
    expect(result.ok && result.value.byline).toBeUndefined();
  });

  it('returns empty-article (try Full Page) when extraction yields no article (F3-AC4)', async () => {
    const extractor = new FakeExtractor({ title: 'T', content: '', length: 0 });
    const result = await captureReader({ extractor });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('empty-article');
      expect(result.error.message).toContain('Full Page');
    }
  });

  it('returns extraction-failed when the extractor throws', async () => {
    const extractor = new FakeExtractor(new Error('Readability blew up'));
    const result = await captureReader({ extractor });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('extraction-failed');
      expect(result.error.message).toContain('Full Page');
    }
  });
});

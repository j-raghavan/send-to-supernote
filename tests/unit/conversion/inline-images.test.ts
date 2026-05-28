import { describe, expect, it } from 'vitest';
import { inlineImages, type ImageFetcher } from '../../../src/conversion/inline-images';

const fetchOk: ImageFetcher = (url) => Promise.resolve(`data:image/png;base64,${btoa(url)}`);
const fetchNone: ImageFetcher = () => Promise.resolve(undefined);

describe('inlineImages (F3-FR4 / F3-AC3)', () => {
  it('inlines a fetchable image as a data URI', async () => {
    const html = '<p>hi</p><img src="https://x.com/a.png" alt="a">';
    const result = await inlineImages(html, fetchOk);
    expect(result.inlined).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.html).toContain('data:image/png;base64,');
    expect(result.html).toContain('<p>hi</p>');
    expect(result.html).not.toContain('https://x.com/a.png');
  });

  it('skips (removes) an un-fetchable image without aborting (F3-AC3)', async () => {
    const html = '<p>before</p><img src="https://blocked/x.png"><p>after</p>';
    const result = await inlineImages(html, fetchNone);
    expect(result.inlined).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.html).toBe('<p>before</p><p>after</p>');
  });

  it('keeps an already-inlined data URI without re-fetching', async () => {
    const html = '<img src="data:image/png;base64,AAA">';
    let calls = 0;
    const counting: ImageFetcher = (u) => {
      calls += 1;
      return fetchOk(u);
    };
    const result = await inlineImages(html, counting);
    expect(calls).toBe(0);
    expect(result.inlined).toBe(1);
    expect(result.html).toContain('data:image/png;base64,AAA');
  });

  it('removes an <img> with no/empty src', async () => {
    const html = '<img alt="x"><img src="">';
    const result = await inlineImages(html, fetchOk);
    expect(result.skipped).toBe(2);
    expect(result.html).toBe('');
  });

  it('handles single-quoted src attributes', async () => {
    const html = "<img src='https://x.com/b.png'>";
    const result = await inlineImages(html, fetchOk);
    expect(result.inlined).toBe(1);
    expect(result.html).toContain('data:image/png;base64,');
  });

  it('treats a fetch that throws as a skip (never aborts)', async () => {
    const throwing: ImageFetcher = () => {
      throw new Error('network down');
    };
    const result = await inlineImages('<img src="https://x/y.png">', throwing);
    expect(result.skipped).toBe(1);
    expect(result.html).toBe('');
  });

  it('processes multiple images, mixing inline and skip', async () => {
    const html = '<img src="https://ok/a.png"><img src="https://bad/b.png">';
    const mixed: ImageFetcher = (url) =>
      url.includes('ok') ? fetchOk(url) : Promise.resolve(undefined);
    const result = await inlineImages(html, mixed);
    expect(result.inlined).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('returns the HTML unchanged when there are no images', async () => {
    const html = '<h1>Title</h1><p>No images here.</p>';
    const result = await inlineImages(html, fetchNone);
    expect(result.html).toBe(html);
    expect(result.inlined).toBe(0);
    expect(result.skipped).toBe(0);
  });
});

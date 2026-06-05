/**
 * applyInlinedImages (Issue 1) — pure string transform that rewrites each
 * page-captured `<img>` tag's `src` to its inlined `data:` URI (and strips the
 * now-redundant `srcset`). DOM-free (regex only), so it runs under the default
 * node test env — no happy-dom directive needed.
 *
 * These cases pin the architect rulings: raw-attribute matching with NO URL
 * resolution (relative srcs match verbatim), every duplicate tag is rewritten
 * (not just the first), and rewrites are tag-scoped so a `src="..."` literal
 * outside an `<img>` is never touched.
 */
import { describe, expect, it } from 'vitest';
import { applyInlinedImages, type CapturedImage } from '@conversion/apply-inline-images';

const PNG = 'data:image/png;base64,AAA';

describe('applyInlinedImages', () => {
  it('inlines a single <img> whose absolute src matches a captured image', () => {
    const html = '<img src="https://x/a.png">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(`<img src="${PNG}">`);
    expect(out).toContain(PNG);
    expect(out).not.toContain('https://x/a.png');
  });

  it('inlines a RELATIVE src by raw-attribute match (no URL resolution)', () => {
    const html = '<img src="/a.png">';
    const images: CapturedImage[] = [{ src: '/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(`<img src="${PNG}">`);
    expect(out).not.toContain('"/a.png"');
  });

  it('rewrites BOTH of two identical <img> tags (not just the first occurrence)', () => {
    const html = '<img src="https://x/a.png"><img src="https://x/a.png">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(`<img src="${PNG}"><img src="${PNG}">`);
    expect(out).not.toContain('https://x/a.png');
    // Both occurrences rewritten.
    expect(out.split(PNG).length - 1).toBe(2);
  });

  it('strips srcset from a rewritten <img>', () => {
    const html = '<img src="x" srcset="x 1x, y 2x">';
    const images: CapturedImage[] = [{ src: 'x', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toContain(PNG);
    expect(out).not.toContain('srcset');
  });

  it('leaves an un-captured <img> (src not in images) unchanged', () => {
    const html = '<img src="https://x/other.png">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(html);
  });

  it('leaves an <img> with no src attribute unchanged (undefined-src branch)', () => {
    const html = '<img alt="x">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(html);
  });

  it('leaves an already-data: <img> not present in the images map unchanged', () => {
    const html = '<img src="data:image/png;base64,ZZZ">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(html);
  });

  it('is idempotent: applying twice equals applying once', () => {
    const html = '<p>hi</p><img src="https://x/a.png" srcset="https://x/a.png 1x">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const once = applyInlinedImages(html, images);
    const twice = applyInlinedImages(once, images);

    expect(twice).toBe(once);
  });

  it('returns the HTML unchanged when images is empty (early-return branch)', () => {
    const html = '<img src="https://x/a.png">';

    const out = applyInlinedImages(html, []);

    expect(out).toBe(html);
  });

  it('matches and rewrites a single-quoted src', () => {
    const html = "<img src='https://x/a.png'>";
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toContain(PNG);
    expect(out).not.toContain('https://x/a.png');
  });

  it('is tag-scoped: a matching src="a" inside a <code> block is NOT rewritten', () => {
    const html = '<img src="a"><code>src="a"</code>';
    const images: CapturedImage[] = [{ src: 'a', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    // The <img> tag's src is inlined...
    expect(out).toBe(`<img src="${PNG}"><code>src="a"</code>`);
    // ...and the literal src="a" inside <code> is preserved verbatim.
    expect(out).toContain('<code>src="a"</code>');
  });

  it('matches an entity-encoded src against the decoded captured key (& → &amp;)', () => {
    // outerHTML serializes `&` as `&amp;`, but images are keyed on the DECODED
    // getAttribute('src'). Without entity-decoding, any URL with `&` (most CDN /
    // query-param images) would never match — the Issue-1 regression.
    const html = '<img src="https://cdn.x/p.jpg?w=800&amp;h=600">';
    const images: CapturedImage[] = [{ src: 'https://cdn.x/p.jpg?w=800&h=600', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(`<img src="${PNG}">`);
    expect(out).not.toContain('&amp;');
  });

  it('decodes a numeric entity in the src before matching (&#38; → &)', () => {
    const html = '<img src="https://cdn.x/p.jpg?a=1&#38;b=2">';
    const images: CapturedImage[] = [{ src: 'https://cdn.x/p.jpg?a=1&b=2', dataUri: PNG }];

    expect(applyInlinedImages(html, images)).toBe(`<img src="${PNG}">`);
  });

  it('decodes a hex entity in the src before matching (&#x26; → &)', () => {
    const html = '<img src="https://cdn.x/p.jpg?a=1&#x26;b=2">';
    const images: CapturedImage[] = [{ src: 'https://cdn.x/p.jpg?a=1&b=2', dataUri: PNG }];

    expect(applyInlinedImages(html, images)).toBe(`<img src="${PNG}">`);
  });

  it('decodes the named entities a serializer emits (&lt; &gt; &quot; &apos;)', () => {
    const html = '<img src="x?a=&lt;&gt;&quot;&apos;">';
    const images: CapturedImage[] = [{ src: `x?a=<>"'`, dataUri: PNG }];

    expect(applyInlinedImages(html, images)).toBe(`<img src="${PNG}">`);
  });

  it('matches an <img> even when an earlier attribute value contains a ">"', () => {
    const html = '<img alt="a>b" src="https://x/a.png">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: PNG }];

    const out = applyInlinedImages(html, images);

    expect(out).toContain(PNG);
    expect(out).not.toContain('https://x/a.png');
  });

  it('treats a "$" in the data URI literally (no $-substitution corruption)', () => {
    const weird = 'data:image/png;base64,A$&B$1C';
    const html = '<img src="https://x/a.png">';
    const images: CapturedImage[] = [{ src: 'https://x/a.png', dataUri: weird }];

    expect(applyInlinedImages(html, images)).toBe(`<img src="${weird}">`);
  });

  it('rewrites multiple distinct images each to its own data URI', () => {
    const dataA = 'data:image/png;base64,AAA';
    const dataB = 'data:image/jpeg;base64,BBB';
    const html = '<img src="https://x/a.png"><p>mid</p><img src="https://x/b.jpg">';
    const images: CapturedImage[] = [
      { src: 'https://x/a.png', dataUri: dataA },
      { src: 'https://x/b.jpg', dataUri: dataB },
    ];

    const out = applyInlinedImages(html, images);

    expect(out).toBe(`<img src="${dataA}"><p>mid</p><img src="${dataB}">`);
    expect(out).not.toContain('https://x/a.png');
    expect(out).not.toContain('https://x/b.jpg');
  });
});

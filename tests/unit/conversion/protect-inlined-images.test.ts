// @vitest-environment happy-dom
/**
 * protectInlinedImages — keep capture-inlined `data:` images out of reach of
 * Readability's lazy-image rewrite.
 *
 * Readability's `_fixLazyImages` copies a `data-src`-style URL over the `src` of
 * any <img> whose class contains "lazy" — which would replace the inlined data
 * URI with a remote URL the EPUB step must then drop. The guard removes the
 * `class` from an already-inlined <img> (Readability drops classes from its
 * output anyway) and touches nothing else. Runs under happy-dom for DOMParser.
 */
import { describe, expect, it } from 'vitest';
import { protectInlinedImages } from '@conversion/protect-inlined-images';

const DATA = 'data:image/png;base64,AAAA';

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

describe('protectInlinedImages', () => {
  it('drops the class from a lazysizes-style inlined <img> (class + data-src) and keeps the data: src', () => {
    const doc = parse(
      `<img class="lazyloaded wp-image-9" src="${DATA}" data-src="https://cdn/x.jpg" alt="p">`,
    );

    protectInlinedImages(doc);

    const img = doc.querySelector('img');
    expect(img?.hasAttribute('class')).toBe(false);
    expect(img?.getAttribute('src')).toBe(DATA);
    expect(img?.getAttribute('data-src')).toBe('https://cdn/x.jpg');
    expect(img?.getAttribute('alt')).toBe('p');
  });

  it('matches "lazy" anywhere in the class, case-insensitively (Readability semantics)', () => {
    const doc = parse(
      `<img class="js-LazyLoad" src="${DATA}"><img class="b-lazy" src="${DATA}"><img class="lazy" src="${DATA}">`,
    );

    protectInlinedImages(doc);

    doc.querySelectorAll('img').forEach((img) => expect(img.hasAttribute('class')).toBe(false));
  });

  it('leaves a data: <img> whose class has no "lazy" token untouched', () => {
    const doc = parse(`<img class="figure-img" src="${DATA}">`);

    protectInlinedImages(doc);

    expect(doc.querySelector('img')?.getAttribute('class')).toBe('figure-img');
  });

  it('leaves a remote <img> untouched even with a lazy class (nothing inlined to protect)', () => {
    const doc = parse(
      `<img class="lazyload" src="https://cdn/placeholder.gif" data-src="https://cdn/x.jpg">`,
    );

    protectInlinedImages(doc);

    const img = doc.querySelector('img');
    expect(img?.getAttribute('class')).toBe('lazyload');
    expect(img?.getAttribute('src')).toBe('https://cdn/placeholder.gif');
  });

  it('handles a data: <img> with no class attribute at all', () => {
    const doc = parse(`<img src="${DATA}">`);

    protectInlinedImages(doc);

    expect(doc.querySelector('img')?.hasAttribute('class')).toBe(false);
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(DATA);
  });

  it('is idempotent and scoped to the given root', () => {
    const doc = parse(
      `<div id="a"><img class="lazy" src="${DATA}"></div><div id="b"><img class="lazy" src="${DATA}"></div>`,
    );
    const a = doc.getElementById('a') as HTMLElement;

    protectInlinedImages(a);
    protectInlinedImages(a);

    expect(a.querySelector('img')?.hasAttribute('class')).toBe(false);
    expect(doc.querySelector('#b img')?.getAttribute('class')).toBe('lazy');
  });
});

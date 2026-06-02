// @vitest-environment happy-dom
/**
 * stripRemoteImages (F3-FR3 hardening) — remove undeclared remote image
 * resources from EPUB body HTML so an offline reader does not halt the chapter
 * at an unresolvable `<img>` and drop the rest of the article.
 *
 * Assertions are behavioural: a remote `<img>` embedded in an EPUB chapter must
 * be gone (no external dependency) while the surrounding TEXT survives, and a
 * self-contained `data:` image must be kept. The companion guard pins the actual
 * reported failure mode (text after a remote image disappearing), not an
 * arbitrary string shape. Runs under happy-dom for DOMParser.
 */
import { describe, expect, it } from 'vitest';
import { stripRemoteImages } from '@conversion/strip-remote-images';

describe('stripRemoteImages', () => {
  it('removes a remote <img> while keeping the text before AND after it', () => {
    // The reported shape: prose, a remote lead image, then the rest of the body.
    const raw =
      '<p>Para one</p>' +
      '<figure><img src="https://ichef.bbci.co.uk/news/480/photo.jpg.webp" alt="x" /></figure>' +
      '<p>Para two</p><p>Para three</p>';
    const out = stripRemoteImages(raw);

    expect(out).not.toContain('<img');
    expect(out).not.toContain('ichef.bbci.co.uk');
    expect(out).toContain('Para one');
    expect(out).toContain('Para two'); // the text AFTER the image must survive
    expect(out).toContain('Para three');
  });

  it('keeps a self-contained data: image (no external dependency)', () => {
    const raw = '<p>before</p><img src="data:image/png;base64,AAAA" alt="ok" /><p>after</p>';
    const out = stripRemoteImages(raw);

    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('drops a remote srcset from a kept data: image so the reader cannot prefer it', () => {
    const raw =
      '<img src="data:image/png;base64,AAAA" srcset="https://remote/cdn/p.jpg 1x" alt="ok" />';
    const out = stripRemoteImages(raw);

    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('remote/cdn');
  });

  it('removes <source> elements (responsive remote candidates inside <picture>)', () => {
    const raw =
      '<picture>' +
      '<source srcset="https://remote/cdn/large.webp" type="image/webp" />' +
      '<img src="https://remote/cdn/fallback.jpg" alt="x" />' +
      '</picture><p>caption text</p>';
    const out = stripRemoteImages(raw);

    expect(out).not.toContain('<source');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('remote/cdn');
    expect(out).toContain('caption text');
  });

  it('removes non-data schemes that are not fetchable offline (protocol-relative, blob:)', () => {
    // Pins the allowlist intent: only `data:` is self-contained. Protocol-relative
    // (`//host`) resolves to a remote host, and `blob:` object URLs are dead once
    // packaged — both must be dropped so a later "broaden to any URL" change cannot
    // silently let remote refs back into the EPUB.
    const protocolRelative = stripRemoteImages('<p>a</p><img src="//cdn.example/x.jpg" /><p>b</p>');
    expect(protocolRelative).not.toContain('<img');
    expect(protocolRelative).toContain('a');
    expect(protocolRelative).toContain('b');

    const blobUrl = stripRemoteImages('<img src="blob:https://site/abc-123" />');
    expect(blobUrl).not.toContain('<img');
  });

  it('handles an <img> with no src attribute by removing it (not self-contained)', () => {
    const raw = '<p>text</p><img alt="broken" /><p>more</p>';
    const out = stripRemoteImages(raw);

    expect(out).not.toContain('<img');
    expect(out).toContain('text');
    expect(out).toContain('more');
  });

  it('returns an empty fragment for empty input', () => {
    expect(stripRemoteImages('').trim()).toBe('');
  });

  it('passes image-free HTML through unchanged in content', () => {
    const raw = '<p>just</p><p>text</p>';
    const out = stripRemoteImages(raw);

    expect(out).toContain('just');
    expect(out).toContain('text');
    expect(out).not.toContain('<img');
  });
});

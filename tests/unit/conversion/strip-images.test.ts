// @vitest-environment happy-dom
/**
 * stripImages (per-send "Include images" off) — remove EVERY image from captured
 * HTML, data: AND remote, when the user chose a text-only send.
 *
 * The behavioural contrast with stripRemoteImages is the whole point: where that
 * one KEEPS a self-contained `data:` image (EPUB safety), this one removes it
 * too, because the text-only choice is authoritative. Assertions are behavioural:
 * the image elements are gone while the surrounding text survives. Runs under
 * happy-dom for DOMParser.
 */
import { describe, expect, it } from 'vitest';
import { stripImages } from '@conversion/strip-images';

describe('stripImages', () => {
  it('removes a data: <img> (the key difference vs stripRemoteImages) while keeping surrounding text', () => {
    const raw = '<p>before</p><img src="data:image/png;base64,AAAA" alt="ok" /><p>after</p>';
    const out = stripImages(raw);

    expect(out).not.toContain('<img');
    expect(out).not.toContain('data:image/png;base64,AAAA');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('removes a remote <img> while keeping the text before AND after it', () => {
    const raw =
      '<p>Para one</p>' +
      '<figure><img src="https://ichef.bbci.co.uk/news/480/photo.jpg.webp" alt="x" /></figure>' +
      '<p>Para two</p><p>Para three</p>';
    const out = stripImages(raw);

    expect(out).not.toContain('<img');
    expect(out).not.toContain('ichef.bbci.co.uk');
    expect(out).toContain('Para one');
    expect(out).toContain('Para two');
    expect(out).toContain('Para three');
  });

  it('removes a <picture> with <source> + fallback <img>, keeping the caption', () => {
    const raw =
      '<picture>' +
      '<source srcset="https://remote/cdn/large.webp" type="image/webp" />' +
      '<img src="data:image/png;base64,AAAA" alt="x" />' +
      '</picture><p>caption text</p>';
    const out = stripImages(raw);

    expect(out).not.toContain('<source');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<picture');
    expect(out).not.toContain('data:image/png;base64,AAAA');
    expect(out).not.toContain('remote/cdn');
    expect(out).toContain('caption text');
  });

  it('removes a bare <source> and a bare <picture>', () => {
    const bareSource = stripImages('<p>a</p><source srcset="//cdn/x.webp" /><p>b</p>');
    expect(bareSource).not.toContain('<source');
    expect(bareSource).toContain('a');
    expect(bareSource).toContain('b');

    const barePicture = stripImages('<p>c</p><picture></picture><p>d</p>');
    expect(barePicture).not.toContain('<picture');
    expect(barePicture).toContain('c');
    expect(barePicture).toContain('d');
  });

  it('returns an empty fragment for empty input', () => {
    expect(stripImages('').trim()).toBe('');
  });

  it('passes image-free HTML through unchanged in content', () => {
    const raw = '<p>just</p><p>text</p>';
    const out = stripImages(raw);

    expect(out).toContain('just');
    expect(out).toContain('text');
    expect(out).not.toContain('<img');
  });
});

import { describe, expect, it } from 'vitest';
import { buildEpubFiles, type EpubInput } from '../../../src/conversion/epub-builder';

const input: EpubInput = {
  title: 'My Article',
  bodyHtml: '<p>Lorem ipsum.</p>',
  identifier: 'urn:uuid:1234',
};

describe('buildEpubFiles (F3-FR3 / R-6)', () => {
  it('puts an uncompressed mimetype entry first', () => {
    const files = buildEpubFiles(input);
    expect(files[0]!.path).toBe('mimetype');
    expect(files[0]!.content).toBe('application/epub+zip');
    expect(files[0]!.store).toBe(true);
  });

  it('includes container.xml pointing at content.opf', () => {
    const container = buildEpubFiles(input).find((f) => f.path === 'META-INF/container.xml');
    expect(container?.content).toContain('OEBPS/content.opf');
  });

  it('includes the title and identifier in content.opf metadata', () => {
    const opf = buildEpubFiles(input).find((f) => f.path === 'OEBPS/content.opf');
    expect(opf?.content).toContain('<dc:title>My Article</dc:title>');
    expect(opf?.content).toContain('urn:uuid:1234');
    expect(opf?.content).toContain('<dc:language>en</dc:language>');
  });

  it('embeds the body HTML in the chapter and links the nav', () => {
    const files = buildEpubFiles(input);
    const chapter = files.find((f) => f.path === 'OEBPS/chapter.xhtml');
    const nav = files.find((f) => f.path === 'OEBPS/nav.xhtml');
    expect(chapter?.content).toContain('<p>Lorem ipsum.</p>');
    expect(chapter?.content).toContain('<h1>My Article</h1>');
    expect(nav?.content).toContain('chapter.xhtml');
  });

  it('escapes XML special characters in the title (incl. apostrophe)', () => {
    const opf = buildEpubFiles({ ...input, title: `A & B <c> "d" 'e'` }).find(
      (f) => f.path === 'OEBPS/content.opf',
    );
    expect(opf?.content).toContain('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;');
    expect(opf?.content).not.toContain('A & B <c>');
  });

  it('honors a custom language', () => {
    const opf = buildEpubFiles({ ...input, language: 'fr' }).find(
      (f) => f.path === 'OEBPS/content.opf',
    );
    expect(opf?.content).toContain('<dc:language>fr</dc:language>');
  });

  it('produces exactly the five required files', () => {
    const paths = buildEpubFiles(input).map((f) => f.path);
    expect(paths).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/chapter.xhtml',
    ]);
  });

  describe('provenance (CP5-FR3)', () => {
    const withProvenance: EpubInput = {
      ...input,
      sourceUrl: 'https://example.com/a?x=1&y=2',
      capturedAtIso: '2025-06-15T15:06:40.000Z',
      provenanceHtml: '<aside class="capture-provenance">Source: x</aside>',
    };

    it('writes escaped dc:source and dc:date into content.opf metadata', () => {
      const opf = buildEpubFiles(withProvenance).find((f) => f.path === 'OEBPS/content.opf');
      expect(opf?.content).toContain('<dc:source>https://example.com/a?x=1&amp;y=2</dc:source>');
      expect(opf?.content).toContain('<dc:date>2025-06-15T15:06:40.000Z</dc:date>');
    });

    it('injects the visible header immediately after the <h1> in the chapter', () => {
      const chapter = buildEpubFiles(withProvenance).find((f) => f.path === 'OEBPS/chapter.xhtml');
      expect(chapter?.content).toContain(
        '<h1>My Article</h1><aside class="capture-provenance">Source: x</aside>',
      );
    });

    it('NEVER emits an in-body <meta> (MuPDF 1.17 halt guard)', () => {
      const chapter = buildEpubFiles(withProvenance).find((f) => f.path === 'OEBPS/chapter.xhtml');
      const body = chapter!.content.slice(chapter!.content.indexOf('<body>'));
      expect(body).not.toContain('<meta');
    });

    it('omits dc:source/dc:date and the header when provenance is absent (off-path)', () => {
      const files = buildEpubFiles(input);
      const opf = files.find((f) => f.path === 'OEBPS/content.opf');
      const chapter = files.find((f) => f.path === 'OEBPS/chapter.xhtml');
      expect(opf?.content).not.toContain('<dc:source>');
      expect(opf?.content).not.toContain('<dc:date>');
      expect(chapter?.content).toContain('<h1>My Article</h1><p>Lorem ipsum.</p>');
    });

    it('writes only dc:date when the URL is blank (CP4-FR5 parity)', () => {
      const opf = buildEpubFiles({ ...withProvenance, sourceUrl: '  ' }).find(
        (f) => f.path === 'OEBPS/content.opf',
      );
      expect(opf?.content).not.toContain('<dc:source>');
      expect(opf?.content).toContain('<dc:date>');
    });
  });
});

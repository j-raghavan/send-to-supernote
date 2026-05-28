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
});

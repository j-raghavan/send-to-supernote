/**
 * EPUB structure builder (F3-FR3, R-6) — pure, no zip/DOM.
 *
 * Produces the set of files that make up a minimal valid, reflowable EPUB 3
 * (mimetype, container.xml, content.opf, nav.xhtml, the chapter xhtml) from a
 * title + body HTML. The jszip packing of these files into bytes is the thin
 * offscreen adapter (epub-renderer.ts); this builder is fully unit-testable.
 *
 * Gated by R-6: shipped behind `settings.defaultFormat === "epub"`; on-device
 * EPUB validation is deferred.
 */
import { escapeXml } from './escape-xml';

export interface EpubFile {
  path: string;
  content: string;
  /** mimetype must be stored first and uncompressed per the EPUB spec. */
  store?: boolean;
}

export interface EpubInput {
  title: string;
  bodyHtml: string;
  language?: string;
  /** Stable identifier for the publication (e.g. a UUID). */
  identifier: string;
  /**
   * Capture provenance (CP5). When set, the source URL + capture instant are
   * written as Dublin Core `<dc:source>`/`<dc:date>` in content.opf (NEVER an
   * in-body `<meta>` — MuPDF 1.17 halts on that), and `provenanceHtml` is the
   * pre-built visible header injected after the chapter `<h1>`.
   */
  sourceUrl?: string;
  /** Capture instant for `<dc:date>` (ISO-8601/UTC string). */
  capturedAtIso?: string;
  /** Pre-built, XHTML-safe visible provenance block (from `buildProvenanceHeaderHtml`). */
  provenanceHtml?: string;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function contentOpf(input: EpubInput, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(input.identifier)}</dc:identifier>
    <dc:title>${escapeXml(input.title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>${provenanceMetadata(input)}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;
}

function navXhtml(title: string, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}">
  <head><title>${escapeXml(title)}</title></head>
  <body>
    <nav epub:type="toc"><ol><li><a href="chapter.xhtml">${escapeXml(title)}</a></li></ol></nav>
  </body>
</html>`;
}

function chapterXhtml(input: EpubInput, language: string): string {
  // The visible provenance block (when present) goes immediately after the <h1>
  // title and is pre-built as strict XHTML-safe markup (NOT re-normalized here),
  // so a strict EPUB reader renders it without halting. It is a body element —
  // never an in-body <meta> (MuPDF 1.17 halt; the dc:* metadata is in content.opf).
  const provenance = input.provenanceHtml ?? '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}">
  <head><title>${escapeXml(input.title)}</title></head>
  <body><h1>${escapeXml(input.title)}</h1>${provenance}${input.bodyHtml}</body>
</html>`;
}

/**
 * Dublin Core provenance lines for content.opf `<metadata>` (CP5-FR3). Emitted
 * only when provenance is present; the source URL is escaped and the date is the
 * caller's ISO-8601/UTC string. Returns '' (no-op) when absent — off-path EPUBs
 * are byte-identical to before.
 */
function provenanceMetadata(input: EpubInput): string {
  const lines: string[] = [];
  const url = input.sourceUrl?.trim();
  if (url) {
    lines.push(`\n    <dc:source>${escapeXml(url)}</dc:source>`);
  }
  if (input.capturedAtIso) {
    lines.push(`\n    <dc:date>${escapeXml(input.capturedAtIso)}</dc:date>`);
  }
  return lines.join('');
}

/**
 * Build the ordered file list for a valid reflowable EPUB. The `mimetype` entry
 * is first and marked `store` (uncompressed) as the spec requires.
 */
export function buildEpubFiles(input: EpubInput): EpubFile[] {
  const language = input.language ?? 'en';
  return [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: CONTAINER_XML },
    { path: 'OEBPS/content.opf', content: contentOpf(input, language) },
    { path: 'OEBPS/nav.xhtml', content: navXhtml(input.title, language) },
    { path: 'OEBPS/chapter.xhtml', content: chapterXhtml(input, language) },
  ];
}

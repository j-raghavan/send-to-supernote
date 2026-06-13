// @vitest-environment happy-dom
/**
 * Capture provenance builders (CP4) — pure header/time formatting.
 *
 * Determinism is the whole point: `formatCapturedAt` is fed a fixed epoch + IANA
 * zone so the output is identical on any machine. The visible header must be
 * well-formed XHTML (the EPUB branch injects it un-normalized), so it is parsed
 * as application/xml here (happy-dom DOMParser) to prove a strict reader won't
 * halt. `isoDate` is asserted exactly (it is pure UTC ISO-8601).
 */
import { describe, expect, it } from 'vitest';
import {
  buildProvenanceHeaderHtml,
  formatCapturedAt,
  isoDate,
  provenanceTextLines,
  type Provenance,
} from '@conversion/provenance';

const EPOCH = 1_750_000_000_000; // 2025-06-15T15:06:40.000Z
const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';

const prov = (over: Partial<Provenance> = {}): Provenance => ({
  sourceUrl: 'https://example.com/article?id=7',
  capturedAtMs: EPOCH,
  timeZone: LA,
  ...over,
});

describe('formatCapturedAt (CP4-FR2) — deterministic local time + offset', () => {
  it('is deterministic for a given (epochMs, timeZone)', () => {
    expect(formatCapturedAt(EPOCH, LA)).toBe(formatCapturedAt(EPOCH, LA));
  });

  it('includes the calendar date and a UTC offset label', () => {
    const out = formatCapturedAt(EPOCH, LA);
    expect(out).toMatch(/2025-06-15/);
    expect(out).toContain('(GMT');
  });

  it('renders different zones differently (local time is honored)', () => {
    expect(formatCapturedAt(EPOCH, LA)).not.toBe(formatCapturedAt(EPOCH, TOKYO));
  });

  it('still produces a string when no timeZone is given (host local zone)', () => {
    expect(typeof formatCapturedAt(EPOCH)).toBe('string');
    expect(formatCapturedAt(EPOCH).length).toBeGreaterThan(0);
  });
});

describe('isoDate (CP5-FR4) — UTC ISO-8601 for dc:date', () => {
  it('returns the exact UTC instant regardless of the header zone', () => {
    expect(isoDate(EPOCH)).toBe('2025-06-15T15:06:40.000Z');
  });
});

describe('buildProvenanceHeaderHtml (CP4-FR3) — XHTML-safe visible header', () => {
  it('renders a well-formed XHTML fragment (no parser error)', () => {
    const xml = `<root xmlns="http://www.w3.org/1999/xhtml">${buildProvenanceHeaderHtml(prov())}</root>`;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });

  it('uses ONLY numeric character references, never named HTML entities (strict-XML/MuPDF guard)', () => {
    // EPUB content is strict XML with no DOCTYPE, so a named entity like
    // `&middot;` is undefined and halts a conformant reader. happy-dom's DOMParser
    // is lenient and would not catch this — assert directly that no named entity
    // (other than the 5 predefined XML ones) leaks. `&#NNN;` numeric refs are OK.
    const html = buildProvenanceHeaderHtml(prov());
    const named = html.match(/&[a-z][a-z0-9]*;/gi) ?? [];
    const predefined = new Set(['&amp;', '&lt;', '&gt;', '&quot;', '&apos;']);
    expect(named.filter((e) => !predefined.has(e.toLowerCase()))).toEqual([]);
  });

  it('escapes XML-special characters in the URL', () => {
    const html = buildProvenanceHeaderHtml(prov({ sourceUrl: 'https://x.test/?a=1&b=2<c>"d"' }));
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&quot;');
    expect(html).not.toMatch(/[^&]&[^a-z#]/); // no bare ampersands
  });

  it('links the source URL and shows the capture time', () => {
    const html = buildProvenanceHeaderHtml(prov());
    expect(html).toContain('<a href="https://example.com/article?id=7"');
    expect(html).toContain('Source:');
    expect(html).toContain('Captured:');
  });

  it('truncates a very long URL in the visible text but keeps the full href', () => {
    const long = `https://example.com/${'x'.repeat(200)}`;
    const html = buildProvenanceHeaderHtml(prov({ sourceUrl: long }));
    expect(html).toContain(`href="${long}"`); // full URL preserved in the link target
    expect(html).toContain('…'); // display text truncated
  });

  it('truncates on a code-point boundary, never splitting an astral char into a lone surrogate', () => {
    // A long URL whose 100th code point is an emoji (surrogate pair) must not be
    // cut mid-pair — a lone surrogate is malformed XML and halts a strict reader.
    const long = `https://example.com/${'a'.repeat(85)}\u{1F600}${'b'.repeat(40)}`;
    const html = buildProvenanceHeaderHtml(prov({ sourceUrl: long }));
    // The visible (truncated) text must contain no unpaired surrogate.
    expect(html).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(html).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    // And it still parses as well-formed XML.
    const xml = `<root xmlns="http://www.w3.org/1999/xhtml">${html}</root>`;
    expect(
      new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
  });

  it('omits the link entirely for a blank URL (time only)', () => {
    const html = buildProvenanceHeaderHtml(prov({ sourceUrl: '   ' }));
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('Source:');
    expect(html).toContain('Captured:');
  });
});

describe('provenanceTextLines (CP6) — plain text for the Full Page banner', () => {
  it('returns a source line and a captured line', () => {
    const lines = provenanceTextLines(prov());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Source: https://example.com/article?id=7');
    expect(lines[1]).toContain('Captured:');
  });

  it('drops the source line for a blank URL', () => {
    const lines = provenanceTextLines(prov({ sourceUrl: '' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Captured:');
  });
});

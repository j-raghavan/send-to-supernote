import { describe, expect, it } from 'vitest';
import {
  buildUploadFilename,
  dedupeName,
  fallbackBaseName,
  resolveBaseName,
  sanitizeBaseName,
  withExtension,
} from '@shared/filename';

// 2026-05-27T00:00:00Z
const DATE_MS = Date.UTC(2026, 4, 27);

describe('sanitizeBaseName (F6-FR3)', () => {
  it('matches the spec example', () => {
    expect(sanitizeBaseName('How to Train Your Model: A Guide  (2026)')).toBe(
      'How-to-Train-Your-Model-A-Guide-2026',
    );
  });

  it('removes every illegal/awkward character', () => {
    expect(sanitizeBaseName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('removes bracket and quote punctuation', () => {
    expect(sanitizeBaseName(`a(b)[c]{d}'e"f`)).toBe('abcdef');
  });

  it('replaces every run of whitespace with a single hyphen', () => {
    expect(sanitizeBaseName('a   b\t\tc\nd')).toBe('a-b-c-d');
  });

  it('collapses consecutive hyphens to one', () => {
    expect(sanitizeBaseName('a - - b')).toBe('a-b');
  });

  it('trims leading/trailing hyphens and dots', () => {
    expect(sanitizeBaseName('  ...Hello...  ')).toBe('Hello');
    expect(sanitizeBaseName('---Hello---')).toBe('Hello');
  });

  it('preserves original letter case (does NOT lowercase)', () => {
    expect(sanitizeBaseName('CamelCase TITLE')).toBe('CamelCase-TITLE');
  });

  it('returns empty string for an all-illegal/whitespace title', () => {
    expect(sanitizeBaseName('   ')).toBe('');
    expect(sanitizeBaseName('/\\:*?')).toBe('');
  });

  it('caps the base name at 120 chars, cutting on a hyphen boundary', () => {
    const words = Array.from({ length: 40 }, (_v, i) => `word${i}`).join(' ');
    const result = sanitizeBaseName(words);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('-')).toBe(false);
    // cut on a hyphen boundary -> no partial trailing token fragment
    expect(words.startsWith(result.replace(/-/g, ' ').slice(0, 5))).toBe(true);
  });

  it('hard-caps when there is no hyphen within the cap window', () => {
    const single = 'x'.repeat(200);
    expect(sanitizeBaseName(single).length).toBe(120);
  });
});

describe('fallbackBaseName (F6-AC2b)', () => {
  it('uses hostname + capture date', () => {
    expect(fallbackBaseName('example.com', DATE_MS)).toBe('example.com-2026-05-27');
  });

  it('falls back to "page" when the hostname sanitizes to empty', () => {
    expect(fallbackBaseName('', DATE_MS)).toBe('page-2026-05-27');
  });
});

describe('resolveBaseName', () => {
  it('uses the sanitized title when non-empty', () => {
    expect(resolveBaseName('Hello World', 'example.com', DATE_MS)).toBe('Hello-World');
  });

  it('uses the fallback when the title sanitizes to empty (F6-AC2b)', () => {
    expect(resolveBaseName('   ', 'example.com', DATE_MS)).toBe('example.com-2026-05-27');
  });
});

describe('withExtension', () => {
  it('appends the chosen format extension', () => {
    expect(withExtension('Hello', 'pdf')).toBe('Hello.pdf');
    expect(withExtension('Hello', 'epub')).toBe('Hello.epub');
  });
});

describe('dedupeName (F6-AC4)', () => {
  it('returns the plain name when no collision', () => {
    expect(dedupeName('Guide', 'pdf', [])).toBe('Guide.pdf');
  });

  it('appends -2 on the first collision', () => {
    expect(dedupeName('Guide', 'pdf', ['Guide.pdf'])).toBe('Guide-2.pdf');
  });

  it('appends -3 when -2 also exists', () => {
    expect(dedupeName('Guide', 'pdf', ['Guide.pdf', 'Guide-2.pdf'])).toBe('Guide-3.pdf');
  });

  it('dedupes per format extension independently', () => {
    expect(dedupeName('Guide', 'epub', ['Guide.pdf'])).toBe('Guide.epub');
  });
});

describe('buildUploadFilename (full pipeline)', () => {
  it('sanitizes + extends + dedupes in one call', () => {
    const name = buildUploadFilename({
      title: 'My: Article*',
      hostname: 'example.com',
      epochMs: DATE_MS,
      format: 'pdf',
      existingNames: ['My-Article.pdf'],
    });
    expect(name).toBe('My-Article-2.pdf');
  });

  it('uses the fallback name for an empty title', () => {
    const name = buildUploadFilename({
      title: '',
      hostname: 'example.com',
      epochMs: DATE_MS,
      format: 'pdf',
      existingNames: [],
    });
    expect(name).toBe('example.com-2026-05-27.pdf');
  });
});
